// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  PrismaClient,
  invalidateArtworkReadingForRebuild,
  lockArtworkForReading,
  readArtworkReadingLayout,
  refreshArtworkReadingLayout
} from '@pixishelf/db'
import { groupLogicalMedia } from '@pixishelf/job-contracts'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
const databaseUrl = process.env.READING_VALIDATION_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    url.pathname !== '/pixishelf_reading_position_20261104_runtime'
  ) {
    throw new Error('Requires isolated reading-position runtime database')
  }
}
const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.prisma
  }
}))
import {
  getReadingContext,
  getReadingSummaries,
  getContinueReading,
  getReadingHistory,
  reportReading,
  markReadingRead
} from '@/services/reading-service'
import { queryReadingArtworkIdsPage } from '@/services/artwork-service/reading-page-query'
const token = `reading-position-${randomUUID()}`
const users = [`${token}-a`, `${token}-b`]
async function work(label: string, count: number) {
  return db!.artwork.create({
    data: {
      title: `${token}-${label}`,
      storageKey: `${token}-${label}`,
      logicalMediaCount: count,
      images: {
        create: Array.from({ length: count }, (_, index) => ({
          path: `${token}/${label}/${index}.jpg`,
          sortOrder: index,
          mediaType: 'IMAGE' as const
        }))
      }
    },
    include: { images: { orderBy: { sortOrder: 'asc' } } }
  })
}
function input(artworkId: number, mediaId: number, index: number, extra = {}) {
  return {
    artworkId,
    expectedUserId: users[0]!,
    readingLayoutVersion: 1,
    events: [{ type: 'VIEW' as const, mediaId, index, observedAt: new Date().toISOString(), ...extra }]
  }
}
describe.skipIf(!databaseUrl).sequential('reading positions with isolated PostgreSQL', () => {
  beforeAll(async () => {
    context.prisma = db
    await db!.userBA.createMany({ data: users.map((id) => ({ id })) })
  })
  afterAll(async () => {
    if (!db) return
    await db.image.deleteMany({ where: { artwork: { storageKey: { startsWith: token } } } })
    await db.artwork.deleteMany({ where: { storageKey: { startsWith: token } } })
    await db.userBA.deleteMany({ where: { id: { in: users } } })
    await db.$disconnect()
  })
  it('persists one prefix row per account and keeps report results independent of media IDs', async () => {
    const a = await work('prefix', 100)
    const first = await reportReading(users[0]!, input(a.id, a.images[79]!.id, 79))
    expect(first.summary).toMatchObject({ progressCount: 80, completed: false, viewCount: 1 })
    expect(Object.keys(first).sort()).toEqual(['readingLayoutVersion', 'summary'])
    expect(await db!.artworkReadingProgress.count({ where: { artworkId: a.id } })).toBe(1)
    const back = await reportReading(users[0]!, input(a.id, a.images[2]!.id, 2))
    expect(back.summary).toMatchObject({ progressCount: 80, lastMediaIndex: 2, furthestMediaIndex: 79 })
    expect((await getReadingSummaries(users[1]!, [a.id])).summaries[0]).toMatchObject({
      progressCount: 0,
      viewCount: 0
    })
    expect((await getReadingContext(users[0]!, a.id)).resume?.index).toBe(2)
  })
  it('advances static stacks to the tail while retaining the observed position', async () => {
    const a = await work('stack', 8)
    const result = await reportReading(
      users[0]!,
      input(a.id, a.images[1]!.id, 1, { advanceTo: { mediaId: a.images[6]!.id, index: 6 } })
    )
    expect(result.summary).toMatchObject({ progressCount: 7, lastMediaIndex: 1, furthestMediaIndex: 6 })
  })
  it('guards grouped APNG posters, actual video playback, ownership and layout versions', async () => {
    const a = await work('video', 0)
    const apng = await db!.image.create({
      data: { artworkId: a.id, path: `${token}/video/same.apng`, mediaType: 'ANIMATION' }
    })
    const video = await db!.image.create({
      data: { artworkId: a.id, path: `${token}/other/same.mp4`, mediaType: 'VIDEO', sortOrder: 1 }
    })
    await db!.artwork.update({ where: { id: a.id }, data: { logicalMediaCount: 1 } })
    const playback = (currentTime: number) => ({ playback: { currentTime, duration: 100 } })
    await expect(reportReading(users[0]!, input(a.id, apng.id, 0, playback(100)))).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect((await reportReading(users[0]!, input(a.id, video.id, 0, playback(0)))).summary).toMatchObject({
      progressCount: 0,
      viewCount: 1,
      completed: false
    })
    expect((await reportReading(users[0]!, input(a.id, video.id, 0, playback(89.99)))).summary.completed).toBe(false)
    expect((await reportReading(users[0]!, input(a.id, video.id, 0, playback(90)))).summary.completed).toBe(true)
    await expect(reportReading(users[1]!, input(a.id, video.id, 0, playback(100)))).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
    await expect(
      reportReading(users[0]!, { ...input(a.id, video.id, 0, playback(100)), readingLayoutVersion: 2 })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it.each([
    ['hidden', '.apng', '.mp4', false],
    ['dotted-directories', 'dot.dir/same.apng', 'other.dir/same.mp4', true],
    ['backslashes', 'one\\same.apng', 'two\\same.mp4', true],
    ['video-query', 'same.apng', 'same.mp4?download=1', true],
    ['apng-query', 'same.apng?download=1', 'same.mp4', false],
    ['case-sensitive-stem', 'SAME.apng', 'same.mp4', false],
    ['hidden-stem', '.same.apng', '.same.mp4', true],
    ['video-classified-apng', 'same.apng', 'same.mp4', false, true]
  ])(
    'keeps APNG report grouping parity for %s',
    async (label, apngPath, videoPath, paired, classifiedVideo = false) => {
      const a = await work(`parity-${label}`, 0)
      const apng = await db!.image.create({
        data: { artworkId: a.id, path: apngPath, mediaType: classifiedVideo ? 'VIDEO' : 'ANIMATION' }
      })
      const video = await db!.image.create({
        data: { artworkId: a.id, path: videoPath, mediaType: 'VIDEO', sortOrder: 1 }
      })
      const logical = groupLogicalMedia([apng, video])
      expect(logical.length).toBe(paired ? 1 : 2)
      await db!.artwork.update({ where: { id: a.id }, data: { logicalMediaCount: logical.length } })
      const pending = reportReading(
        users[0]!,
        input(a.id, apng.id, 0, classifiedVideo ? { playback: { currentTime: 90, duration: 100 } } : {})
      )
      if (paired) await expect(pending).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      else expect((await pending).summary.progressCount).toBe(1)
    }
  )
  it('completion is sticky across append and real activity remains separate from manual completion', async () => {
    const a = await work('sticky', 2)
    await reportReading(users[0]!, input(a.id, a.images[1]!.id, 1))
    await db!.$transaction(async (tx) => {
      await lockArtworkForReading(tx, a.id)
      const old = await readArtworkReadingLayout(tx, a.id)
      await tx.image.create({
        data: { artworkId: a.id, path: `${token}/sticky/2.jpg`, mediaType: 'IMAGE', sortOrder: 2 }
      })
      await refreshArtworkReadingLayout(tx, a.id, old)
    })
    expect((await getReadingContext(users[0]!, a.id)).summary).toMatchObject({
      readingLayoutVersion: 2,
      progressCount: 3,
      completed: true,
      viewCount: 1
    })
    const b = await work('manual', 5)
    const marked = await markReadingRead(users[0]!, {
      artworkId: b.id,
      expectedUserId: users[0]!,
      readingLayoutVersion: 1
    })
    expect(marked.summary).toMatchObject({
      completed: true,
      viewCount: 0,
      lastViewedAt: null,
      lastActiveAt: null,
      lastMediaId: null,
      furthestMediaId: null
    })
    expect((await getReadingHistory(users[0]!, 100)).items.some((item) => item.artwork.id === b.id)).toBe(false)
    expect((await getContinueReading(users[0]!)).items.some((item) => item.artwork.id === b.id)).toBe(false)
  })
  it('filters account status by explicit completion with no 90 percent artwork threshold', async () => {
    const a = await work('threshold', 10)
    await reportReading(users[0]!, input(a.id, a.images[8]!.id, 8))
    const page = await queryReadingArtworkIdsPage(
      ArtworksInfiniteQuerySchema.parse({
        searchText: token,
        readingStatuses: ['IN_PROGRESS'],
        expectedUserId: users[0]!,
        pageSize: 100
      }),
      users[0]!
    )
    expect(page.ids).toContain(a.id)
    const done = await queryReadingArtworkIdsPage(
      ArtworksInfiniteQuerySchema.parse({
        searchText: token,
        readingStatuses: ['COMPLETED'],
        expectedUserId: users[0]!,
        pageSize: 100
      }),
      users[0]!
    )
    expect(done.ids).not.toContain(a.id)
  })
  it('relocates deletion anchors and maps representatives via surviving group members', async () => {
    const a = await work('relocate', 4)
    await reportReading(users[0]!, input(a.id, a.images[2]!.id, 2))
    await db!.$transaction(async (tx) => {
      await lockArtworkForReading(tx, a.id)
      const old = await readArtworkReadingLayout(tx, a.id)
      await tx.image.delete({ where: { id: a.images[2]!.id } })
      await refreshArtworkReadingLayout(tx, a.id, old)
    })
    expect((await getReadingContext(users[0]!, a.id)).summary).toMatchObject({
      progressCount: 2,
      furthestMediaId: a.images[1]!.id,
      lastMediaId: a.images[1]!.id
    })
  })
  it.each(['reorder', 'delete-tail'])(
    'completes an unfinished prefix relocated to the new last item after %s',
    async (change) => {
      const a = await work(`complete-layout-${change}`, 3)
      await reportReading(users[0]!, input(a.id, a.images[1]!.id, 1))
      await db!.$transaction(async (tx) => {
        await lockArtworkForReading(tx, a.id)
        const old = await readArtworkReadingLayout(tx, a.id)
        if (change === 'reorder') await tx.image.update({ where: { id: a.images[1]!.id }, data: { sortOrder: 3 } })
        else await tx.image.delete({ where: { id: a.images[2]!.id } })
        await refreshArtworkReadingLayout(tx, a.id, old)
      })
      expect((await getReadingContext(users[0]!, a.id)).summary.completed).toBe(true)
      expect((await getContinueReading(users[0]!)).items.some((item) => item.artwork.id === a.id)).toBe(false)
    }
  )
  it('full rebuild resets every account and versions atomically; rollback restores all state', async () => {
    const a = await work('rebuild', 3)
    for (const user of users) {
      await markReadingRead(user, { artworkId: a.id, expectedUserId: user, readingLayoutVersion: 1 })
    }
    await expect(
      db!.$transaction(async (tx) => {
        await invalidateArtworkReadingForRebuild(tx, a.id)
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    expect(await db!.artworkReadingProgress.count({ where: { artworkId: a.id } })).toBe(2)
    await db!.$transaction(async (tx) => {
      await invalidateArtworkReadingForRebuild(tx, a.id)
      await refreshArtworkReadingLayout(tx, a.id, [], false)
    })
    expect(await db!.artworkReadingProgress.count({ where: { artworkId: a.id } })).toBe(0)
    expect((await getReadingContext(users[0]!, a.id)).summary).toMatchObject({
      readingLayoutVersion: 2,
      progressCount: 0,
      completed: false,
      totalCount: 3,
      viewCount: 0
    })
  })
})
