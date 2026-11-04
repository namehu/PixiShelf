import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingReportEvent } from '@pixishelf/db/reading-contract'
vi.mock('server-only', () => ({}))
vi.mock('../artwork-dedup-write-guard', () => ({ assertArtworkDedupAppWrite: vi.fn() }))
const { lock, state, tx } = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    total: 100,
    images: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      path: `${index}.jpg`,
      mediaType: 'IMAGE',
      webpAnimationStatus: null as number | null
    }))
  }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    artwork: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, archiveLifecycleState: 'ACTIVE' }) },
    image: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: number[] } } }) =>
        state.images.filter((item) => !where.id || where.id.in.includes(item.id))
      )
    },
    artworkReadingProgress: {
      findUnique: vi.fn(async () => state.row),
      upsert: vi.fn(
        async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          state.row = state.row
            ? { ...state.row, ...update, stateVersion: Number(state.row.stateVersion) + 1 }
            : {
                viewCount: 0,
                lastViewedAt: null,
                lastActiveAt: null,
                lastMediaId: null,
                lastMediaIndex: null,
                furthestMediaId: null,
                furthestMediaIndex: null,
                completed: false,
                ...create
              }
          return state.row
        }
      )
    }
  }
  return {
    lock: vi.fn(async () => ({ id: 10, mediaRevision: 1, readingLayoutVersion: 3, logicalMediaCount: state.total })),
    state,
    tx
  }
})
vi.mock('@pixishelf/db', async (original) => ({ ...(await original<object>()), lockArtworkForReading: lock }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsByIds: vi.fn() }))
import { getReadingContext, markReadingRead, reportReading } from '../reading-service'
const NOW = new Date('2026-11-04T10:00:00Z')
function view(index: number, observedAt = NOW): ReadingReportEvent {
  return { type: 'VIEW', mediaId: index + 1, index, observedAt: observedAt.toISOString() }
}
function input(events: ReadingReportEvent[], readingLayoutVersion = 3) {
  return { artworkId: 10, expectedUserId: 'u', readingLayoutVersion, events }
}
describe('position reading service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    state.row = null
    state.total = 100
    state.images = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      path: `${index}.jpg`,
      mediaType: 'IMAGE',
      webpAnimationStatus: null
    }))
    lock.mockImplementation(async () => ({
      id: 10,
      mediaRevision: 1,
      readingLayoutVersion: 3,
      logicalMediaCount: state.total
    }))
  })
  afterEach(() => vi.useRealTimers())
  it('jumping to item 80 records a prefix, then going back only changes the current position', async () => {
    expect((await reportReading('u', input([view(79)]))).summary).toMatchObject({
      progressCount: 80,
      completed: false,
      furthestMediaIndex: 79,
      lastMediaIndex: 79,
      viewCount: 1
    })
    expect((await reportReading('u', input([view(2, new Date(NOW.getTime() + 1))]))).summary).toMatchObject({
      progressCount: 80,
      furthestMediaIndex: 79,
      lastMediaIndex: 2,
      viewCount: 1
    })
    expect(tx.image.findMany).toHaveBeenLastCalledWith({
      where: { artworkId: 10, id: { in: [3] } },
      select: { id: true, path: true, mediaType: true, webpAnimationStatus: true }
    })
  })
  it('90 percent is unfinished; reaching the final item completes and ordinary append remains complete', async () => {
    expect((await reportReading('u', input([view(89)]))).summary.status).toBe('IN_PROGRESS')
    expect((await reportReading('u', input([view(99)]))).summary.completed).toBe(true)
    state.total = 112
    expect((await getReadingContext('u', 10)).summary).toMatchObject({ progressCount: 112, completed: true })
  })
  it('uses the later position within a same-millisecond batch and never rewinds from an older observation', async () => {
    expect((await reportReading('u', input([view(79), view(2)]))).summary).toMatchObject({
      lastMediaIndex: 2,
      furthestMediaIndex: 79
    })
    const result = await reportReading('u', input([view(90, new Date(NOW.getTime() - 1))]))
    expect(result.summary).toMatchObject({ lastMediaIndex: 2, furthestMediaIndex: 90, lastViewedAt: NOW.toISOString() })
  })
  it('starts video activity at playback start and advances only at 90 percent', async () => {
    state.total = 1
    state.images = [{ id: 1, path: 'a.mp4', mediaType: 'VIDEO', webpAnimationStatus: null }]
    const event = view(0)
    expect((await reportReading('u', input([event]))).summary.viewCount).toBe(0)
    expect(
      (await reportReading('u', input([{ ...event, playback: { currentTime: 0, duration: 100 } }]))).summary
    ).toMatchObject({ viewCount: 1, progressCount: 0, completed: false, lastMediaIndex: 0 })
    expect(
      (await reportReading('u', input([{ ...event, playback: { currentTime: 89.99, duration: 100 } }]))).summary
        .completed
    ).toBe(false)
    expect(
      (await reportReading('u', input([{ ...event, playback: { currentTime: 90, duration: 100 } }]))).summary.completed
    ).toBe(true)
  })
  it('keeps the real current position while advancing a static stack tail', async () => {
    const result = await reportReading(
      'u',
      input([{ ...view(2), type: 'VIEW', advanceTo: { mediaId: 80, index: 79 } }])
    )
    expect(result.summary).toMatchObject({ progressCount: 80, lastMediaId: 3, lastMediaIndex: 2, furthestMediaId: 80 })
  })
  it.each(['VIDEO', 'ANIMATION'])('rejects %s stack tails', async (mediaType) => {
    state.images[79]!.mediaType = mediaType
    await expect(
      reportReading('u', input([{ ...view(2), type: 'VIEW', advanceTo: { mediaId: 80, index: 79 } }]))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(tx.artworkReadingProgress.upsert).not.toHaveBeenCalled()
  })
  it('rejects paired APNG posters even when they submit playback', async () => {
    state.images[0]!.path = 'a.apng'
    tx.$queryRaw.mockResolvedValueOnce([{ id: 1 }])
    await expect(
      reportReading('u', input([{ ...view(0), playback: { currentTime: 100, duration: 100 } }]))
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('manual completion never creates visit dates or positions', async () => {
    const result = await markReadingRead('u', { artworkId: 10, expectedUserId: 'u', readingLayoutVersion: 3 })
    expect(result.summary).toMatchObject({
      completed: true,
      progressCount: 100,
      viewCount: 0,
      lastViewedAt: null,
      lastActiveAt: null,
      lastMediaId: null,
      furthestMediaId: null
    })
  })
  it('empty works never auto-complete or manually manufacture reading rows', async () => {
    state.total = 0
    state.images = []
    expect(
      (await markReadingRead('u', { artworkId: 10, expectedUserId: 'u', readingLayoutVersion: 3 })).summary
    ).toMatchObject({ completed: false, totalCount: 0 })
    expect(tx.artworkReadingProgress.upsert).not.toHaveBeenCalled()
  })
  it('heartbeats cannot start visits or alter current positions, and unseen image heartbeats do not extend visits', async () => {
    const hb = (index: number, at: Date): ReadingReportEvent => ({
      type: 'HEARTBEAT',
      mediaId: index + 1,
      index,
      observedAt: at.toISOString()
    })
    expect((await reportReading('u', input([hb(0, NOW)]))).summary.viewCount).toBe(0)
    await reportReading('u', input([view(2)]))
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    expect((await reportReading('u', input([hb(5, new Date())]))).summary.lastActiveAt).toBe(NOW.toISOString())
    expect((await reportReading('u', input([hb(1, new Date())]))).summary).toMatchObject({
      viewCount: 1,
      lastMediaIndex: 2,
      lastActiveAt: new Date().toISOString()
    })
  })
  it('starts a new visit after 30 minutes and rejects events older than 60 seconds', async () => {
    await reportReading('u', input([view(2)]))
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000))
    expect((await reportReading('u', input([view(3, new Date())]))).summary.viewCount).toBe(2)
    await expect(reportReading('u', input([view(4, NOW)]))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('rejects account, layout, ownership and boundary mismatches before writing', async () => {
    await expect(reportReading('other', input([view(0)]))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(reportReading('u', input([view(0)], 2))).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(reportReading('u', input([{ ...view(0), mediaId: 999 }]))).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    await expect(reportReading('u', input([{ ...view(0), index: 100 }]))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(tx.artworkReadingProgress.upsert).not.toHaveBeenCalled()
  })
  it.each([100, 1000, 10000])('fetches only batch anchors for an artwork of %i items', async (total) => {
    state.total = total
    await reportReading('u', input([view(2), view(5)]))
    expect(tx.image.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { artworkId: 10, id: { in: [3, 6] } },
      select: { id: true, path: true, mediaType: true, webpAnimationStatus: true }
    })
    expect(tx.artworkReadingProgress.findUnique).toHaveBeenCalledOnce()
  })
})
