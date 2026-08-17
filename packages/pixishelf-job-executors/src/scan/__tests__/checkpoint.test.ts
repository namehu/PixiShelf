import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { publishLocalMediaWork } from '../local-publisher.js'
import { publishPixivArtwork } from '../pixiv-publisher.js'
import type { ScanTransaction } from '../types.js'

const now = new Date('2026-08-15T00:00:00.000Z')

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
            relativePath: 'local-imports/Artist/Work/1.jpg',
            size: 5n,
            sortOrder: 0,
            mediaType: 'IMAGE',
            webpAnimationStatus: null
          }
        ],
        defaultTagIds: [3, 4]
      })
    ).resolves.toMatchObject({ status: 'SUCCESS', newImages: 1, artworkId: 9 })
    expect(transaction.artworkTag.createMany).toHaveBeenCalledWith({
      data: [
        { artworkId: 9, tagId: 3, provenance: 'MANUAL' },
        { artworkId: 9, tagId: 4, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
    expect(transaction.scanRunItem.upsert).toHaveBeenCalledOnce()
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
