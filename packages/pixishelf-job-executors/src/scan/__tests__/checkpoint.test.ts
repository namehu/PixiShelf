import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { publishLocalMediaWork } from '../local-publisher.js'
import { publishPixivArtwork } from '../pixiv-publisher.js'
import type { ScanTransaction } from '../types.js'

const now = new Date('2026-08-15T00:00:00.000Z')
const mediaModifiedAt = new Date('2024-01-02T03:04:05.000Z')
const mediaDerivedTagIds = { webp: 20, video: 21, image: 22 }

describe('scan item checkpoints', () => {
  it('does not repeat local domain writes after a successful checkpoint', async () => {
    const transaction = {
      scanRunItem: { findUnique: vi.fn(async () => ({ status: 'SUCCESS', newImageCount: 4 })) },
      artwork: { findUnique: vi.fn() }
    } as unknown as ScanTransaction & {
      scanRunItem: { findUnique: ReturnType<typeof vi.fn> }
      artwork: { findUnique: ReturnType<typeof vi.fn> }
    }
    const work = localWork()

    await expect(
      publishLocalMediaWork({
        transaction,
        runId: 'run-1',
        work,
        title: 'Work',
        now,
        artistId: 1,
        media: [],
        mediaDerivedTagIds,
        defaultTagIds: []
      })
    ).resolves.toEqual({ status: 'SUCCESS', newImages: 4, artworkId: null })
    expect(transaction.artwork.findUnique).not.toHaveBeenCalled()
  })

  it('marks an existing pixiv artwork seen and checkpoints SKIP in one transaction', async () => {
    const transaction = {
      scanRunItem: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({}))
      },
      artworkExternalRef: {
        findUnique: vi.fn(async () => ({ id: 'ref-1', artwork: { id: 42 } })),
        update: vi.fn(async () => ({}))
      },
      scanRun: { updateMany: vi.fn(async () => ({ count: 1 })) }
    } as unknown as ScanTransaction & {
      scanRunItem: { upsert: ReturnType<typeof vi.fn> }
      artworkExternalRef: { update: ReturnType<typeof vi.fn> }
    }

    await expect(
      publishPixivArtwork({
        transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:a',
        metadataRelativePath: 'a/42-meta.json',
        metadata: {
          id: '42',
          user: 'Artist',
          userId: '7',
          title: 'Title',
          description: null,
          tags: [],
          url: null,
          original: null,
          thumbnail: null,
          xRestrict: null,
          isAiGenerated: null,
          size: null,
          bookmarkCount: null,
          sourceDate: null,
          metadataFormat: 'json',
          rawMetadataJson: null,
          pixivAiType: null,
          pixivType: null,
          sanityLevel: null
        },
        media: [],
        existingPolicy: 'SKIP',
        now
      })
    ).resolves.toMatchObject({ status: 'SKIPPED', artworkId: 42 })
    expect(transaction.artworkExternalRef.update).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: { lastSeenScanRunId: 'run-1' }
    })
    expect(transaction.scanRunItem.upsert).toHaveBeenCalledOnce()
  })

  it('publishes local media and frozen default tags in the same checkpoint transaction', async () => {
    const transaction = {
      scanRunItem: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      artwork: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 9 })),
        update: vi.fn(async () => ({}))
      },
      artist: { findUnique: vi.fn(async () => ({ id: 7 })) },
      tag: { findMany: vi.fn(async () => [{ id: 3 }, { id: 4 }]) },
      image: { createMany: vi.fn(async () => ({ count: 1 })) },
      artworkTag: { createMany: vi.fn(async () => ({ count: 2 })) },
      scanRun: { updateMany: vi.fn(async () => ({ count: 1 })) }
    } as unknown as ScanTransaction & {
      artworkTag: { createMany: ReturnType<typeof vi.fn> }
      scanRunItem: { upsert: ReturnType<typeof vi.fn> }
    }

    await expect(
      publishLocalMediaWork({
        transaction,
        runId: 'run-1',
        work: localWork(),
        title: 'Work',
        now,
        artistId: 7,
        media: [
          {
            relativePath: 'local-imports/Artist/Work/1.mp4',
            width: 1920,
            height: 1080,
            modifiedAt: mediaModifiedAt,
            size: 5n,
            sortOrder: 0,
            mediaType: 'VIDEO',
            webpAnimationStatus: null,
            chaptersPath: 'local-imports/Artist/Work/1.chapters.json',
            chaptersCount: 2,
            chaptersDuration: 20,
            chaptersHash: 'chapter-hash'
          }
        ],
        mediaDerivedTagIds,
        defaultTagIds: [3, 4]
      })
    ).resolves.toMatchObject({ status: 'SUCCESS', newImages: 1, artworkId: 9 })
    expect(transaction.artwork.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceDate: mediaModifiedAt }),
      select: { id: true }
    })
    expect(transaction.artworkTag.createMany).toHaveBeenNthCalledWith(1, {
      data: [{ artworkId: 9, tagId: 21, provenance: 'DERIVED' }],
      skipDuplicates: true
    })
    expect(transaction.artworkTag.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        { artworkId: 9, tagId: 3, provenance: 'MANUAL' },
        { artworkId: 9, tagId: 4, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
    expect(transaction.image.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          path: 'local-imports/Artist/Work/1.mp4',
          width: 1920,
          height: 1080,
          chaptersPath: 'local-imports/Artist/Work/1.chapters.json',
          chaptersCount: 2,
          chaptersDuration: 20,
          chaptersUpdatedAt: now,
          chaptersHash: 'chapter-hash'
        })
      ]
    })
    expect(transaction.scanRunItem.upsert).toHaveBeenCalledOnce()
  })

  it('publishes Pixiv chapter summaries when creating a new image', async () => {
    const fixture = pixivTransaction([])
    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'metadata:0:pixiv',
      metadataRelativePath: '11/42/42-meta.json',
      metadata: pixivMetadata(),
      media: [pixivMedia('11/42/42_p0.mp4')],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.imageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artworkId: 42,
        path: '11/42/42_p0.mp4',
        chaptersPath: '11/42/42_p0.chapters.json',
        chaptersUpdatedAt: now
      })
    })
    expect(fixture.imageUpdate).not.toHaveBeenCalled()
  })

  it('updates a legacy leading-slash Pixiv image in place and preserves its id', async () => {
    const fixture = pixivTransaction([{ id: 99, path: '/11/42/42_p0.mp4' }])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:legacy',
        metadataRelativePath: '11/42/42-meta.json',
        metadata: pixivMetadata(),
        media: [pixivMedia('11/42/42_p0.mp4')],
        existingPolicy: 'REFRESH',
        now
      })
    ).resolves.toMatchObject({ status: 'SUCCESS', newImages: 0 })

    expect(fixture.imageUpdate).toHaveBeenCalledWith({
      where: { id: 99 },
      data: expect.objectContaining({ path: '11/42/42_p0.mp4', chaptersUpdatedAt: now })
    })
    expect(fixture.imageCreate).not.toHaveBeenCalled()
  })

  it('rejects conflicting normalized Pixiv image identities instead of choosing one', async () => {
    const fixture = pixivTransaction([
      { id: 98, path: '/11/42/42_p0.mp4' },
      { id: 99, path: '11/42/42_p0.mp4' }
    ])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:conflict',
        metadataRelativePath: '11/42/42-meta.json',
        metadata: pixivMetadata(),
        media: [pixivMedia('11/42/42_p0.mp4')],
        existingPolicy: 'REFRESH',
        now
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(fixture.imageUpdate).not.toHaveBeenCalled()
    expect(fixture.imageCreate).not.toHaveBeenCalled()
  })
})

function localWork(): Prisma.ScanRunLocalWorkInputGetPayload<Record<string, never>> {
  return {
    id: 'work-1',
    scanRunId: 'run-1',
    ordinal: 0,
    kind: 'MEDIA_DIRECTORY',
    relativePath: 'local-imports/Artist/Work',
    fingerprint: 'a'.repeat(64),
    createdAt: now
  }
}

function pixivMetadata() {
  return {
    id: '42',
    user: 'Artist',
    userId: '7',
    title: 'Title',
    description: null,
    tags: [],
    url: null,
    original: null,
    thumbnail: null,
    xRestrict: null,
    isAiGenerated: null,
    size: null,
    bookmarkCount: null,
    sourceDate: null,
    metadataFormat: 'json' as const,
    rawMetadataJson: null,
    pixivAiType: null,
    pixivType: null,
    sanityLevel: null
  }
}

function pixivMedia(relativePath: string) {
  return {
    relativePath,
    size: 5n,
    sortOrder: 0,
    mediaType: 'VIDEO' as const,
    webpAnimationStatus: null,
    chaptersPath: '11/42/42_p0.chapters.json',
    chaptersCount: 2,
    chaptersDuration: 20,
    chaptersHash: 'chapter-hash'
  }
}

function pixivTransaction(existingImages: Array<{ id: number; path: string }>) {
  const imageCreate = vi.fn(async () => ({}))
  const imageUpdate = vi.fn(async () => ({}))
  const transaction = {
    scanRunItem: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    artworkExternalRef: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'ref-1' }))
    },
    artwork: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 42 })) },
    artist: { upsert: vi.fn(async () => ({ id: 7 })) },
    artworkTag: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    image: {
      findMany: vi.fn(async () => existingImages),
      create: imageCreate,
      update: imageUpdate
    },
    scanRun: { updateMany: vi.fn(async () => ({ count: 1 })) }
  } as unknown as ScanTransaction
  return { transaction, imageCreate, imageUpdate }
}
