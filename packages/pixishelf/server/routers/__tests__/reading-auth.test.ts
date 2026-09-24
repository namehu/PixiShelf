import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  getReadingContext: vi.fn(),
  reportReading: vi.fn(),
  getReadingSummaries: vi.fn(),
  getReadingHistory: vi.fn()
}))
const listService = vi.hoisted(() => ({ getArtworksList: vi.fn(), getArtworkCardsPage: vi.fn(), getViewerFeed: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/services/reading-service', () => service)
vi.mock('@/services/artwork-service', () => listService)

import { readingRouter } from '../reading'
import { artworkRouter } from '../artwork'

const headers = new Headers()
const unauthorized = { headers, user: null, session: null, userId: null }
const authorized = {
  headers,
  user: { id: 'user-1' },
  session: { id: 'session-1' },
  userId: 'user-1'
}

describe('reading router session ownership', () => {
  beforeEach(() => Object.values(service).forEach((mock) => mock.mockReset()))

  it('rejects all unauthenticated reads and writes before reaching the service', async () => {
    const caller = readingRouter.createCaller(unauthorized as never)
    await expect(caller.context({ artworkId: 10, expectedUserId: 'user-1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.report({ artworkId: 10, expectedUserId: 'user-1', mediaRevision: 1, events: [{ type: 'VIEW', mediaId: 1, observedAt: '2026-09-24T12:00:00.000Z' }] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.summaries({ artworkIds: [10], expectedUserId: 'user-1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.history({ expectedUserId: 'user-1' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(Object.values(service).every((mock) => mock.mock.calls.length === 0)).toBe(true)
  })

  it('rejects a switched account for all procedures before reading or writing', async () => {
    const caller = readingRouter.createCaller(authorized as never)
    await expect(caller.context({ artworkId: 10, expectedUserId: 'user-2' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.report({ artworkId: 10, expectedUserId: 'user-2', mediaRevision: 1, events: [{ type: 'VIEW', mediaId: 1, observedAt: '2026-09-24T12:00:00.000Z' }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.summaries({ artworkIds: [10], expectedUserId: 'user-2' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.history({ expectedUserId: 'user-2' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(Object.values(service).every((mock) => mock.mock.calls.length === 0)).toBe(true)
  })

  it('always passes authenticated user ID to the service', async () => {
    service.getReadingSummaries.mockResolvedValue({ summaries: [] })
    await readingRouter.createCaller(authorized as never).summaries({ artworkIds: [10], expectedUserId: 'user-1' })
    expect(service.getReadingSummaries).toHaveBeenCalledWith('user-1', [10])
  })

  it('requires a matching account precondition on all reading filtered artwork lists', async () => {
    const caller = artworkRouter.createCaller(authorized as never)
    for (const method of ['list', 'cardList', 'viewerFeed'] as const) {
      await expect(caller[method]({ readingStatus: 'UNREAD' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(caller[method]({ readingStatus: 'UNREAD', expectedUserId: 'user-2' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(Object.values(listService).every((mock) => mock.mock.calls.length === 0)).toBe(true)

    listService.getArtworkCardsPage.mockResolvedValue({ items: [], hasNextPage: false, pageSize: 24 })
    await expect(caller.cardList({ readingStatus: 'UNREAD', expectedUserId: 'user-1' })).resolves.toMatchObject({ items: [] })
    expect(listService.getArtworkCardsPage).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: 'user-1' }), 'user-1')
  })
})
