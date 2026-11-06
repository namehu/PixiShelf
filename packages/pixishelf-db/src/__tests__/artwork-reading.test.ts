import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  invalidateArtworkReadingForRebuild,
  lockArtworkForReading,
  refreshArtworkReadingLayout
} from '../artwork-reading'

describe('artwork reading transaction helpers', () => {
  it('returns locked versions, or null for an absent artwork', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 7, mediaRevision: 3, readingLayoutVersion: 5, logicalMediaCount: 10 }])
        .mockResolvedValueOnce([])
    }
    expect(await lockArtworkForReading(tx, 7)).toMatchObject({ readingLayoutVersion: 5, logicalMediaCount: 10 })
    expect(await lockArtworkForReading(tx, 8)).toBeNull()
  })
  it('locks before advancing independent rebuild versions and clearing the single progress table', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
      artwork: { update: vi.fn().mockResolvedValue({ mediaRevision: 4 }) },
      artworkReadingProgress: { deleteMany: vi.fn() }
    }
    expect(await invalidateArtworkReadingForRebuild(tx as unknown as Prisma.TransactionClient, 7)).toBe(4)
    expect(tx.artwork.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { mediaRevision: { increment: 1 }, readingLayoutVersion: { increment: 1 }, logicalMediaCount: 0 },
      select: { mediaRevision: true }
    })
    expect(tx.artworkReadingProgress.deleteMany).toHaveBeenCalledWith({ where: { artworkId: 7 } })
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.artwork.update.mock.invocationCallOrder[0]!)
  })
  it('relocates a deleted furthest anchor to the previous surviving logical item and last to first when needed', async () => {
    const tx = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          { id: 2, path: '2.jpg' },
          { id: 4, path: '4.jpg' }
        ])
      },
      artwork: { update: vi.fn() },
      artworkReadingProgress: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              userId: 'u',
              completed: false,
              furthestMediaId: 3,
              furthestMediaIndex: 2,
              lastMediaId: 1,
              lastMediaIndex: 0
            }
          ]),
        update: vi.fn()
      }
    }
    await refreshArtworkReadingLayout(
      tx as unknown as Prisma.TransactionClient,
      7,
      [1, 2, 3, 4].map((mediaId) => ({ mediaId, memberMediaIds: [mediaId], isVideo: false }))
    )
    expect(tx.artwork.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { logicalMediaCount: 2, readingLayoutVersion: { increment: 1 } }
    })
    expect(tx.artworkReadingProgress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          furthestMediaId: 2,
          furthestMediaIndex: 0,
          lastMediaId: 2,
          lastMediaIndex: 0,
          completed: false,
          stateVersion: { increment: 1 }
        }
      })
    )
  })
  it('preserves an APNG member when a video representative disappears', async () => {
    const tx = {
      image: { findMany: vi.fn().mockResolvedValue([{ id: 1, path: 'same.apng' }]) },
      artwork: { update: vi.fn() },
      artworkReadingProgress: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              userId: 'u',
              completed: false,
              furthestMediaId: 2,
              furthestMediaIndex: 0,
              lastMediaId: 2,
              lastMediaIndex: 0
            }
          ]),
        update: vi.fn()
      }
    }
    await refreshArtworkReadingLayout(tx as unknown as Prisma.TransactionClient, 7, [
      { mediaId: 2, memberMediaIds: [2, 1], isVideo: true }
    ])
    expect(tx.artworkReadingProgress.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ furthestMediaId: 1, lastMediaId: 1 }) })
    )
  })
  it('does not bump an unchanged layout', async () => {
    const tx = {
      image: { findMany: vi.fn().mockResolvedValue([{ id: 1, path: 'moved/a.jpg' }]) },
      artwork: { update: vi.fn() }
    }
    await refreshArtworkReadingLayout(tx as unknown as Prisma.TransactionClient, 7, [
      { mediaId: 1, memberMediaIds: [1], isVideo: false }
    ])
    expect(tx.artwork.update).not.toHaveBeenCalled()
  })
})
