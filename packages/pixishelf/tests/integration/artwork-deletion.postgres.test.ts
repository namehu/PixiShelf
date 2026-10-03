// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
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
  const token = randomUUID()
  directory = `artist/${token}`
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
  await db.artwork.updateMany({ where: { id: artworkId }, data: { title: 'delete-test-cleanup' } })
  await db.image.deleteMany({ where: { artworkId } })
  await db.artwork.deleteMany({ where: { id: artworkId } })
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
  const preview = await service.previewDeleteArtwork(artworkId)
  return service.deleteArtwork(
    {
      artworkId,
      selectedPaths: preview.entries
        .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
        .map((entry) => entry.path)
    },
    { requestedByUserId: 'synthetic-admin' }
  )
}

describe.skipIf(!databaseUrl)('artwork deletion with real PostgreSQL transactions', () => {
  it('deletes files and database records and removes the empty work directory', async () => {
    const preview = await service.previewDeleteArtwork(artworkId)
    expect(preview.canDelete).toBe(true)
    expect(await db!.image.count({ where: { artworkId } })).toBe(1)
    const report = await run()
    expect(report).toMatchObject({ outcome: 'COMPLETED', counts: { media: 1, sidecars: 1, directories: 1 } })
    expect(await db!.artwork.count({ where: { id: artworkId } })).toBe(0)
    expect(await db!.image.count({ where: { artworkId } })).toBe(0)
    await expect(fs.stat(path.join(context.root, directory))).rejects.toMatchObject({ code: 'ENOENT' })
  })

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
