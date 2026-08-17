import { describe, expect, it, vi } from 'vitest'
import { reconcileLocalArtworkImages } from '../local-rescan.js'

const now = new Date('2026-08-16T00:00:00.000Z')

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
      discoveredMedia({
        relativePath: 'local/a/KEEP.mp4',
        size: 22n,
        sortOrder: 0,
        mediaType: 'VIDEO' as const,
        webpAnimationStatus: null
      }),
      discoveredMedia({
        relativePath: 'local/a/new.jpg',
        size: 33n,
        sortOrder: 1,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      })
    ]

    await reconcileLocalArtworkImages(transaction as never, 7, media, now)

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
    const media = ['A.jpg', 'a.jpg'].map((name, sortOrder) => discoveredMedia({
      relativePath: `local/a/${name}`,
      size: 1n,
      sortOrder,
      mediaType: 'IMAGE' as const,
      webpAnimationStatus: null
    }))

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media, now)).rejects.toThrow(
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
      discoveredMedia({
        relativePath: 'local/a/keep.jpg',
        size: 20n,
        sortOrder: 0,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      })
    ]

    await reconcileLocalArtworkImages(transaction as never, 7, media, now)

    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })

  it('retains the image id and derived relations when canonicalizing a legacy leading-slash path', async () => {
    const transaction = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 11,
            path: '/local/a/keep.mp4',
            size: 20n,
            sortOrder: 0,
            mediaType: 'VIDEO',
            webpAnimationStatus: null,
            chaptersPath: null,
            chaptersCount: 0,
            chaptersDuration: null,
            chaptersUpdatedAt: null,
            chaptersHash: null
          }
        ]),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }

    await reconcileLocalArtworkImages(
      transaction as never,
      7,
      [discoveredMedia({ relativePath: 'local/a/keep.mp4', size: 20n, sortOrder: 0, mediaType: 'VIDEO' })],
      now
    )

    expect(transaction.image.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ path: 'local/a/keep.mp4' })
    })
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
      discoveredMedia({
        relativePath: 'local/a/a.jpg',
        size: 20n,
        sortOrder: 0,
        mediaType: 'IMAGE' as const,
        webpAnimationStatus: null
      })
    ]

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media, now)).rejects.toThrow(
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
    const media = ['caf\u00e9.jpg', 'cafe\u0301.jpg'].map((name, sortOrder) => discoveredMedia({
      relativePath: `local/a/${name}`,
      size: 1n,
      sortOrder,
      mediaType: 'IMAGE' as const,
      webpAnimationStatus: null
    }))

    await expect(reconcileLocalArtworkImages(transaction as never, 7, media, now)).rejects.toThrow(
      'collide after case folding'
    )
    expect(transaction.image.findMany).not.toHaveBeenCalled()
    expect(transaction.image.update).not.toHaveBeenCalled()
    expect(transaction.image.createMany).not.toHaveBeenCalled()
    expect(transaction.image.deleteMany).not.toHaveBeenCalled()
  })

  it('persists a discovered chapter summary on retained and newly created local videos', async () => {
    const transaction = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 11,
            path: 'local/a/keep.mp4',
            size: 20n,
            sortOrder: 0,
            mediaType: 'VIDEO',
            webpAnimationStatus: null,
            chaptersPath: null,
            chaptersCount: 0,
            chaptersDuration: null,
            chaptersUpdatedAt: null,
            chaptersHash: null
          }
        ]),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn()
      }
    }
    const chapterSummary = {
      chaptersPath: 'local/a/keep.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: 'keep-hash'
    }
    const media = [
      discoveredMedia({ relativePath: 'local/a/keep.mp4', size: 20n, sortOrder: 0, mediaType: 'VIDEO', ...chapterSummary }),
      discoveredMedia({
        relativePath: 'local/a/new.mp4',
        size: 30n,
        sortOrder: 1,
        mediaType: 'VIDEO',
        chaptersPath: 'local/a/new.chapters.json',
        chaptersCount: 3,
        chaptersDuration: 30,
        chaptersHash: 'new-hash'
      })
    ]

    await reconcileLocalArtworkImages(transaction as never, 7, media, now)

    expect(transaction.image.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ ...chapterSummary, chaptersUpdatedAt: now })
    })
    expect(transaction.image.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ path: 'local/a/new.mp4', chaptersUpdatedAt: now, chaptersHash: 'new-hash' })]
    })
  })

  it('clears a retained video chapter summary when its manifest has been removed', async () => {
    const transaction = {
      image: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 11,
            path: 'local/a/keep.mp4',
            size: 20n,
            sortOrder: 0,
            mediaType: 'VIDEO',
            webpAnimationStatus: null,
            chaptersPath: 'local/a/keep.chapters.json',
            chaptersCount: 2,
            chaptersDuration: 20,
            chaptersUpdatedAt: new Date('2026-08-15T00:00:00.000Z'),
            chaptersHash: 'old-hash'
          }
        ]),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn(),
        deleteMany: vi.fn()
      }
    }

    await reconcileLocalArtworkImages(
      transaction as never,
      7,
      [discoveredMedia({ relativePath: 'local/a/keep.mp4', size: 20n, sortOrder: 0, mediaType: 'VIDEO' })],
      now
    )

    expect(transaction.image.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null
      })
    })
  })
})

function discoveredMedia(overrides: {
  relativePath: string
  size: bigint
  sortOrder: number
  mediaType: 'IMAGE' | 'ANIMATION' | 'VIDEO'
  webpAnimationStatus?: number | null
  chaptersPath?: string | null
  chaptersCount?: number
  chaptersDuration?: number | null
  chaptersHash?: string | null
}) {
  return {
    webpAnimationStatus: null,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersHash: null,
    ...overrides
  }
}
