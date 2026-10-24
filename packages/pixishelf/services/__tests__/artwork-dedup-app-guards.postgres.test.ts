// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db
}))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsByIds: vi.fn() }))
import { db, seed, cleanupFixture } from '../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { freezeArtworkDedupOperation, saveArtworkDedupReview } from '../../../pixishelf-db/src/artwork-dedup-review'
import { getReadingContext, getReaderInitialization, reportReading, markReadingRead } from '../reading-service'
import { setArtworkRating } from '../artwork-rating-service'
import { setMediaMark, removeMediaMark } from '../media-mark-service'
import { randomUUID } from 'node:crypto'
const opIds: string[] = []
async function fixture() {
  const f = await db!.$transaction((tx) => seed(tx))
  const ids = f.members.flat()
  const images = await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { artworkId: 'asc' } })
  const arts = await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })
  return { ...f, ids, images, arts }
}
function reading(f: Awaited<ReturnType<typeof fixture>>, index: number) {
  const artworkId = f.arts[index]!.id
  const input = { artworkId, expectedUserId: f.actor.id, mediaRevision: f.arts[index]!.mediaRevision }
  return [
    () => getReadingContext(f.actor.id, artworkId),
    () => getReaderInitialization(f.actor.id, artworkId),
    () =>
      reportReading(f.actor.id, {
        ...input,
        events: [{ type: 'VIEW', mediaId: f.images[index]!.id, observedAt: new Date().toISOString() }]
      }),
    () => markReadingRead(f.actor.id, { ...input, target: { kind: 'ALL' } })
  ]
}
describe.skipIf(!db)('App reading and personal organization maintenance guards', () => {
  afterAll(async () => {
    await db?.artworkDedupClaim.deleteMany({ where: { operationId: { in: opIds } } })
    await cleanupFixture()
  })
  it('rejects copy reading and both roles organization writes while preserving all existing private rows', async () => {
    const f = await fixture()
    const marks: Awaited<ReturnType<typeof setMediaMark>>[] = []
    for (const [index, artworkId] of f.ids.entries()) {
      await setArtworkRating(f.actor.id, artworkId, 1)
      marks.push(await setMediaMark(f.actor.id, artworkId, f.images[index]!.id, 'bookmark', true))
    }
    await db!.$transaction((tx) =>
      saveArtworkDedupReview(tx, {
        userId: f.actor.id,
        runId: f.run.id,
        groupId: f.groupIds[0]!,
        keeperArtworkId: f.ids[0]!,
        expectedRunVersion: 1,
        expectedReviewVersion: 0,
        idempotencyKey: randomUUID()
      })
    )
    const { operation } = await db!.$transaction((tx) =>
      freezeArtworkDedupOperation(tx, {
        userId: f.actor.id,
        idempotencyKey: randomUUID(),
        runId: f.run.id,
        expectedRunVersion: 1,
        expectedReviewRevision: 1,
        selection: { kind: 'EXPLICIT', groupIds: f.groupIds }
      })
    )
    opIds.push(operation.id)
    // Only the App boundary is under test; the claim acquisition protocol has its own real-PG suite.
    await db!.artworkDedupClaim.createMany({
      data: f.ids.map((artworkId, index) => ({
        artworkId,
        operationId: operation.id,
        role: index === 0 ? 'KEEPER' : 'COPY',
        executionVersion: 1
      }))
    })
    const beforeRatings = await db!.artworkLike.findMany({
      where: { artworkId: { in: f.ids } },
      orderBy: { artworkId: 'asc' }
    })
    const beforeMarks = await db!.mediaMark.findMany({
      where: { artworkId: { in: f.ids } },
      orderBy: { artworkId: 'asc' }
    })
    for (const [index, artworkId] of f.ids.entries()) {
      for (const action of [
        () => setArtworkRating(f.actor.id, artworkId, 4),
        () => setArtworkRating(f.actor.id, artworkId, null),
        () => setMediaMark(f.actor.id, artworkId, f.images[index]!.id, 'like', true),
        () => setMediaMark(f.actor.id, artworkId, f.images[index]!.id, 'bookmark', false),
        () => removeMediaMark(f.actor.id, marks[index]!.markId!, 'bookmark')
      ])
        {await expect(action()).rejects.toMatchObject({ code: 'CONFLICT', message: '作品正在维护，请稍后重试。' })}
    }
    for (const action of reading(f, 1)) await expect(action()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.artworkReadingSummary.count({ where: { artworkId: f.ids[1] } })).toBe(0)
    expect(await db!.artworkReadMedia.count({ where: { artworkId: f.ids[1] } })).toBe(0)
    expect(
      await db!.artworkLike.findMany({ where: { artworkId: { in: f.ids } }, orderBy: { artworkId: 'asc' } })
    ).toEqual(beforeRatings)
    expect(
      await db!.mediaMark.findMany({ where: { artworkId: { in: f.ids } }, orderBy: { artworkId: 'asc' } })
    ).toEqual(beforeMarks)
    for (const action of reading(f, 0)) await expect(action()).resolves.toBeDefined()
    expect(
      await db!.artworkReadingSummary.findUnique({
        where: { userId_artworkId: { userId: f.actor.id, artworkId: f.ids[0]! } }
      })
    ).toMatchObject({ viewCount: 1, seenCount: 1 })
  })
  it('keeps unclaimed writes and account scoping unchanged', async () => {
    const f = await fixture(),
      artworkId = f.ids[0]!,
      imageId = f.images[0]!.id
    await setArtworkRating(f.actor.id, artworkId, 1)
    await setArtworkRating(f.other.id, artworkId, 4)
    await setArtworkRating(f.actor.id, artworkId, null)
    expect(await db!.artworkLike.findMany({ where: { artworkId } })).toMatchObject([{ userId: f.other.id, level: 4 }])
    const mark = await setMediaMark(f.actor.id, artworkId, imageId, 'bookmark', true)
    await removeMediaMark(f.other.id, mark.markId!, 'bookmark')
    expect(await db!.mediaMark.count({ where: { id: mark.markId! } })).toBe(1)
    await removeMediaMark(f.actor.id, mark.markId!, 'bookmark')
    expect(await db!.mediaMark.count({ where: { id: mark.markId! } })).toBe(0)
    for (const action of reading(f, 0)) await expect(action()).resolves.toBeDefined()
  })
})
