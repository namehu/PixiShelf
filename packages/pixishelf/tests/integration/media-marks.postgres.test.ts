// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Explicit isolated endpoint only: never load DATABASE_URL or the application's env files.
const isolatedUrl = process.env.MEDIA_MARK_DATABASE_URL
if (isolatedUrl) {
  const target = new URL(isolatedUrl)
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55436' || target.pathname !== '/media_marks_verification') {
    throw new Error('Requires isolated 127.0.0.1:55436/media_marks_verification database')
  }
}
const databaseName = `media_marks_fixture_${randomUUID().replaceAll('-', '')}`
const fixtureUrl = isolatedUrl ? new URL(isolatedUrl) : null
if (fixtureUrl) fixtureUrl.pathname = `/${databaseName}`
const admin = isolatedUrl ? new PrismaClient({ datasourceUrl: isolatedUrl }) : null
const db = fixtureUrl ? new PrismaClient({ datasourceUrl: fixtureUrl.toString() }) : null
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return context.db } }))
import { getMediaMarks, listMediaMarks, removeMediaMark, setMediaMark } from '@/services/media-mark-service'
import { beginSummaryPathWrite, beginSummaryReplace, finishSummaryPathWrite, finishSummaryReplace } from '@/services/artwork-service/summary-source-guard'

const migrationName = '20261022160000_media_marks'
const dbPackage = path.resolve(process.cwd(), '../pixishelf-db')
let temporaryDirectory = ''
let databaseCreated = false
let historicalArtworkId = 0
let historicalMediaId = 0
const user = 'media-marks-a'
const other = 'media-marks-b'

function deploy() {
  execFileSync(process.execPath, [path.join(dbPackage, 'scripts/run-prisma.mjs'), 'migrate', 'deploy', '--schema', path.join(temporaryDirectory, 'schema.prisma')], {
    cwd: dbPackage, env: { ...process.env, DATABASE_URL: fixtureUrl!.toString() }, stdio: 'pipe', timeout: 120_000
  })
}

async function fixture(names = ['first.jpg', 'second.jpg']) {
  const prefix = randomUUID()
  const artwork = await db!.artwork.create({ data: { title: `media mark ${prefix}` } })
  const images = []
  for (const [index, name] of names.entries()) {
    images.push(await db!.image.create({ data: { artworkId: artwork.id, path: `/synthetic/${prefix}/${name}`, sortOrder: index } }))
  }
  return { artwork, images }
}

describe.skipIf(!isolatedUrl).sequential('media marks migration and lifecycle in isolated PostgreSQL', () => {
  beforeAll(async () => {
    await admin!.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    databaseCreated = true
    context.db = db
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-media-marks-migration-'))
    await fs.copyFile(path.join(dbPackage, 'prisma/schema.prisma'), path.join(temporaryDirectory, 'schema.prisma'))
    const migrationsDirectory = path.join(temporaryDirectory, 'migrations')
    await fs.mkdir(migrationsDirectory)
    for (const entry of await fs.readdir(path.join(dbPackage, 'prisma/migrations'), { withFileTypes: true })) {
      if (entry.name === migrationName) continue
      await fs.cp(path.join(dbPackage, 'prisma/migrations', entry.name), path.join(migrationsDirectory, entry.name), { recursive: entry.isDirectory() })
    }
    deploy()
    await db!.userBA.createMany({ data: [{ id: user }, { id: other }] })
    const historical = await fixture()
    historicalArtworkId = historical.artwork.id
    historicalMediaId = historical.images[0]!.id
    await db!.artworkLike.create({ data: { userId: user, artworkId: historicalArtworkId, level: 3 } })
    await db!.artworkReadMedia.create({ data: { userId: user, artworkId: historicalArtworkId, mediaId: historicalMediaId } })
    await fs.cp(path.join(dbPackage, 'prisma/migrations', migrationName), path.join(migrationsDirectory, migrationName), { recursive: true })
    deploy()
  }, 180_000)

  afterAll(async () => {
    await db?.$disconnect()
    if (admin && databaseCreated) {
      if (!/^media_marks_fixture_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unsafe fixture cleanup')
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`)
    }
    await admin?.$disconnect()
    if (temporaryDirectory) {
      const resolved = path.resolve(temporaryDirectory)
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('pixishelf-media-marks-migration-')) throw new Error('Unsafe fixture directory cleanup')
      await fs.rm(resolved, { recursive: true, force: true })
    }
  })

  it('upgrades a populated historical chain without changing media, ratings, or reading facts', async () => {
    expect(await db!.mediaMark.count()).toBe(0)
    expect(await db!.image.findUnique({ where: { id: historicalMediaId } })).not.toBeNull()
    expect(await db!.artworkLike.findUnique({ where: { userId_artworkId: { userId: user, artworkId: historicalArtworkId } } })).toMatchObject({ level: 3 })
    expect(await db!.artworkReadMedia.count()).toBe(1)
    const migrations = await db!.$queryRaw<Array<{ finished_at: Date | null }>>`SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = ${migrationName}`
    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.finished_at).toBeInstanceOf(Date)
  })

  it('supports independent idempotent flags, concurrent writes, and account isolation', async () => {
    const { artwork, images } = await fixture()
    const id = images[0]!.id
    const bookmark = await setMediaMark(user, artwork.id, id, 'bookmark', true)
    expect(await setMediaMark(user, artwork.id, id, 'bookmark', true)).toEqual(bookmark)
    const both = await setMediaMark(user, artwork.id, id, 'like', true)
    expect(both.bookmarkedAt).toBe(bookmark.bookmarkedAt)
    expect(both.likedAt).not.toBeNull()
    expect((await getMediaMarks(other, artwork.id, [id])).items[0]).toMatchObject({ markId: null, likedAt: null, bookmarkedAt: null })
    expect((await getMediaMarks(user, artwork.id, [id])).items[0]).toEqual(both)
    await removeMediaMark(other, both.markId!, 'bookmark')
    expect((await getMediaMarks(user, artwork.id, [id])).items[0]).toEqual(both)
    const likeOnly = await setMediaMark(user, artwork.id, id, 'bookmark', false)
    expect(likeOnly).toMatchObject({ markId: bookmark.markId, bookmarkedAt: null, likedAt: both.likedAt })
    await setMediaMark(user, artwork.id, id, 'like', false)
    expect(await db!.mediaMark.count({ where: { artworkId: artwork.id } })).toBe(0)
    await Promise.all(Array.from({ length: 12 }, (_, index) => setMediaMark(user, artwork.id, id, index % 2 ? 'like' : 'bookmark', true)))
    const final = (await getMediaMarks(user, artwork.id, [id])).items[0]!
    expect(final.bookmarkedAt).not.toBeNull()
    expect(final.likedAt).not.toBeNull()
    expect(await db!.mediaMark.count({ where: { artworkId: artwork.id } })).toBe(1)
    expect(await db!.artworkLike.count({ where: { artworkId: artwork.id } })).toBe(0)
    expect(await db!.artworkReadMedia.count({ where: { artworkId: artwork.id } })).toBe(0)
  })

  it('canonicalizes APNG/video members and rejects cross-artwork media', async () => {
    const { artwork, images } = await fixture(['animated.apng', 'animated.mp4', 'still.gif'])
    const raw = await setMediaMark(user, artwork.id, images[0]!.id, 'bookmark', true)
    const canonical = await setMediaMark(user, artwork.id, images[1]!.id, 'like', true)
    expect(raw.mediaId).toBe(images[1]!.id)
    expect(raw.markId).toBe(canonical.markId)
    expect((await getMediaMarks(user, artwork.id, [images[0]!.id, images[1]!.id])).items).toHaveLength(1)
    const rows = (await listMediaMarks(user, 'bookmark', 1)).items
    expect(rows.find((row) => row.id === raw.markId)).toMatchObject({ mediaId: images[1]!.id, mediaPosition: 1, mediaType: 'video', media: { id: images[1]!.id, raw: { id: images[0]!.id } } })
    const foreign = await fixture()
    await expect(setMediaMark(user, artwork.id, foreign.images[0]!.id, 'like', true)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await getMediaMarks(user, artwork.id, [foreign.images[0]!.id])).items[0]).toMatchObject({ available: false, markId: null })
  })

  it('keeps IDs through metadata/order updates, and retains removable snapshots after deletion/rebuild', async () => {
    const { artwork, images } = await fixture()
    const id = images[0]!.id
    const mark = await setMediaMark(user, artwork.id, id, 'bookmark', true)
    await setMediaMark(user, artwork.id, id, 'like', true)
    await db!.image.update({ where: { id }, data: { sortOrder: 20, width: 640 } })
    expect((await listMediaMarks(user, 'bookmark', 1)).items.find((item) => item.id === mark.markId)).toMatchObject({ mediaId: id, mediaPosition: 2, unavailableReason: null })
    await db!.image.delete({ where: { id } })
    const invalid = (await listMediaMarks(user, 'bookmark', 1)).items.find((item) => item.id === mark.markId)
    expect(invalid).toMatchObject({ mediaId: null, media: null, mediaPosition: 1, artworkTitle: artwork.title, unavailableReason: 'deleted' })
    await removeMediaMark(user, mark.markId!, 'bookmark')
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toMatchObject({ bookmarkedAt: null, mediaId: null })
    await removeMediaMark(user, mark.markId!, 'like')
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toBeNull()
    await removeMediaMark(user, mark.markId!, 'like')
  })

  it('retains an APNG mark when a normal scan adds its video representative', async () => {
    const { artwork, images } = await fixture(['animated.apng'])
    const original = await setMediaMark(user, artwork.id, images[0]!.id, 'bookmark', true)
    const video = await db!.image.create({ data: { artworkId: artwork.id, path: images[0]!.path.replace('.apng', '.mp4'), sortOrder: 1, mediaType: 'VIDEO' } })
    const state = (await getMediaMarks(user, artwork.id, [video.id])).items[0]
    expect(state).toMatchObject({ markId: original.markId, mediaId: video.id, bookmarkedAt: original.bookmarkedAt, available: true })
    expect((await listMediaMarks(user, 'bookmark', 1)).items.find((item) => item.id === original.markId)).toMatchObject({ mediaId: video.id, mediaPosition: 1, unavailableReason: null })
    const updated = await setMediaMark(user, artwork.id, video.id, 'like', true)
    expect(updated).toMatchObject({ markId: original.markId, bookmarkedAt: original.bookmarkedAt, mediaId: video.id })
    expect(await db!.mediaMark.count({ where: { artworkId: artwork.id } })).toBe(1)
    expect(await db!.mediaMark.findUnique({ where: { id: original.markId! } })).toMatchObject({ mediaId: video.id })
  })

  it('gates in-place writes, ignores stale completion, and invalidates only committed logical media', async () => {
    const { artwork, images } = await fixture(['animated.apng', 'animated.mp4'])
    const mark = await setMediaMark(user, artwork.id, images[1]!.id, 'bookmark', true)
    const stale = await beginSummaryPathWrite(images[0]!.path)
    const latest = await beginSummaryPathWrite(images[0]!.path)
    expect((await getMediaMarks(user, artwork.id, [images[1]!.id])).items[0]).toMatchObject({ available: false })
    await expect(setMediaMark(user, artwork.id, images[1]!.id, 'like', true)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(removeMediaMark(user, mark.markId!, 'bookmark')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await listMediaMarks(user, 'bookmark', 1)).items.find((item) => item.id === mark.markId)).toMatchObject({ unavailableReason: 'writing', media: null })
    await finishSummaryPathWrite(stale)
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toMatchObject({ mediaId: images[1]!.id })
    await finishSummaryPathWrite(latest)
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toMatchObject({ mediaId: null })
    const next = await setMediaMark(user, artwork.id, images[1]!.id, 'bookmark', true)
    expect(next.markId).not.toBe(mark.markId)
    await finishSummaryPathWrite(latest)
    expect(await db!.mediaMark.findUnique({ where: { id: next.markId! } })).toMatchObject({ mediaId: images[1]!.id })
  })

  it('preserves marks through a verified replace rollback and hides recycled works until restored', async () => {
    const { artwork, images } = await fixture()
    const mark = await setMediaMark(user, artwork.id, images[0]!.id, 'like', true)
    await beginSummaryReplace(artwork.id)
    await expect(setMediaMark(user, artwork.id, images[0]!.id, 'bookmark', true)).rejects.toMatchObject({ code: 'CONFLICT' })
    await beginSummaryPathWrite(images[0]!.path)
    await finishSummaryReplace(artwork.id)
    expect((await getMediaMarks(user, artwork.id, [images[0]!.id])).items[0]).toEqual(mark)
    await db!.artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'TRASHED' } })
    expect((await listMediaMarks(user, 'like', 1)).items.some((row) => row.id === mark.markId)).toBe(false)
    await expect(setMediaMark(user, artwork.id, images[0]!.id, 'bookmark', true)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await db!.artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'ACTIVE' } })
    expect((await listMediaMarks(user, 'like', 1)).items.some((row) => row.id === mark.markId)).toBe(true)
    await db!.image.deleteMany({ where: { artworkId: artwork.id } })
    await db!.artwork.delete({ where: { id: artwork.id } })
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toBeNull()
  })

  it('enforces database uniqueness, valid snapshots, nonempty marks, and account cascades', async () => {
    const { artwork, images } = await fixture()
    const account = await db!.userBA.create({ data: { id: randomUUID() } })
    const mark = await setMediaMark(account.id, artwork.id, images[0]!.id, 'bookmark', true)
    const data = { userId: account.id, artworkId: artwork.id, mediaId: images[0]!.id, bookmarkedAt: new Date(), artworkTitle: artwork.title, mediaPosition: 1, mediaType: 'image' }
    await expect(db!.mediaMark.create({ data })).rejects.toThrow()
    await expect(db!.mediaMark.create({ data: { ...data, mediaId: null, bookmarkedAt: null } })).rejects.toThrow()
    await expect(db!.mediaMark.create({ data: { ...data, mediaId: null, mediaPosition: 0 } })).rejects.toThrow()
    await expect(db!.mediaMark.create({ data: { ...data, mediaId: null, mediaType: 'unknown' } })).rejects.toThrow()
    await db!.mediaMark.create({ data: { ...data, mediaId: null } })
    await db!.mediaMark.create({ data: { ...data, mediaId: null } })
    await db!.userBA.delete({ where: { id: account.id } })
    expect(await db!.mediaMark.findUnique({ where: { id: mark.markId! } })).toBeNull()
    expect(await db!.mediaMark.count({ where: { userId: account.id } })).toBe(0)
  })

  it('paginates by the selected flag timestamp with deterministic ties', async () => {
    const account = await db!.userBA.create({ data: { id: randomUUID() } })
    const { artwork, images } = await fixture(Array.from({ length: 27 }, (_, index) => `${index}.jpg`))
    for (const image of images) await setMediaMark(account.id, artwork.id, image.id, 'bookmark', true)
    const first = await listMediaMarks(account.id, 'bookmark', 1)
    const second = await listMediaMarks(account.id, 'bookmark', 2)
    expect(first).toMatchObject({ total: 27, page: 1, pageSize: 24 })
    expect(first.items).toHaveLength(24)
    expect(second.items).toHaveLength(3)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(27)
    expect(first.items[0]!.mediaId).toBe(images[26]!.id)
    expect((await listMediaMarks(account.id, 'like', 1)).total).toBe(0)
  })
})
