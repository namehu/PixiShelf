// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.DELETION_VALIDATION_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    url.pathname !== '/pixishelf_delete_validation'
  ) {
    throw new Error(
      'Deletion integration tests require the dedicated local pixishelf_delete_validation database on port 55439'
    )
  }
}
const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const context = vi.hoisted(() => ({ prisma: null as unknown, root: '' }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.prisma
  }
}))
vi.mock('@/services/setting.service', () => ({ getScanPath: async () => context.root }))
vi.mock('@/services/archive/archive-maintenance-service', () => ({ requestArchiveArtworkMaintenance: vi.fn() }))
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))
let service: typeof import('@/services/artwork-service/delete-artwork')
let artworkId: number
let directory: string
let mediaPath: string
let sidecarPath: string
let rootIdentity: string
let externalImageIds: number[]

beforeAll(async () => {
  if (!db) return
  context.prisma = db
  service = await import('@/services/artwork-service/delete-artwork')
  // Failure injection is confined to the dedicated database and these synthetic fixture titles.
  await db.$executeRawUnsafe(`CREATE FUNCTION deletion_test_fail_artwork() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF OLD.title = 'delete-fail-artwork' THEN RAISE EXCEPTION 'injected artwork failure'; END IF; RETURN OLD; END $$`)
  await db.$executeRawUnsafe(
    `CREATE TRIGGER deletion_test_artwork BEFORE DELETE ON "Artwork" FOR EACH ROW EXECUTE FUNCTION deletion_test_fail_artwork()`
  )
  await db.$executeRawUnsafe(`CREATE FUNCTION deletion_test_fail_media() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM "Artwork" WHERE id = OLD."artworkId" AND title = 'delete-fail-media') THEN RAISE EXCEPTION 'injected media failure'; END IF; RETURN OLD; END $$`)
  await db.$executeRawUnsafe(
    `CREATE TRIGGER deletion_test_media BEFORE DELETE ON "Image" FOR EACH ROW EXECUTE FUNCTION deletion_test_fail_media()`
  )
})
beforeEach(async () => {
  if (!db) return
  context.root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-delete-postgres-'))
  const { resolveContentPath } = await import('@/services/artwork-service/content-source-guard')
  rootIdentity = (await resolveContentPath(context.root, '.fixture-identity')).directory.rootIdentity
  const token = randomUUID()
  externalImageIds = []
  directory = `Artist/作品%_${token}`
  mediaPath = `${directory}/image.jpg`
  sidecarPath = `${directory}/133479323-简介-links.txt`
  await fs.mkdir(path.join(context.root, directory), { recursive: true })
  await fs.writeFile(path.join(context.root, mediaPath), 'synthetic media')
  await fs.writeFile(path.join(context.root, sidecarPath), 'synthetic notes')
  const artwork = await db.artwork.create({
    data: {
      title: `delete-test-${token}`,
      storageKey: `delete-test-${token}`,
      storagePath: directory,
      createdVia: 'LOCAL_DIRECTORY'
    }
  })
  artworkId = artwork.id
  await db.image.create({ data: { artworkId, path: mediaPath, sortOrder: 0, mediaType: 'IMAGE' } })
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (!db || !artworkId) return
  await db.image.deleteMany({ where: { id: { in: externalImageIds } } })
  await db.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity } } })
  await db.artwork.updateMany({ where: { id: artworkId }, data: { title: 'delete-test-cleanup' } })
  await db.image.deleteMany({ where: { artworkId } })
  await db.artwork.deleteMany({ where: { id: artworkId } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
  const fixture = path.resolve(context.root)
  if (
    path.dirname(fixture) !== path.resolve(os.tmpdir()) ||
    !path.basename(fixture).startsWith('pixishelf-delete-postgres-')
  ) {
    throw new Error('Unsafe cleanup path')
  }
  await fs.rm(fixture, { recursive: true, force: true })
})
afterAll(async () => {
  if (!db) return
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS deletion_test_artwork ON "Artwork"')
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS deletion_test_media ON "Image"')
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS deletion_test_fail_artwork()')
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS deletion_test_fail_media()')
  await db.$disconnect()
})
async function run() {
  const preview = await service.previewDeleteArtwork(artworkId, 'synthetic-admin')
  return service.deleteArtwork(
    {
      artworkId,
      operationId: preview.operationId,
      selectedPaths: preview.entries
        .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
        .map((entry) => entry.path)
    },
    { requestedByUserId: 'synthetic-admin' }
  )
}

async function addExternalMedia(rows: Prisma.ImageCreateManyInput[]) {
  const images = await db!.image.createManyAndReturn({ data: rows, select: { id: true } })
  externalImageIds.push(...images.map(({ id }) => id))
}

async function captureReferenceQuery() {
  const raw = vi.spyOn(db!, '$queryRaw')
  await service.previewDeleteArtwork(artworkId, 'synthetic-admin')
  const query = raw.mock.calls
    .map(([arg]) => arg)
    .find((arg): arg is Prisma.Sql => 'text' in arg && arg.text.includes('UNION ALL'))
  raw.mockRestore()
  expect(query).toBeDefined()
  return query!
}
describe.skipIf(!databaseUrl)('artwork deletion with real PostgreSQL transactions', () => {
  it('deletes files and database records and removes the empty work directory', async () => {
    const preview = await service.previewDeleteArtwork(artworkId, 'synthetic-admin')
    expect(preview.canDelete).toBe(true)
    expect(await db!.image.count({ where: { artworkId } })).toBe(1)
    const report = await run()
    expect(report).toMatchObject({ outcome: 'COMPLETED', counts: { media: 1, sidecars: 1, directories: 1 } })
    expect(await db!.artwork.count({ where: { id: artworkId } })).toBe(0)
    expect(await db!.image.count({ where: { artworkId } })).toBe(0)
    await expect(fs.stat(path.join(context.root, directory))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('matches the previous path lookup on Linux', async () => {
    const backslash = directory.replace(/\//g, '\\')
    const matches = [
      { path: `${directory}/画像.jpg`, chaptersPath: null },
      { path: `/${directory}/leading.jpg`, chaptersPath: null },
      { path: `${backslash}\\legacy.jpg`, chaptersPath: 'outside/mate.chapters.json' },
      { path: 'outside/mate.jpg', chaptersPath: `\\${backslash}\\legacy.chapters.json` },
      { path: directory, chaptersPath: `${directory}/both.chapters.json` }
    ]
    await addExternalMedia([
      ...matches,
      { path: `${directory}0/outside.jpg` },
      { path: `${directory}0` },
      { path: `${backslash}]` },
      { path: `${directory.toLowerCase()}/case.jpg` },
      { path: `${directory.replace('%_', 'wildcard')}/wildcard.jpg` },
      { path: 'outside/not-reference.jpg', chaptersPath: `${directory}-neighbor/other.chapters.json` }
    ])
    const values = [directory, `/${directory}`, backslash, `\\${backslash}`]
    const filters = values.flatMap((value) => [
      { equals: value },
      { startsWith: `${value}${value.includes('\\') ? '\\' : '/'}`.replace(/[\\%_]/g, '\\$&') }
    ])
    const legacy = await db!.image.findMany({
      where: {
        AND: [
          { OR: [{ artworkId: { not: artworkId } }, { artworkId: null }] },
          { OR: [...filters.map((path) => ({ path })), ...filters.map((chaptersPath) => ({ chaptersPath }))] }
        ]
      },
      select: { path: true, chaptersPath: true }
    })
    const query = await captureReferenceQuery()
    const indexed = await db!.$queryRaw<typeof legacy>(query)
    const pairs = (rows: typeof legacy) =>
      new Set(rows.map(({ path, chaptersPath }) => JSON.stringify([path, chaptersPath])))
    expect(pairs(legacy)).toEqual(pairs(matches))
    expect(pairs(indexed)).toEqual(pairs(legacy))
  })

  it('blocks extra files when the only shared reference names a missing file', async () => {
    const missing = `${directory}/missing.jpg`
    await addExternalMedia([{ path: missing }])
    await expect(fs.stat(path.join(context.root, missing))).rejects.toMatchObject({ code: 'ENOENT' })
    const preview = await service.previewDeleteArtwork(artworkId, 'synthetic-admin')
    expect(preview).toMatchObject({ directoryMode: 'SHARED_DIRECTORY', inspectionComplete: true })
    expect(preview.entries).toContainEqual(expect.objectContaining({ path: sidecarPath, selection: 'BLOCKED' }))
  })

  it('rejects the original selection if a shared reference appears after preview', async () => {
    const preview = await service.previewDeleteArtwork(artworkId, 'synthetic-admin')
    expect(preview.directoryMode).toBe('WORK_DIRECTORY')
    const selectedPaths = preview.entries
      .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
      .map((entry) => entry.path)
    expect(selectedPaths).toEqual(expect.arrayContaining([mediaPath, sidecarPath]))
    await addExternalMedia([{ path: 'outside/shared.jpg', chaptersPath: mediaPath }])
    const report = await service.deleteArtwork(
      { artworkId, operationId: preview.operationId, selectedPaths },
      { requestedByUserId: 'synthetic-admin' }
    )
    expect(report).toMatchObject({ outcome: 'FAILED', database: { artwork: 'RETAINED', media: 'RETAINED' } })
    expect(await db!.artwork.count({ where: { id: artworkId } })).toBe(1)
    expect(await db!.image.count({ where: { artworkId } })).toBe(1)
    await expect(fs.readFile(path.join(context.root, mediaPath), 'utf8')).resolves.toBe('synthetic media')
    await expect(fs.readFile(path.join(context.root, sidecarPath), 'utf8')).resolves.toBe('synthetic notes')
  })

  it.runIf(process.platform !== 'win32' && process.env.DELETION_VALIDATION_EXPLAIN === '1')(
    'uses bounded index lookups in custom and generic plans at production scale',
    async () => {
      const query = await captureReferenceQuery()
      await db!.$transaction(
        async (tx) => {
          await tx.$executeRaw`CREATE TEMP TABLE "Image" (LIKE public."Image" INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP`
          await tx.$executeRaw`
          INSERT INTO pg_temp."Image" (id, path, "chaptersPath", "updatedAt", "artworkId")
          SELECT n, 'library/creator-' || n / 100 || '/work-' || n / 11 || '/image-' || n || '.jpg',
            CASE WHEN n % 1024 = 0 THEN 'library/other-' || n || '.chapters.json' END,
            CURRENT_TIMESTAMP, 10 + n / 100 FROM generate_series(1, 1860000) AS n
        `
          await tx.$executeRaw`ANALYZE pg_temp."Image"`
          // Prepare the actual SQL built by Prisma; PostgreSQL infers its bound text and integer types.
          await tx.$executeRawUnsafe(`PREPARE artwork_delete_lookup AS ${query.text}`)
          const [argumentsRow] = await tx.$queryRaw<{ args: string }[]>(Prisma.sql`
          SELECT concat_ws(', ', ${Prisma.join(query.values.map((value) => Prisma.sql`quote_literal(${String(value)}::text)`))}) AS args
        `)
          for (const mode of ['force_custom_plan', 'force_generic_plan']) {
            await tx.$queryRaw`SELECT set_config('plan_cache_mode', ${mode}, true)`
            const lines = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
              `EXPLAIN (ANALYZE, BUFFERS) EXECUTE artwork_delete_lookup(${argumentsRow!.args})`
            )
            const plan = lines.map((line) => line['QUERY PLAN']).join('\n')
            expect(plan, mode).not.toMatch(/Seq Scan on "?Image/)
            for (const column of ['path', 'chaptersPath']) {
              expect(
                lines.some((line) => {
                  const detail = line['QUERY PLAN']
                  return (
                    detail.includes('Index Cond:') &&
                    detail.includes(column === 'path' ? 'path' : '"chaptersPath"') &&
                    detail.includes('>=') &&
                    detail.includes('<')
                  )
                }),
                `${mode}: no range index condition for ${column}` + '\n' + plan
              ).toBe(true)
            }
            console.info(
              `${mode}: ${lines.find((line) => line['QUERY PLAN'].startsWith('Execution Time:'))?.['QUERY PLAN']}`
            )
          }
          await tx.$executeRaw`DEALLOCATE artwork_delete_lookup`
        },
        { timeout: 180_000 }
      )
    },
    190_000
  )
  it.each(['media', 'artwork'])(
    'rolls back both record types on the %s database failure, then retries missing files',
    async (stage) => {
      await db!.artwork.update({ where: { id: artworkId }, data: { title: `delete-fail-${stage}` } })
      const report = await run()
      expect(report).toMatchObject({
        outcome: 'PARTIAL',
        database: { artwork: 'FAILED', media: 'FAILED', deletedMediaCount: 0 }
      })
      expect(await db!.image.count({ where: { artworkId } })).toBe(1)
      expect(await db!.artwork.findUnique({ where: { id: artworkId }, select: { imageCount: true } })).toEqual({
        imageCount: 1
      })
      await expect(fs.stat(path.join(context.root, mediaPath))).rejects.toMatchObject({ code: 'ENOENT' })
      await db!.artwork.update({ where: { id: artworkId }, data: { title: 'delete-test-retry' } })
      expect((await run()).outcome).toBe('COMPLETED')
      expect(await db!.artwork.count({ where: { id: artworkId } })).toBe(0)
    }
  )

  it('preserves actual database records after a filesystem failure and completes a retry', async () => {
    const unlink = fs.unlink.bind(fs)
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file).endsWith('links.txt')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return unlink(file)
    })
    expect(await run()).toMatchObject({ outcome: 'PARTIAL', database: { artwork: 'RETAINED', media: 'RETAINED' } })
    expect(await db!.artwork.count({ where: { id: artworkId } })).toBe(1)
    expect(await db!.image.count({ where: { artworkId } })).toBe(1)
    spy.mockRestore()
    expect((await run()).outcome).toBe('COMPLETED')
  })
})
