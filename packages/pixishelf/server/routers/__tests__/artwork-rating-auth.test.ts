import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({ getArtworkRating: vi.fn(), setArtworkRating: vi.fn() }))
vi.mock('@/services/artwork-rating-service', () => service)
import { artworkRatingRouter } from '../artwork-rating'

const unauthorized = { headers: new Headers(), user: null, session: null, userId: null }
const authorized = { headers: new Headers(), user: { id: 'alice' }, session: { id: 'session-1' }, userId: 'alice' }
const state = { artworkId: 7, level: 2, isLike: true, updatedAt: '2026-10-22T12:00:00.000Z' }

describe('artwork rating account boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    service.getArtworkRating.mockResolvedValue(state)
    service.setArtworkRating.mockResolvedValue(state)
  })

  it('rejects unauthenticated and switched-account reads/writes before accessing services', async () => {
    for (const [ctx, expectedUserId, code] of [
      [unauthorized, 'alice', 'UNAUTHORIZED'], [authorized, 'bob', 'FORBIDDEN']
    ] as const) {
      const caller = artworkRatingRouter.createCaller(ctx as never)
      await expect(caller.get({ artworkId: 7, expectedUserId })).rejects.toMatchObject({ code })
      await expect(caller.set({ artworkId: 7, expectedUserId, level: 4 })).rejects.toMatchObject({ code })
    }
    expect(service.getArtworkRating).not.toHaveBeenCalled()
    expect(service.setArtworkRating).not.toHaveBeenCalled()
  })

  it('uses session ownership and accepts clearing as an explicit absolute value', async () => {
    const caller = artworkRatingRouter.createCaller(authorized as never)
    await expect(caller.get({ artworkId: 7, expectedUserId: 'alice' })).resolves.toEqual(state)
    expect(service.getArtworkRating).toHaveBeenCalledExactlyOnceWith('alice', 7)
    service.setArtworkRating.mockResolvedValue({ artworkId: 7, level: null, isLike: false, updatedAt: null })
    await expect(caller.set({ artworkId: 7, expectedUserId: 'alice', level: null })).resolves.toMatchObject({ level: null })
    expect(service.setArtworkRating).toHaveBeenCalledExactlyOnceWith('alice', 7, null)
  })

  it.each([0, 5, 1.5, '2', undefined])('rejects invalid level %j before writing', async (level) => {
    const caller = artworkRatingRouter.createCaller(authorized as never)
    await expect(caller.set({ artworkId: 7, expectedUserId: 'alice', level } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(service.setArtworkRating).not.toHaveBeenCalled()
  })
})
