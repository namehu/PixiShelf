import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({ getMediaMarks: vi.fn(), setMediaMark: vi.fn(), listMediaMarks: vi.fn(), removeMediaMark: vi.fn() }))
vi.mock('@/services/media-mark-service', () => service)
import { mediaMarkRouter } from '../media-mark'

const unauthorized = { headers: new Headers(), user: null, session: null, userId: null }
const authorized = { headers: new Headers(), user: { id: 'alice' }, session: { id: 'session-1' }, userId: 'alice' }
const state = { markId: 'mark-1', artworkId: 7, mediaId: 8, bookmarkedAt: '2026-10-22T12:00:00.000Z', likedAt: null, available: true }

describe('media marks account boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    service.getMediaMarks.mockResolvedValue({ items: [state] })
    service.setMediaMark.mockResolvedValue(state)
    service.listMediaMarks.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 24 })
    service.removeMediaMark.mockResolvedValue({ success: true })
  })

  it('rejects unauthenticated and switched-account reads and writes before service access', async () => {
    for (const [ctx, expectedUserId, code] of [[unauthorized, 'alice', 'UNAUTHORIZED'], [authorized, 'bob', 'FORBIDDEN']] as const) {
      const caller = mediaMarkRouter.createCaller(ctx as never)
      await expect(caller.getMany({ artworkId: 7, mediaIds: [8], expectedUserId })).rejects.toMatchObject({ code })
      await expect(caller.set({ artworkId: 7, mediaId: 8, expectedUserId, kind: 'bookmark', value: true })).rejects.toMatchObject({ code })
      await expect(caller.list({ expectedUserId, kind: 'like', page: 1 })).rejects.toMatchObject({ code })
      await expect(caller.remove({ expectedUserId, markId: 'mark-1', kind: 'like' })).rejects.toMatchObject({ code })
    }
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })

  it('uses the Session account for all calls and explicit absolute values for set', async () => {
    const caller = mediaMarkRouter.createCaller(authorized as never)
    await caller.getMany({ expectedUserId: 'alice', artworkId: 7, mediaIds: [8] })
    await caller.set({ expectedUserId: 'alice', artworkId: 7, mediaId: 8, kind: 'like', value: false })
    await caller.list({ expectedUserId: 'alice', kind: 'bookmark' })
    await caller.remove({ expectedUserId: 'alice', markId: 'mark-1', kind: 'bookmark' })
    expect(service.getMediaMarks).toHaveBeenCalledExactlyOnceWith('alice', 7, [8])
    expect(service.setMediaMark).toHaveBeenCalledExactlyOnceWith('alice', 7, 8, 'like', false)
    expect(service.listMediaMarks).toHaveBeenCalledExactlyOnceWith('alice', 'bookmark', 1)
    expect(service.removeMediaMark).toHaveBeenCalledExactlyOnceWith('alice', 'mark-1', 'bookmark')
  })

  it('bounds hydration and rejects invalid target, kind, boolean, and page', async () => {
    const caller = mediaMarkRouter.createCaller(authorized as never)
    await expect(caller.getMany({ expectedUserId: 'alice', artworkId: 7, mediaIds: Array(201).fill(8) })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    for (const invalid of [{ mediaId: 0 }, { kind: 'rating' }, { value: 'true' }]) {
      await expect(caller.set({ expectedUserId: 'alice', artworkId: 7, mediaId: 8, kind: 'like', value: true, ...invalid } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
    await expect(caller.list({ expectedUserId: 'alice', kind: 'like', page: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled()
  })
})
