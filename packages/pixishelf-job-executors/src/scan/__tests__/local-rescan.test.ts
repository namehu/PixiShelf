import { describe, expect, it, vi } from 'vitest'
import { reconcileLocalArtworkImages } from '../local-rescan.js'

describe('reconcileLocalArtworkImages', () => {
  it('retains matching image ids and derived relations while deleting missing and creating new paths', async () => {
    const transaction = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11, path: 'local/a/keep.mp4', size: 20n, sortOrder: 0, mediaType: 'VIDEO', webpAnimationStatus: null },
          { id: 12, path: 'local/a/missing.jpg', size: 1n, sortOrder: 1, mediaType: 'IMAGE', webpAnimationStatus: null }
        ]),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    }
    const media = [
      {
        relativePath: 'local/a/KEEP.mp4',
        size: 22n,
        sortOrder: 0,
        mediaType: 'VIDEO' as const,
        webpAnimationStatus: null
      },
      {
        relativePath: 'local/a/new.jpg',
        size: 33n,
        sortOrder: 1,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      }
    ]

    await reconcileLocalArtworkImages(transaction as never, 7, media)

    expect(transaction.image.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ path: 'local/a/KEEP.mp4', sortOrder: 0, size: 22n })
    })
    expect(transaction.image.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ artworkId: 7, path: 'local/a/new.jpg', sortOrder: 1 })]
    })
    expect(transaction.image.deleteMany).toHaveBeenCalledWith({
      where: { artworkId: 7, id: { in: [12] } }
    })
    expect(transaction.image.deleteMany).not.toHaveBeenCalledWith({ where: { artworkId: 7 } })
  })

  it('rejects case-fold collisions before any database read or write', async () => {
    const transaction = {
      image: {
        findMany: vi.fn(),
        update: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }
    const media = ['A.jpg', 'a.jpg'].map((name, sortOrder) => ({
      relativePath: `local/a/${name}`,
      size: 1n,
      sortOrder,
      mediaType: 'IMAGE' as const,
      webpAnimationStatus: null
    }))

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media)).rejects.toThrow(
      'collide after case folding'
    )
    expect(transaction.image.findMany).not.toHaveBeenCalled()
    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })

  it('performs no writes when every retained media row is already current', async () => {
    const transaction = {
      image: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 11, path: 'local/a/keep.jpg', size: 20n, sortOrder: 0, mediaType: 'IMAGE', webpAnimationStatus: null }
          ]),
        update: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }
    const media = [
      {
        relativePath: 'local/a/keep.jpg',
        size: 20n,
        sortOrder: 0,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      }
    ]

    await reconcileLocalArtworkImages(transaction as never, 7, media)

    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects case-fold collisions already present in the database without mutating them', async () => {
    const transaction = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11, path: 'local/a/A.jpg' },
          { id: 12, path: 'local/a/a.jpg' }
        ]),
        update: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }
    const media = [
      {
        relativePath: 'local/a/a.jpg',
        size: 20n,
        sortOrder: 0,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      }
    ]

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media)).rejects.toThrow(
      'database contains image paths that collide'
    )
    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects canonically equivalent Unicode paths before any database access', async () => {
    const transaction = {
      image: {
        findMany: vi.fn(),
        update: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }
    const media = ['caf\u00e9.jpg', 'cafe\u0301.jpg'].map((name, sortOrder) => ({
      relativePath: `local/a/${name}`,
      size: 1n,
      sortOrder,
      mediaType: 'IMAGE' as const,
      webpAnimationStatus: null
    }))

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media)).rejects.toThrow(
      'collide after case folding'
    )
    expect(transaction.image.findMany).not.toHaveBeenCalled()
    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })
})
