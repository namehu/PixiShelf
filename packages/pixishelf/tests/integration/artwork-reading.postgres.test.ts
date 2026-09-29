// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient, invalidateArtworkReadingForRebuild } from '@pixishelf/db'

const databaseUrl = process.env.READING_VALIDATION_DATABASE_URL
function isDedicatedDatabase(value: string | undefined) {
  if (!value) return false
  const url = new URL(value)
  return url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55432' && url.pathname === '/reading_perf'
}
if (databaseUrl && !isDedicatedDatabase(databaseUrl)) throw new Error('Reading integration test requires the dedicated reading_perf database')

const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() { return context.prisma }
}))

let readingService: typeof import('@/services/reading-service')
beforeAll(async () => {
  context.prisma = db
  readingService = await import('@/services/reading-service')
})

const created = { userIds: [] as string[], artworkIds: [] as number[], imageIds: [] as number[] }
const fixture = { userId: '', otherUserId: '', artworkId: 0, apngId: 0, videoId: 0, otherId: 0 }
const event = (mediaId: number, type: 'VIEW' | 'HEARTBEAT' = 'VIEW') => ({ type, mediaId, observedAt: new Date().toISOString() })
const report = (userId: string, events: ReturnType<typeof event>[], mediaRevision = 1) =>
  readingService.reportReading(userId, { artworkId: fixture.artworkId, expectedUserId: userId, mediaRevision, events })

beforeEach(async () => {
  if (!db) return
  const token = randomUUID()
  const user = await db.userBA.create({ data: { id: `reading-${token}-a` } })
  const other = await db.userBA.create({ data: { id: `reading-${token}-b` } })
  const artwork = await db.artwork.create({ data: { title: `reading test ${token}`, storageKey: `reading-test-${token}`, imageCount: 3 } })
  const [apng, video, otherMedia] = await Promise.all([
    db.image.create({ data: { artworkId: artwork.id, path: `/reading-test/${token}/a.apng`, sortOrder: 0, mediaType: 'ANIMATION' } }),
    db.image.create({ data: { artworkId: artwork.id, path: `/reading-test/${token}/a.webm`, sortOrder: 1, mediaType: 'VIDEO' } }),
    db.image.create({ data: { artworkId: artwork.id, path: `/reading-test/${token}/b.jpg`, sortOrder: 2, mediaType: 'IMAGE' } })
  ])
  created.userIds.push(user.id, other.id)
  created.artworkIds.push(artwork.id)
  created.imageIds.push(apng.id, video.id, otherMedia.id)
  Object.assign(fixture, { userId: user.id, otherUserId: other.id, artworkId: artwork.id, apngId: apng.id, videoId: video.id, otherId: otherMedia.id })
})

afterEach(async () => {
  if (!db) return
  await db.artworkReadMedia.deleteMany({ where: { artworkId: { in: created.artworkIds } } })
  await db.artworkReadingSummary.deleteMany({ where: { artworkId: { in: created.artworkIds } } })
  await db.image.deleteMany({ where: { id: { in: created.imageIds } } })
  await db.artwork.deleteMany({ where: { id: { in: created.artworkIds } } })
  await db.userBA.deleteMany({ where: { id: { in: created.userIds } } })
  created.userIds.length = created.artworkIds.length = created.imageIds.length = 0
})

afterAll(async () => { await db?.$disconnect() })

describe.skipIf(!databaseUrl)('artwork reading on PostgreSQL', () => {
  it('serializes first visits, repeat batches and an init/report race under the artwork lock', async () => {
    const initial = await readingService.getReadingContext(fixture.userId, fixture.artworkId)
    expect(initial.summary.viewCount).toBe(0)
    expect(initial.media[0]).toMatchObject({ mediaId: fixture.videoId, memberMediaIds: [fixture.videoId, fixture.apngId] })
    const observed = event(fixture.videoId)
    const [a, b] = await Promise.all([report(fixture.userId, [observed]), report(fixture.userId, [observed])])
    expect(a.summary.viewCount).toBe(1)
    expect(b.summary.viewCount).toBe(1)
    const [readingContext] = await Promise.all([readingService.getReadingContext(fixture.userId, fixture.artworkId), report(fixture.userId, [event(fixture.apngId)])])
    expect(readingContext.summary.viewCount).toBe(1)
    const final = await readingService.getReadingContext(fixture.userId, fixture.artworkId)
    expect(final.summary).toMatchObject({ viewCount: 1, seenCount: 1, totalCount: 2 })
    expect(await db!.artworkReadMedia.count({ where: { artworkId: fixture.artworkId, userId: fixture.userId } })).toBe(2)
  })

  it('merges a late device VIEW into the same visit and persists the last accepted position', async () => {
    const laterAt = new Date(Date.now() - 1_000)
    const earlierAt = new Date(laterAt.getTime() - 1_000)
    await report(fixture.userId, [{ type: 'VIEW', mediaId: fixture.videoId, observedAt: laterAt.toISOString() }])
    const late = await report(fixture.userId, [{ type: 'VIEW', mediaId: fixture.otherId, observedAt: earlierAt.toISOString() }])

    expect(late.summary).toMatchObject({ viewCount: 1, seenCount: 2, totalCount: 2, lastMediaId: fixture.otherId, lastMediaIndex: 1 })
    expect(late.summary.lastActiveAt).toBe(laterAt.toISOString())
    expect(late.summary.lastViewedAt).toBe(laterAt.toISOString())
    expect(await db!.artworkReadMedia.count({ where: { artworkId: fixture.artworkId, userId: fixture.userId } })).toBe(3)
    const persisted = await db!.artworkReadingSummary.findUniqueOrThrow({
      where: { userId_artworkId: { userId: fixture.userId, artworkId: fixture.artworkId } }
    })
    expect(persisted.viewCount).toBe(1)
    expect(persisted.lastMediaId).toBe(fixture.otherId)
    expect(persisted.lastActiveAt).toEqual(laterAt)
  })

  it('enforces 30 minute visits, heartbeat limits and account isolation', async () => {
    expect((await report(fixture.userId, [event(fixture.videoId, 'HEARTBEAT')])).summary.viewCount).toBe(0)
    await report(fixture.userId, [event(fixture.videoId)])
    const earlier = new Date(Date.now() - 30 * 60_000 - 1000)
    await db!.artworkReadingSummary.update({
      where: { userId_artworkId: { userId: fixture.userId, artworkId: fixture.artworkId } },
      data: { lastActiveAt: earlier }
    })
    const heartbeat = await report(fixture.userId, [event(fixture.videoId, 'HEARTBEAT')])
    expect(heartbeat.summary.viewCount).toBe(1)
    expect(heartbeat.summary.lastActiveAt).toBe(earlier.toISOString())
    const nextVisit = await report(fixture.userId, [event(fixture.otherId)])
    expect(nextVisit.summary).toMatchObject({ viewCount: 2, seenCount: 2, totalCount: 2, status: 'COMPLETED' })
    expect((await readingService.getReadingContext(fixture.otherUserId, fixture.artworkId)).summary.status).toBe('UNREAD')
    expect((await readingService.getReadingSummaries(fixture.otherUserId, [fixture.artworkId])).summaries).toEqual([])
    expect((await readingService.getReadingHistory(fixture.otherUserId, 10)).items).toEqual([])
    const history = await readingService.getReadingHistory(fixture.userId, 10)
    expect(history.items[0]).toMatchObject({ artwork: { id: fixture.artworkId }, reading: { viewCount: 2 } })
  })

  it('ignores deleted media without losing valid observations from the same batch', async () => {
    await db!.image.delete({ where: { id: fixture.otherId } })
    const invalidOnly = await report(fixture.userId, [event(fixture.otherId)])
    expect(invalidOnly.summary).toMatchObject({ status: 'UNREAD', viewCount: 0, seenCount: 0, totalCount: 1 })
    expect(await db!.artworkReadingSummary.count({ where: { artworkId: fixture.artworkId, userId: fixture.userId } })).toBe(0)

    const mixed = await report(fixture.userId, [event(fixture.otherId), event(fixture.videoId)])
    expect(mixed.summary).toMatchObject({ viewCount: 1, seenCount: 1, totalCount: 1, lastMediaId: fixture.videoId })
    const seenRows = await db!.artworkReadMedia.findMany({
      where: { artworkId: fixture.artworkId, userId: fixture.userId },
      select: { mediaId: true },
      orderBy: { mediaId: 'asc' }
    })
    expect(seenRows.map(({ mediaId }) => mediaId)).toEqual([fixture.apngId, fixture.videoId].sort((a, b) => a - b))
  })

  it('rejects deleted media and old revisions, and clears all accounts on rebuild', async () => {
    await report(fixture.userId, [event(fixture.videoId)])
    await report(fixture.otherUserId, [event(fixture.otherId)])
    await db!.image.delete({ where: { id: fixture.otherId } })
    const ignored = await report(fixture.userId, [event(fixture.otherId)])
    expect(ignored.summary).toMatchObject({ viewCount: 1, seenCount: 1, lastMediaId: fixture.videoId })
    const beforeRebuild = await readingService.getReadingContext(fixture.userId, fixture.artworkId)
    expect(beforeRebuild.summary.viewCount).toBe(1)
    const revision = await db!.$transaction((tx) => invalidateArtworkReadingForRebuild(tx, fixture.artworkId))
    expect(revision).toBe(2)
    await expect(report(fixture.userId, [event(fixture.videoId)], 1)).rejects.toMatchObject({ code: 'CONFLICT', message: 'READING_MEDIA_REVISION_CONFLICT' })
    expect(await db!.artworkReadingSummary.count({ where: { artworkId: fixture.artworkId } })).toBe(0)
    expect(await db!.artworkReadMedia.count({ where: { artworkId: fixture.artworkId } })).toBe(0)
    expect((await readingService.getReadingContext(fixture.userId, fixture.artworkId)).mediaRevision).toBe(2)
  })
})
