import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lockMock, state, tx } = vi.hoisted(() => {
  const state = {
    summary: null as null | Record<string, unknown>,
    seen: [] as number[],
    media: [
      { id: 1, path: '/a.apng', mediaType: 'ANIMATION' },
      { id: 2, path: '/a.webm', mediaType: 'VIDEO' },
      { id: 3, path: '/b.jpg', mediaType: 'IMAGE' }
    ]
  }
  const tx = {
    artwork: { findUnique: vi.fn(async () => ({ deletedAt: null, archiveLifecycleState: 'ACTIVE' })) },
    image: { findMany: vi.fn(async () => state.media) },
    artworkReadingSummary: {
      findUnique: vi.fn(async () => state.summary),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.summary = { ...state.summary, ...data, stateVersion: Number(state.summary?.stateVersion ?? 0) + 1 }
        return state.summary
      }),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.summary = state.summary ? { ...state.summary, ...update, stateVersion: Number(state.summary.stateVersion ?? 0) + 1 } : { viewCount: 0, lastMediaId: null, lastMediaIndex: null, ...create }
        return state.summary
      })
    },
    artworkReadMedia: {
      findMany: vi.fn(async () => state.seen.map((mediaId) => ({ mediaId }))),
      createMany: vi.fn(async ({ data }: { data: Array<{ mediaId: number }> }) => {
        state.seen = [...new Set([...state.seen, ...data.map(({ mediaId }) => mediaId)])]
        return { count: data.length }
      })
    }
  }
  return { lockMock: vi.fn(), state, tx }
})

vi.mock('server-only', () => ({}))
vi.mock('@pixishelf/db', () => ({ lockArtworkForReading: lockMock }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) } }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsByIds: vi.fn() }))

import { getReadingContext, reportReading, markReadingRead } from '../reading-service'

const NOW = new Date('2026-09-24T12:00:00.000Z')
function event(type: 'VIEW' | 'HEARTBEAT', mediaId = 2, at = NOW) {
  return { type, mediaId, observedAt: at.toISOString() }
}
function input(events: ReturnType<typeof event>[], mediaRevision = 1) {
  return { artworkId: 10, expectedUserId: 'user-1', mediaRevision, events }
}

describe('reading service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    state.summary = null
    state.seen = []
    state.media = [
      { id: 1, path: '/a.apng', mediaType: 'ANIMATION' },
      { id: 2, path: '/a.webm', mediaType: 'VIDEO' },
      { id: 3, path: '/b.jpg', mediaType: 'IMAGE' }
    ]
    lockMock.mockReset().mockResolvedValue({ id: 10, mediaRevision: 1 })
    for (const delegate of [tx.artwork, tx.image, tx.artworkReadingSummary, tx.artworkReadMedia]) {
      for (const method of Object.values(delegate)) method.mockClear()
    }
  })

  it('initializes logical mapping without creating a visit or seen media', async () => {
    const result = await getReadingContext('user-1', 10)
    expect(result.media).toEqual([
      { mediaId: 2, memberMediaIds: [2, 1], index: 0 },
      { mediaId: 3, memberMediaIds: [3], index: 1 }
    ])
    expect(result.summary).toMatchObject({ status: 'UNREAD', viewCount: 0, totalCount: 2 })
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()
    expect(tx.artworkReadMedia.createMany).not.toHaveBeenCalled()
  })

  it('counts one visit and all group members, then merges a repeat observation', async () => {
    const first = await reportReading('user-1', input([event('VIEW')]))
    expect(first.summary).toMatchObject({ viewCount: 1, seenCount: 1, totalCount: 2, status: 'IN_PROGRESS', lastMediaId: 2 })
    expect(state.seen).toEqual([2, 1])
    const second = await reportReading('user-1', input([event('VIEW', 1)]))
    expect(second.summary.viewCount).toBe(1)
    expect(second.summary.seenCount).toBe(1)
  })

  it('merges a late device observation without moving activity time backwards or reopening the visit', async () => {
    const firstAt = new Date(NOW.getTime() - 1_000)
    const lateAt = new Date(NOW.getTime() - 2_000)
    const first = await reportReading('user-1', input([event('VIEW', 2, firstAt)]))
    expect(first.summary).toMatchObject({ viewCount: 1, seenCount: 1, lastMediaId: 2 })

    const late = await reportReading('user-1', input([event('VIEW', 3, lateAt)]))
    expect(late.summary).toMatchObject({ viewCount: 1, seenCount: 2, totalCount: 2, lastMediaId: 3, lastMediaIndex: 1 })
    expect(late.summary.lastActiveAt).toBe(firstAt.toISOString())
    expect(late.summary.lastViewedAt).toBe(firstAt.toISOString())
    expect(state.seen).toEqual([2, 1, 3])

    const repeated = await reportReading('user-1', input([event('VIEW', 3, lateAt)]))
    expect(repeated.summary.viewCount).toBe(1)
    expect(repeated.summary.seenCount).toBe(2)
  })

  it('does not create or reopen a visit from a heartbeat', async () => {
    const empty = await reportReading('user-1', input([event('HEARTBEAT')]))
    expect(empty.summary.viewCount).toBe(0)
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()

    await reportReading('user-1', input([event('VIEW')]))
    const before = tx.artworkReadingSummary.upsert.mock.calls.length
    vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000))
    const stale = await reportReading('user-1', input([event('HEARTBEAT', 2, new Date())]))
    expect(stale.summary.viewCount).toBe(1)
    expect(tx.artworkReadingSummary.upsert).toHaveBeenCalledTimes(before)
  })

  it('starts a new visit after 30 minutes and completes by distinct logical groups', async () => {
    await reportReading('user-1', input([event('VIEW')]))
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000))
    const result = await reportReading('user-1', input([event('VIEW', 3, new Date())]))
    expect(result.summary).toMatchObject({ viewCount: 2, seenCount: 2, totalCount: 2, status: 'COMPLETED', lastMediaId: 3, lastMediaIndex: 1 })
    expect(state.seen).toEqual([2, 1, 3])
  })

  it('keeps a visit active across devices without overwriting the last viewed position', async () => {
    await reportReading('user-1', input([event('VIEW', 2)]))
    vi.setSystemTime(new Date(NOW.getTime() + 20_000))
    await reportReading('user-1', input([event('VIEW', 3, new Date())]))
    for (let minute = 1; minute <= 31; minute++) {
      vi.setSystemTime(new Date(NOW.getTime() + minute * 60_000))
      const heartbeat = await reportReading('user-1', input([event('HEARTBEAT', 2, new Date())]))
      expect(heartbeat.summary).toMatchObject({ viewCount: 1, lastMediaId: 3, lastActiveAt: new Date().toISOString() })
    }
    const next = await reportReading('user-1', input([event('VIEW', 2, new Date())]))
    expect(next.summary.viewCount).toBe(1)
  })

  it('does not accept heartbeats for media without an effective view', async () => {
    const first = await reportReading('user-1', input([event('VIEW', 2)]))
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    const result = await reportReading('user-1', input([event('HEARTBEAT', 3, new Date())]))
    expect(result.summary).toEqual(first.summary)
  })

  it('reconciles ordinary media changes and resumes from the first unseen item when the last item vanished', async () => {
    await reportReading('user-1', input([event('VIEW')]))
    state.media = [
      { id: 1, path: '/a.apng', mediaType: 'ANIMATION' },
      { id: 3, path: '/b.jpg', mediaType: 'IMAGE' }
    ]
    const context = await getReadingContext('user-1', 10)
    expect(context.summary).toMatchObject({ viewCount: 1, seenCount: 1, totalCount: 2, lastMediaId: null, lastMediaIndex: null })
    expect(context.resume).toEqual({ mediaId: 3, index: 1 })
    expect(tx.artworkReadingSummary.update).toHaveBeenCalledOnce()
  })

  it('drops deleted media events while accepting surviving media in the same batch', async () => {
    state.media = state.media.filter(({ id }) => id !== 3)
    const result = await reportReading('user-1', input([event('VIEW', 3), event('VIEW', 2)]))
    expect(result.summary).toMatchObject({ viewCount: 1, seenCount: 1, totalCount: 1, lastMediaId: 2 })
    expect(state.seen).toEqual([2, 1])
  })

  it('returns the current summary without activity when every media event is invalid', async () => {
    const empty = await reportReading('user-1', input([event('VIEW', 99)]))
    expect(empty.summary).toMatchObject({ status: 'UNREAD', viewCount: 0, seenCount: 0 })
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()
    expect(tx.artworkReadMedia.createMany).not.toHaveBeenCalled()

    const first = await reportReading('user-1', input([event('VIEW', 2)]))
    const writes = tx.artworkReadingSummary.upsert.mock.calls.length
    const invalid = await reportReading('user-1', input([event('VIEW', 99)]))
    expect(invalid.summary).toEqual(first.summary)
    expect(tx.artworkReadingSummary.upsert).toHaveBeenCalledTimes(writes)
  })

  it('rejects stale batches and old revisions without a write', async () => {
    await expect(reportReading('user-1', input([event('VIEW', 2, new Date(NOW.getTime() - 60_001))]))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(reportReading('user-1', input([event('VIEW')], 0))).rejects.toMatchObject({ code: 'CONFLICT', message: 'READING_MEDIA_REVISION_CONFLICT' })
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()
    expect(tx.artworkReadMedia.createMany).not.toHaveBeenCalled()
  })
  const mark = (target: { kind: 'ALL' } | { kind: 'MEDIA'; mediaId: number } = { kind: 'ALL' }) =>
    markReadingRead('user-1', { artworkId: 10, expectedUserId: 'user-1', mediaRevision: 1, target })

  it('marks a logical group without inventing a visit, timestamps, or a resume position', async () => {
    const first = await mark({ kind: 'MEDIA', mediaId: 1 })
    expect(first.seenMediaIds).toEqual([2])
    expect(first.summary).toMatchObject({ status: 'IN_PROGRESS', stateVersion: 1, viewCount: 0,
      seenCount: 1, totalCount: 2, lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null })
    expect(state.seen).toEqual([2, 1])
    const complete = await mark()
    expect(complete.summary).toMatchObject({ status: 'COMPLETED', stateVersion: 2, viewCount: 0, seenCount: 2 })
    expect(await mark()).toEqual(complete)
    expect(tx.artworkReadingSummary.upsert).toHaveBeenCalledTimes(2)
    const visit = await reportReading('user-1', input([event('VIEW', 3)]))
    expect(visit.summary).toMatchObject({ viewCount: 1, seenCount: 2, lastMediaId: 3 })
  })

  it('manual completion preserves existing activity and later appended media remains unread', async () => {
    const before = await reportReading('user-1', input([event('VIEW', 2)]))
    const completed = await mark()
    expect(completed.summary).toMatchObject({ viewCount: before.summary.viewCount,
      lastViewedAt: before.summary.lastViewedAt, lastActiveAt: before.summary.lastActiveAt,
      lastMediaId: before.summary.lastMediaId, lastMediaIndex: before.summary.lastMediaIndex })
    state.media.push({ id: 4, path: '/c.jpg', mediaType: 'IMAGE' })
    const after = await getReadingContext('user-1', 10)
    expect(after.summary).toMatchObject({ status: 'IN_PROGRESS', seenCount: 2, totalCount: 3 })
    expect(after.seenMediaIds).toEqual([2, 3])
    expect(after.summary.stateVersion).toBeGreaterThan(completed.summary.stateVersion)
  })

  it('rejects unrelated media and stale manual requests before writing', async () => {
    await expect(mark({ kind: 'MEDIA', mediaId: 999 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    lockMock.mockResolvedValue({ id: 10, mediaRevision: 2 })
    await expect(mark()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tx.artworkReadMedia.createMany).not.toHaveBeenCalled()
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()
  })

  it('does not complete an empty artwork or write a manual visit', async () => {
    state.media = []
    const result = await mark()
    expect(result.summary).toMatchObject({ status: 'UNREAD', viewCount: 0, totalCount: 0, stateVersion: 0 })
    expect(result.seenMediaIds).toEqual([])
    expect(tx.artworkReadingSummary.upsert).not.toHaveBeenCalled()
  })

})
