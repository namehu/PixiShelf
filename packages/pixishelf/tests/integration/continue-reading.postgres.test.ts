// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'

// Never fall back to DATABASE_URL or an application environment file.
const url = process.env.CONTINUE_READING_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55435' || target.pathname !== '/continue_reading_verification') {
    throw new Error('Requires isolated 127.0.0.1:55435/continue_reading_verification database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : undefined
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return context.db } }))
import { getContinueReading, markReadingRead, reportReading } from '@/services/reading-service'

const prefix = `continue-${randomUUID()}`
const user = `${prefix}-a`
const other = `${prefix}-b`
const empty = `${prefix}-empty`
const recent = new Date(Date.now() - 10_000)
const candidates: number[] = []
const excluded: number[] = []
let artistId: number
let videoId: number
let manualId: number

async function createWork(label: string, count = 4, video = false) {
  return db!.artwork.create({ data: {
    title: `${prefix} ${label}`, storageKey: `${prefix}-${label}`, artistId, source: 'LOCAL_IMPORT',
    images: { create: Array.from({ length: count }, (_, index) => ({
      path: `/${prefix}/${label}/${index}.${video ? 'mp4' : 'png'}`, sortOrder: index,
      mediaType: video ? 'VIDEO' as const : 'IMAGE' as const
    })) }
  }, include: { images: { orderBy: { sortOrder: 'asc' } } } })
}

const ids = (result: Awaited<ReturnType<typeof getContinueReading>>) => result.items.map((item) => item.artwork.id)

describe.skipIf(!url).sequential('home continuation with isolated PostgreSQL', () => {
  beforeAll(async () => {
    context.db = db
    await db!.userBA.createMany({ data: [user, other, empty].map((id) => ({ id })) })
    artistId = (await db!.artist.create({ data: { name: prefix } })).id
    for (let index = 0; index < 8; index++) {
      const artwork = await createWork(`candidate-${index}`)
      candidates.push(artwork.id)
      const at = new Date(recent.getTime() + Math.floor(index / 2) * 1000)
      await db!.artworkReadingSummary.create({ data: {
        userId: user, artworkId: artwork.id, viewCount: 1, seenCount: 1, totalCount: 4,
        lastViewedAt: at, lastActiveAt: at, lastMediaId: artwork.images[0]!.id, lastMediaIndex: 0
      } })
      await db!.artworkReadMedia.create({ data: { userId: user, artworkId: artwork.id, mediaId: artwork.images[0]!.id } })
    }
    // More recent completed records must not consume the six SQL candidate slots.
    for (let index = 0; index < 8; index++) {
      const artwork = await createWork(`completed-${index}`)
      excluded.push(artwork.id)
      await db!.artworkReadingSummary.create({ data: {
        userId: user, artworkId: artwork.id, viewCount: 1, seenCount: 4, totalCount: 4,
        lastViewedAt: new Date(), lastActiveAt: new Date()
      } })
    }
    const manual = await createWork('manual-partial')
    manualId = manual.id
    excluded.push(manual.id)
    await markReadingRead(user, { expectedUserId: user, artworkId: manual.id, mediaRevision: 1,
      target: { kind: 'MEDIA', mediaId: manual.images[0]!.id } })
    const defaults = await createWork('default-completed')
    excluded.push(defaults.id)
    await markReadingRead(user, { expectedUserId: user, artworkId: defaults.id, mediaRevision: 1, target: { kind: 'ALL' } })
    for (const label of ['zero', 'deleted', 'trashed', 'missing-date']) {
      const artwork = await createWork(label, label === 'zero' ? 0 : 4)
      excluded.push(artwork.id)
      if (label === 'deleted') await db!.artwork.update({ where: { id: artwork.id }, data: { deletedAt: new Date() } })
      if (label === 'trashed') await db!.artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'TRASHED' } })
      await db!.artworkReadingSummary.create({ data: {
        userId: user, artworkId: artwork.id, viewCount: 1, seenCount: 0, totalCount: label === 'zero' ? 0 : 4,
        lastViewedAt: label === 'missing-date' ? null : new Date(), lastActiveAt: new Date()
      } })
    }
    const video = await createWork('started-video', 1, true)
    videoId = video.id
    await reportReading(user, { expectedUserId: user, artworkId: video.id, mediaRevision: 1, events: [{
      type: 'VIEW', mediaId: video.images[0]!.id, observedAt: new Date().toISOString(), playback: { currentTime: 1, duration: 100 }
    }] })
    await db!.artworkReadingSummary.create({ data: {
      userId: other, artworkId: candidates[0]!, viewCount: 2, seenCount: 2, totalCount: 4,
      lastViewedAt: new Date(), lastActiveAt: new Date()
    } })
  }, 30_000)

  afterAll(async () => {
    if (!db) return
    try {
      await db.artwork.deleteMany({ where: { storageKey: { startsWith: prefix } } })
      await db.artist.deleteMany({ where: { name: prefix } })
      await db.userBA.deleteMany({ where: { id: { in: [user, other, empty] } } })
    } finally { await db.$disconnect() }
  })

  it('filters before limiting and deterministically breaks last-viewed ties by artwork ID', async () => {
    const expected = [videoId, ...[...candidates].reverse()].slice(0, 6)
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await getContinueReading(user)
      expect(ids(result)).toEqual(expected)
      expect(result.items).toHaveLength(6)
      expect(result.items.every((item) => !excluded.includes(item.artwork.id))).toBe(true)
      expect(result.items.every((item) => item.artwork.images.length === 1)).toBe(true)
    }
  })

  it('includes real video activity with zero seen media but excludes manual/default progress', async () => {
    const result = await getContinueReading(user)
    expect(result.items.find((item) => item.artwork.id === videoId)?.reading).toMatchObject({
      viewCount: 1, seenCount: 0, totalCount: 1, status: 'IN_PROGRESS'
    })
    expect(await db!.artworkReadingSummary.findUnique({ where: { userId_artworkId: { userId: user, artworkId: manualId } } }))
      .toMatchObject({ viewCount: 0, seenCount: 1, lastViewedAt: null, lastMediaId: null })
    expect(ids(result)).not.toContain(manualId)
  })

  it('isolates account collections and returns an empty shelf for a new account', async () => {
    expect(ids(await getContinueReading(other))).toEqual([candidates[0]])
    expect(ids(await getContinueReading(empty))).toEqual([])
    expect(ids(await getContinueReading(user))).not.toContain(candidates[0])
  })

  it('drops a newly completed work and fills its slot from older eligible reading', async () => {
    const artworkId = candidates.at(-1)!
    await markReadingRead(user, { expectedUserId: user, artworkId, mediaRevision: 1, target: { kind: 'ALL' } })
    const result = await getContinueReading(user)
    expect(ids(result)).toEqual([videoId, ...[...candidates].reverse().filter((id) => id !== artworkId)].slice(0, 6))
    expect(result.items).toHaveLength(6)
  })
})
