import { beforeEach, describe, expect, it, vi } from 'vitest'

// The maintenance boundary is covered with actual PostgreSQL/service calls in artwork-dedup-app-guards.postgres.test.ts.
vi.mock('../artwork-dedup-write-guard', () => ({ assertArtworkDedupAppWrite: vi.fn() }))

const mocks = vi.hoisted(() => ({
  artwork: { findUnique: vi.fn() },
  artworkLike: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  lock: vi.fn(),
  transaction: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { artwork: mocks.artwork, artworkLike: mocks.artworkLike, $transaction: mocks.transaction }
}))
vi.mock('@pixishelf/db', () => ({ lockArtworkForReading: mocks.lock, lockCreatorCatalog: vi.fn().mockResolvedValue(undefined) }))
import { getArtworkRating, getUserArtworkRatingLevels, setArtworkRating } from '../artwork-rating-service'

const time = new Date('2026-10-22T12:00:00.000Z')
const tx = { artwork: mocks.artwork, artworkLike: mocks.artworkLike }

describe('personal artwork ratings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.transaction.mockImplementation((operation) => operation(tx))
    mocks.lock.mockResolvedValue({ id: 7, mediaRevision: 1 })
    mocks.artwork.findUnique.mockResolvedValue({ deletedAt: null, archiveLifecycleState: 'ACTIVE' })
    mocks.artworkLike.findUnique.mockResolvedValue(null)
    mocks.artworkLike.upsert.mockImplementation(({ create }) => ({ level: create.level, updatedAt: time }))
  })

  it('reads only the authenticated account from an active artwork and distinguishes unrated from normal', async () => {
    mocks.artwork.findUnique.mockResolvedValueOnce({ likes: [] }).mockResolvedValueOnce({ likes: [{ level: 1, updatedAt: time }] })
    await expect(getArtworkRating('alice', 7)).resolves.toEqual({ artworkId: 7, level: null, isLike: false, updatedAt: null })
    expect(mocks.artwork.findUnique).toHaveBeenCalledWith({
      where: { id: 7, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { likes: { where: { userId: 'alice' }, select: { level: true, updatedAt: true } } }
    })
    await expect(getArtworkRating('bob', 7)).resolves.toMatchObject({ level: 1, isLike: false })
    mocks.artwork.findUnique.mockResolvedValue(null)
    await expect(getArtworkRating('alice', 7)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it.each([1, 2, 3, 4] as const)('locks the artwork before writing level %i and derives the heart', async (level) => {
    await expect(setArtworkRating('alice', 7, level)).resolves.toEqual({
      artworkId: 7, level, isLike: level >= 2, updatedAt: time.toISOString()
    })
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(tx, 7)
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.artworkLike.findUnique.mock.invocationCallOrder[0]!)
    expect(mocks.artworkLike.upsert).toHaveBeenCalledWith({
      where: { userId_artworkId: { userId: 'alice', artworkId: 7 } },
      create: { userId: 'alice', artworkId: 7, level }, update: { level },
      select: { level: true, updatedAt: true }
    })
  })

  it('preserves the timestamp for repeated absolute writes including an already empty rating', async () => {
    mocks.artworkLike.findUnique.mockResolvedValueOnce({ level: 4, updatedAt: time }).mockResolvedValueOnce(null)
    await expect(setArtworkRating('alice', 7, 4)).resolves.toMatchObject({ level: 4, updatedAt: time.toISOString() })
    await expect(setArtworkRating('alice', 7, null)).resolves.toMatchObject({ level: null, updatedAt: null })
    expect(mocks.artworkLike.upsert).not.toHaveBeenCalled()
    expect(mocks.artworkLike.deleteMany).not.toHaveBeenCalled()
  })

  it('clears only the requesting account and propagates a transaction failure', async () => {
    mocks.artworkLike.findUnique.mockResolvedValue({ level: 3, updatedAt: time })
    await expect(setArtworkRating('alice', 7, null)).resolves.toEqual({ artworkId: 7, level: null, isLike: false, updatedAt: null })
    expect(mocks.artworkLike.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: 'alice', artworkId: 7 } })
    mocks.artworkLike.upsert.mockRejectedValue(new Error('database unavailable'))
    await expect(setArtworkRating('alice', 7, 2)).rejects.toThrow('database unavailable')
  })

  it.each([
    null,
    { deletedAt: time, archiveLifecycleState: 'ACTIVE' },
    { deletedAt: null, archiveLifecycleState: 'TRASHED' },
    { deletedAt: null, archiveLifecycleState: 'TRASH_PENDING' }
  ])('rejects unavailable artwork before reading or writing a rating (%j)', async (artwork) => {
    mocks.artwork.findUnique.mockResolvedValue(artwork)
    await expect(setArtworkRating('alice', 7, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.artworkLike.findUnique).not.toHaveBeenCalled()
    expect(mocks.artworkLike.upsert).not.toHaveBeenCalled()
    expect(mocks.artworkLike.deleteMany).not.toHaveBeenCalled()
  })

  it('does not access rating rows when the artwork disappeared before its lock', async () => {
    mocks.lock.mockResolvedValue(null)
    await expect(setArtworkRating('alice', 7, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.artwork.findUnique).not.toHaveBeenCalled()
    expect(mocks.artworkLike.findUnique).not.toHaveBeenCalled()
  })

  it('hydrates bounded account ratings including normal without inventing missing records', async () => {
    mocks.artworkLike.findMany.mockResolvedValue([{ artworkId: 7, level: 1 }, { artworkId: 8, level: 4 }])
    await expect(getUserArtworkRatingLevels('alice', [7, 8, 9])).resolves.toEqual({ 7: 1, 8: 4 })
    expect(mocks.artworkLike.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: 'alice', artworkId: { in: [7, 8, 9] } }, select: { artworkId: true, level: true }
    })
    await expect(getUserArtworkRatingLevels('alice', [])).resolves.toEqual({})
    expect(mocks.artworkLike.findMany).toHaveBeenCalledOnce()
  })
})
