import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ start: vi.fn(), getRun: vi.fn(), control: vi.fn(), listGroups: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/artwork-dedup-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/artwork-dedup-service')>()
  return {
    ...original,
    startArtworkDedup: (...args: Parameters<typeof original.startArtworkDedup>) => {
      original.assertArtworkDedupAccount(args[0], args[1].expectedUserId)
      return mocks.start(...args)
    },
    getArtworkDedupRun: (...args: Parameters<typeof original.getArtworkDedupRun>) => {
      original.assertArtworkDedupAccount(args[0], args[1].expectedUserId)
      return mocks.getRun(...args)
    },
    controlArtworkDedup: (...args: Parameters<typeof original.controlArtworkDedup>) => {
      original.assertArtworkDedupAccount(args[0], args[1].expectedUserId)
      return mocks.control(...args)
    }
  }
})
vi.mock('@/services/artwork-dedup-review-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/artwork-dedup-review-service')>()
  const { assertArtworkDedupAccount } = await import('@/services/artwork-dedup-service')
  return { ...original, listArtworkDedupReviewGroups: (...args: Parameters<typeof original.listArtworkDedupReviewGroups>) => {
    assertArtworkDedupAccount(args[0], args[1].expectedUserId)
    return mocks.listGroups(...args)
  } }
})
import { artworkDedupRouter } from '../artwork-dedup'
const authorized = {
  session: { id: 'session' },
  user: { id: 'owner' },
  userId: 'owner',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
const calls = (caller: ReturnType<typeof artworkDedupRouter.createCaller>, expectedUserId: string) => [
  () => caller.start({ artistId: 1, expectedUserId, idempotencyKey: 'start', mode: 'INCREMENTAL' }),
  () => caller.getRun({ runId: 'run', expectedUserId }),
  () =>
    caller.control({ runId: 'run', expectedUserId, expectedVersion: 1, idempotencyKey: 'control', action: 'pause' }),
  () => caller.listGroups({ runId: 'run', expectedUserId })
]
describe('artwork detection authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires session for every read and mutation', async () => {
    for (const invoke of calls(artworkDedupRouter.createCaller(unauthorized), 'owner')) {
      await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled()
  })
  it('rejects stale-account requests through the real service guard before domain work', async () => {
    for (const invoke of calls(artworkDedupRouter.createCaller(authorized), 'other')) {
      await expect(invoke()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled()
  })
  it('uses session actor and rejects paths or ownership injection', async () => {
    const caller = artworkDedupRouter.createCaller(authorized)
    await caller.start({ artistId: 1, expectedUserId: 'owner', idempotencyKey: 'start' })
    expect(mocks.start).toHaveBeenCalledWith('owner', {
      artistId: 1,
      expectedUserId: 'owner',
      idempotencyKey: 'start',
      mode: 'INCREMENTAL'
    })
    await expect(
      caller.start({ artistId: 1, expectedUserId: 'owner', idempotencyKey: 'other', paths: ['private'] } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller.listGroups({ runId: 'run', expectedUserId: 'owner', limit: 101 })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    await expect(caller.listGroups({ runId: 'run', expectedUserId: 'owner', userId: 'forged' } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
