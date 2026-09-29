import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { invalidateArtworkReadingForRebuild, lockArtworkForReading } from '../artwork-reading'

describe('artwork reading transaction helpers', () => {
  it('returns the locked revision and does not create missing artworks', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 7, mediaRevision: 3 }]).mockResolvedValueOnce([])
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient

    await expect(lockArtworkForReading(tx, 7)).resolves.toEqual({ id: 7, mediaRevision: 3 })
    await expect(lockArtworkForReading(tx, 8)).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('locks before bumping the revision and clears both account-scoped tables', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 7, mediaRevision: 3 }])
    const update = vi.fn().mockResolvedValue({ mediaRevision: 4 })
    const deleteMedia = vi.fn().mockResolvedValue({ count: 2 })
    const deleteSummaries = vi.fn().mockResolvedValue({ count: 2 })
    const tx = {
      $queryRaw: query,
      artwork: { update },
      artworkReadMedia: { deleteMany: deleteMedia },
      artworkReadingSummary: { deleteMany: deleteSummaries }
    } as unknown as Prisma.TransactionClient

    await expect(invalidateArtworkReadingForRebuild(tx, 7)).resolves.toBe(4)
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { mediaRevision: { increment: 1 } },
      select: { mediaRevision: true }
    })
    expect(deleteMedia).toHaveBeenCalledWith({ where: { artworkId: 7 } })
    expect(deleteSummaries).toHaveBeenCalledWith({ where: { artworkId: 7 } })
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]!)
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(deleteMedia.mock.invocationCallOrder[0]!)
    expect(deleteMedia.mock.invocationCallOrder[0]).toBeLessThan(deleteSummaries.mock.invocationCallOrder[0]!)
  })

  it('does not mutate reading state when the artwork is absent', async () => {
    const update = vi.fn()
    const deleteMedia = vi.fn()
    const deleteSummaries = vi.fn()
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      artwork: { update },
      artworkReadMedia: { deleteMany: deleteMedia },
      artworkReadingSummary: { deleteMany: deleteSummaries }
    } as unknown as Prisma.TransactionClient

    await expect(invalidateArtworkReadingForRebuild(tx, 404)).rejects.toThrow('Artwork 404 does not exist')
    expect(update).not.toHaveBeenCalled()
    expect(deleteMedia).not.toHaveBeenCalled()
    expect(deleteSummaries).not.toHaveBeenCalled()
  })
})
