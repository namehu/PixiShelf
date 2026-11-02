import { pixivSourceProofFixture, localSourceProofFixture } from './dedup-source-fixture.ts'
import { confirmedAnimationFixture } from './classification-fixture.ts'
import { checkArtworkSummarySource, invalidateAnimationDurationSource, type Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { publishLocalMediaWork } from '../local-publisher.js'
import { publishPixivArtwork, replacePixivSourceTags } from '../pixiv-publisher.js'
import type { ScanTransaction } from '../types.js'

vi.mock('@pixishelf/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pixishelf/db')>()),
  assertArtworkDedupSources: vi.fn(async () => undefined),
  assertArtworkDedupWritable: vi.fn(async () => undefined),
  checkArtworkSummarySource: vi.fn(async () => undefined),
  invalidateAnimationDurationSource: vi.fn(async () => false)
}))

const now = new Date('2026-08-15T00:00:00.000Z')
const mediaModifiedAt = new Date('2024-01-02T03:04:05.000Z')
const mediaDerivedTagIds = { webp: 20, video: 21, image: 22 }

describe('scan item checkpoints', () => {
  it('does not repeat local domain writes after a successful checkpoint', async () => {
    const transaction = {
    artworkSummaryFeature: { findUnique: vi.fn(async () => null) },
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
    artworkSummaryFeature: { findUnique: vi.fn(async () => null) },
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
        dedupSourceSnapshot: pixivSourceProofFixture('a/42-meta.json'),
        metadataContentHash: 'a'.repeat(64),
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
    artworkSummaryFeature: { findUnique: vi.fn(async () => null) },
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
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: pixivMetadata(),
      media: [pixivMedia('11/42/42_p0.mp4')],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.imageCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          artworkId: 42,
          path: '11/42/42_p0.mp4',
          chaptersPath: '11/42/42_p0.chapters.json',
          chaptersUpdatedAt: now
        })
      ]
    })
    expect(fixture.imageUpdate).not.toHaveBeenCalled()
  })

  it('updates a legacy leading-slash Pixiv image in place and preserves its id', async () => {
    const fixture = pixivTransaction([{ id: 99, path: '/11/42/42_p0.mp4', sortOrder: 8 }])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:legacy',
        metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
        metadataContentHash: 'a'.repeat(64),
        metadata: pixivMetadata(),
        media: [pixivMedia('11/42/42_p0.mp4')],
        existingPolicy: 'REFRESH',
        now
      })
    ).resolves.toMatchObject({ status: 'SUCCESS', newImages: 0 })

    expect(fixture.imageUpdate).toHaveBeenCalledWith({
      where: { id: 99 },
      data: expect.objectContaining({ chaptersUpdatedAt: now })
    })
    expect(fixture.imageUpdate.mock.calls[0]![0].data).not.toHaveProperty('path')
    expect(fixture.imageUpdate.mock.calls[0]![0].data).not.toHaveProperty('sortOrder')
    expect(fixture.imageCreate).not.toHaveBeenCalled()
  })

  it('rejects conflicting normalized Pixiv image identities instead of choosing one', async () => {
    const fixture = pixivTransaction([
      { id: 98, path: '/11/42/42_p0.mp4', sortOrder: 0 },
      { id: 99, path: '11/42/42_p0.mp4', sortOrder: 1 }
    ])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:conflict',
        metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
        metadataContentHash: 'a'.repeat(64),
        metadata: pixivMetadata(),
        media: [pixivMedia('11/42/42_p0.mp4')],
        existingPolicy: 'REFRESH',
        now
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(fixture.imageUpdate).not.toHaveBeenCalled()
    expect(fixture.imageCreate).not.toHaveBeenCalled()
  })

  it('promotes matching legacy tags while preserving manual, derived, and other-source provenance', async () => {
    const fixture = existingPixivTransaction({
      tags: [
        { tagId: 1, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' },
        { tagId: 2, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' },
        { tagId: 3, provenance: 'LEGACY', sourceRefId: null },
        { tagId: 4, provenance: 'MANUAL', sourceRefId: null },
        { tagId: 5, provenance: 'DERIVED', sourceRefId: null },
        { tagId: 6, provenance: 'SOURCE', sourceRefId: 'ref-other' }
      ],
      tagIdsByName: new Map([
        ['current-source', 2],
        ['legacy-overlap', 3],
        ['manual-overlap', 4],
        ['derived-overlap', 5],
        ['other-source-overlap', 6],
        ['new-source', 7]
      ])
    })

    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'metadata:0:tags',
      metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: {
        ...pixivMetadata(),
        tags: [
          'current-source',
          'legacy-overlap',
          'manual-overlap',
          'derived-overlap',
          'other-source-overlap',
          'new-source',
          'new-source'
        ]
      },
      media: [],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.tags).toEqual([
      { tagId: 2, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' },
      { tagId: 3, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' },
      { tagId: 4, provenance: 'MANUAL', sourceRefId: null },
      { tagId: 5, provenance: 'DERIVED', sourceRefId: null },
      { tagId: 6, provenance: 'SOURCE', sourceRefId: 'ref-other' },
      { tagId: 7, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' }
    ])
    expect(fixture.artworkTagCreateMany).toHaveBeenCalledOnce()
  })

  it('honors local overrides and preserves artist and existing media order during refresh', async () => {
    const fixture = existingPixivTransaction({
      titleOverridden: true,
      descriptionOverridden: true,
      artworkExternalId: 'local-legacy-identity',
      existingImages: [
        { id: 90, path: '/11/42/42_p0.mp4', sortOrder: 8 },
        { id: 91, path: 'custom/local-only.jpg', sortOrder: 3 }
      ]
    })

    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'metadata:0:refresh',
      metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: { ...pixivMetadata(), title: 'Upstream title', description: 'Upstream description' },
      media: [pixivMedia('11/42/42_p0.mp4'), pixivMedia('11/42/42_p1.mp4')],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.artistUpsert).not.toHaveBeenCalled()
    const artworkUpdate = fixture.artworkUpdate.mock.calls[0]![0].data
    expect(artworkUpdate).not.toHaveProperty('artistId')
    expect(artworkUpdate).not.toHaveProperty('externalId')
    expect(artworkUpdate).not.toHaveProperty('title')
    expect(artworkUpdate).not.toHaveProperty('description')
    expect(artworkUpdate).not.toHaveProperty('descriptionLength')
    expect(artworkUpdate).not.toHaveProperty('source')
    expect(artworkUpdate).not.toHaveProperty('createdVia')
    expect(fixture.artworkUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 42, titleOverridden: false },
      data: { title: 'Upstream title' }
    })
    expect(fixture.artworkUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 42, descriptionOverridden: false },
      data: { description: 'Upstream description', descriptionLength: 20 }
    })
    expect(fixture.imageUpdate).toHaveBeenCalledWith({
      where: { id: 90 },
      data: expect.not.objectContaining({ path: expect.anything(), sortOrder: expect.anything() })
    })
    expect(fixture.imageCreate).toHaveBeenCalledWith({
      data: [expect.objectContaining({ artworkId: 42, path: '11/42/42_p1.mp4', sortOrder: 9 })]
    })
    expect(fixture.imageDeleteMany).not.toHaveBeenCalled()
    expect(fixture.artworkState.externalId).toBe('local-legacy-identity')
  })

  it('updates source-owned title and description when no local override exists', async () => {
    const fixture = existingPixivTransaction()

    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'metadata:0:source-fields',
      metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: { ...pixivMetadata(), title: 'Upstream title', description: 'Upstream description' },
      media: [],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.artworkUpdate.mock.calls[0]![0].data).not.toEqual(
      expect.objectContaining({ title: expect.anything(), description: expect.anything() })
    )
    expect(fixture.artworkUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 42, titleOverridden: false },
      data: { title: 'Upstream title' }
    })
    expect(fixture.artworkUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 42, descriptionOverridden: false },
      data: { description: 'Upstream description', descriptionLength: 20 }
    })
    expect(fixture.artworkState).toMatchObject({
      title: 'Upstream title',
      description: 'Upstream description',
      descriptionLength: 20
    })
  })

  it.each([
    [true, false, 'Curated title', 'Upstream description'],
    [false, true, 'Upstream title', 'Curated description']
  ])(
    'checks title override=%s and description override=%s independently in conditional writes',
    async (titleOverridden, descriptionOverridden, expectedTitle, expectedDescription) => {
      const fixture = existingPixivTransaction({ titleOverridden, descriptionOverridden })

      await publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: `metadata:0:independent-${titleOverridden}`,
        metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
        metadataContentHash: 'a'.repeat(64),
        metadata: { ...pixivMetadata(), title: 'Upstream title', description: 'Upstream description' },
        media: [],
        existingPolicy: 'REFRESH',
        now
      })

      expect(fixture.artworkState).toMatchObject({
        title: expectedTitle,
        description: expectedDescription,
        descriptionLength: descriptionOverridden ? 19 : 20
      })
    }
  )

  it('writes complete Pixiv ownership fields when creating a new artwork', async () => {
    const fixture = pixivTransaction([])

    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'metadata:0:create',
      metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: { ...pixivMetadata(), description: 'Source description' },
      media: [],
      existingPolicy: 'REFRESH',
      now
    })

    expect(fixture.artworkCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Title',
        description: 'Source description',
        descriptionLength: 18,
        externalId: '42',
        artistId: 7,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }),
      select: { id: true }
    })
    expect(fixture.artworkExternalRefUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadataHash: 'a'.repeat(64) }),
        update: expect.objectContaining({ metadataHash: 'a'.repeat(64) })
      })
    )
    expect(fixture.artworkSourceSnapshotUpsert).toHaveBeenCalledWith({
      where: {
        externalRefId_metadataHash: { externalRefId: 'ref-1', metadataHash: 'a'.repeat(64) }
      },
      create: expect.objectContaining({
        externalRefId: 'ref-1',
        metadataHash: 'a'.repeat(64),
        providerSchemaVersion: 1,
        rawMetadata: expect.objectContaining({ sourceFormat: 'txt' }),
        normalizedMetadata: expect.objectContaining({ id: '42', title: 'Title' })
      }),
      update: { fetchedAt: now }
    })
  })

  it('locks and validates frozen NEW identity evidence before publishing', async () => {
    const fixture = pixivTransaction([])
    fixture.inventoryFindUnique.mockResolvedValue({
      id: 'inventory-1',
      externalId: '42',
      externalRefId: null,
      processedContentHash: null
    })

    await publishPixivArtwork({
      transaction: fixture.transaction,
      runId: 'run-1',
      checkpointOrdinal: 0,
      checkpointKey: 'audit-apply:item-1',
      metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
      metadataContentHash: 'a'.repeat(64),
      metadata: pixivMetadata(),
      media: [],
      existingPolicy: 'REFRESH',
      manageCheckpoint: false,
      expectedIdentity: {
        expectedExternalId: '42',
        expectedInventoryId: 'inventory-1',
        expectedExternalRefId: null,
        expectedArtworkId: null,
        expectedProcessedContentHash: null
      },
      now
    })

    expect(fixture.queryRaw).toHaveBeenCalledOnce()
    expect(fixture.artworkCreate).toHaveBeenCalledOnce()
  })

  it('rejects a frozen identity when the transactional lock predicate no longer matches', async () => {
    const fixture = pixivTransaction([])
    fixture.queryRaw.mockResolvedValue([])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'audit-apply:item-1',
        metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
        metadataContentHash: 'a'.repeat(64),
        metadata: pixivMetadata(),
        media: [],
        existingPolicy: 'REFRESH',
        manageCheckpoint: false,
        expectedIdentity: {
          expectedExternalId: '42',
          expectedInventoryId: 'inventory-1',
          expectedExternalRefId: null,
          expectedArtworkId: null,
          expectedProcessedContentHash: null
        },
        now
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(fixture.artworkCreate).not.toHaveBeenCalled()
  })
})

function localWork(): Prisma.ScanRunLocalWorkInputGetPayload<Record<string, never>> {
  return {
    dedupSourceSnapshot: localSourceProofFixture(),
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

function pixivTransaction(existingImages: Array<{ id: number; path: string; sortOrder: number }>) {
  const imageCreate = vi.fn(async (input: { data: Record<string, unknown>[] }) => ({ count: input.data.length }))
  const imageUpdate = vi.fn(async (_input: { where: { id: number }; data: Record<string, unknown> }) => ({}))
  const artworkCreate = vi.fn(async (_input: { data: Record<string, unknown>; select: { id: true } }) => ({ id: 42 }))
  const artworkSourceSnapshotUpsert = vi.fn(async () => ({}))
  const artworkExternalRefUpsert = vi.fn(async () => ({ id: 'ref-1' }))
  const queryRaw = vi.fn(async () => [{ id: 'inventory-1' }])
  const inventoryFindUnique = vi.fn(async () => ({
    id: 'inventory-1',
    externalId: '42',
    externalRefId: null,
    processedContentHash: null
  }))
  const transaction = {
    artworkSummaryFeature: { findUnique: vi.fn(async () => null) },
    $queryRaw: queryRaw,
    userSetting: { findMany: vi.fn(async () => []) },
    scanRunItem: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    artworkExternalRef: {
      findUnique: vi.fn(async () => null),
      upsert: artworkExternalRefUpsert
    },
    artistExternalRef: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'artist-ref-1' }))
    },
    artworkArtistEvidence: { updateMany: vi.fn(async () => ({ count: 1 })) },
    artworkSourceSnapshot: { upsert: artworkSourceSnapshotUpsert },
    pixivMetadataInventory: { findUnique: inventoryFindUnique },
    artwork: { findUnique: vi.fn(async () => null), create: artworkCreate },
    artist: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 7 }))
    },
    artworkTag: { deleteMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn(async () => ({})) },
    image: {
      findMany: vi.fn(async () => existingImages),
      createMany: imageCreate,
      update: imageUpdate
    },
    scanRun: { updateMany: vi.fn(async () => ({ count: 1 })) }
  } as unknown as ScanTransaction
  return {
    transaction,
    artworkCreate,
    artworkExternalRefUpsert,
    artworkSourceSnapshotUpsert,
    queryRaw,
    inventoryFindUnique,
    imageCreate,
    imageUpdate
  }
}

type TagProvenance = 'SOURCE' | 'MANUAL' | 'DERIVED' | 'LEGACY'

function existingPixivTransaction(
  options: {
    titleOverridden?: boolean
    descriptionOverridden?: boolean
    artworkExternalId?: string
    existingImages?: Array<{ id: number; path: string; sortOrder: number }>
    tags?: Array<{ tagId: number; provenance: TagProvenance; sourceRefId: string | null }>
    tagIdsByName?: Map<string, number>
  } = {}
) {
  const tags = options.tags ? [...options.tags] : []
  const artworkState: Record<string, unknown> = {
    externalId: options.artworkExternalId ?? 'legacy-local-42',
    title: 'Curated title',
    description: 'Curated description',
    descriptionLength: 19,
    titleOverridden: options.titleOverridden ?? false,
    descriptionOverridden: options.descriptionOverridden ?? false
  }
  const artworkUpdate = vi.fn(async (input: { where: { id: number }; data: Record<string, unknown> }) => {
    Object.assign(artworkState, input.data)
    return artworkState
  })
  const artworkUpdateMany = vi.fn(
    async (input: {
      where: { id: number; titleOverridden?: boolean; descriptionOverridden?: boolean }
      data: Record<string, unknown>
    }) => {
      const matchesTitle =
        input.where.titleOverridden === undefined || artworkState.titleOverridden === input.where.titleOverridden
      const matchesDescription =
        input.where.descriptionOverridden === undefined ||
        artworkState.descriptionOverridden === input.where.descriptionOverridden
      if (!matchesTitle || !matchesDescription) return { count: 0 }
      Object.assign(artworkState, input.data)
      return { count: 1 }
    }
  )
  const artistUpsert = vi.fn(async () => ({ id: 7 }))
  const imageUpdate = vi.fn(async (_input: { where: { id: number }; data: Record<string, unknown> }) => ({}))
  const imageCreate = vi.fn(async (input: { data: Record<string, unknown>[] }) => ({ count: input.data.length }))
  const imageDeleteMany = vi.fn(async () => ({ count: 0 }))
  const artworkSourceSnapshotUpsert = vi.fn(async () => ({}))
  const artworkTagCreateMany = vi.fn(async ({ data }) => {
    for (const row of data)
      if (!tags.some((existing) => existing.tagId === row.tagId))
        tags.push({
          tagId: row.tagId,
          provenance: row.provenance,
          sourceRefId: row.sourceRefId
        })
    return { count: data.length }
  })
  const artworkTagUpdateMany = vi.fn(async ({ where, data }) => {
    const matching = tags.filter(
      (row) =>
        where.tagId.in.includes(row.tagId) &&
        row.provenance === where.provenance &&
        row.sourceRefId === where.sourceRefId
    )
    for (const row of matching) Object.assign(row, data)
    return { count: matching.length }
  })
  const artworkTagDeleteMany = vi.fn(async ({ where }) => {
    const incoming = new Set<number>(where.tagId?.notIn ?? [])
    let deleted = 0
    for (let index = tags.length - 1; index >= 0; index -= 1) {
      const row = tags[index]!
      if (
        row.provenance === where.provenance &&
        row.sourceRefId === where.sourceRefId &&
        (incoming.size === 0 || !incoming.has(row.tagId))
      ) {
        tags.splice(index, 1)
        deleted += 1
      }
    }
    return { count: deleted }
  })
  const transaction = {
    artworkSummaryFeature: { findUnique: vi.fn(async () => null) },
    scanRunItem: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    artworkExternalRef: {
      findUnique: vi.fn(async () => ({
        id: 'ref-pixiv',
        artwork: {
          id: 42,
          externalId: artworkState.externalId
        }
      })),
      upsert: vi.fn(async () => ({ id: 'ref-pixiv' }))
    },
    artworkArtistEvidence: { updateMany: vi.fn(async () => ({ count: 1 })) },
    artworkSourceSnapshot: { upsert: artworkSourceSnapshotUpsert },
    artwork: { update: artworkUpdate, updateMany: artworkUpdateMany },
    artist: { upsert: artistUpsert },
    artworkRawMetadata: { upsert: vi.fn(async () => ({})) },
    tag: {
      findMany: vi.fn(async ({ where }) =>
        where.name.in.map((name: string) => ({ name, id: options.tagIdsByName?.get(name) }))
      )
    },
    artworkTag: {
      deleteMany: artworkTagDeleteMany,
      updateMany: artworkTagUpdateMany,
      createMany: artworkTagCreateMany
    },
    image: {
      findMany: vi.fn(async () => options.existingImages ?? []),
      createMany: imageCreate,
      update: imageUpdate,
      deleteMany: imageDeleteMany
    },
    scanRun: { updateMany: vi.fn(async () => ({ count: 1 })) }
  } as unknown as ScanTransaction
  return {
    transaction,
    artworkState,
    tags,
    artworkUpdate,
    artworkUpdateMany,
    artistUpsert,
    artworkSourceSnapshotUpsert,
    artworkTagCreateMany,
    imageUpdate,
    imageCreate,
    imageDeleteMany
  }
}

it('retains a confirmed animation when Pixiv refresh proves the same complete source identity', async () => {
  const media = confirmedAnimationFixture('11/42/42_p0.webp')
  const fixture = existingPixivTransaction({ existingImages: [media.previous] })
  await publishPixivArtwork({
    transaction: fixture.transaction,
    runId: 'run-1',
    checkpointOrdinal: 0,
    checkpointKey: 'metadata:0:refresh',
    metadataRelativePath: '11/42/42-meta.json',
        dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
    metadataContentHash: 'a'.repeat(64),
    metadata: pixivMetadata(),
    media: [
      {
        ...pixivMedia(media.previous.path),
        size: 100n,
        mediaType: 'IMAGE',
        webpAnimationStatus: 0,
        sourceState: media.sourceState
      }
    ],
    existingPolicy: 'REFRESH',
    now
  })
  expect(fixture.imageUpdate).toHaveBeenCalledWith({
    where: { id: 11 },
    data: expect.objectContaining({ mediaType: 'ANIMATION', webpAnimationStatus: 2 })
  })
})

function pixivInput(transaction: ScanTransaction) {
  return {
    transaction,
    runId: 'run-1',
    checkpointOrdinal: 0,
    checkpointKey: 'metadata:0:bulk',
    metadataRelativePath: '11/42/42-meta.json',
    dedupSourceSnapshot: pixivSourceProofFixture('11/42/42-meta.json'),
    metadataContentHash: 'a'.repeat(64),
    metadata: pixivMetadata(),
    existingPolicy: 'REFRESH' as const,
    now
  }
}

it('inserts 501 new media in bounded batches without dropping conflicts, then initializes reading', async () => {
  const fixture = pixivTransaction([])
  const media = Array.from({ length: 501 }, (_, index) => pixivMedia('11/42/42_p' + index + '.mp4'))
  const result = await publishPixivArtwork({ ...pixivInput(fixture.transaction), media })
  expect(result.newImages).toBe(501)
  expect(fixture.imageCreate.mock.calls.map(([input]) => input.data.length)).toEqual([500, 1])
  expect(fixture.imageCreate.mock.calls[0]![0]).not.toHaveProperty('skipDuplicates')
  expect(fixture.imageCreate.mock.calls[1]![0].data[0]).toMatchObject({ sortOrder: 500 })
  expect(fixture.transaction.userSetting.findMany).toHaveBeenCalledAfter(fixture.imageCreate)
})

it('uses actual inserted counts and lets insertion errors abort publication before checkpoint/read initialization', async () => {
  const fixture = pixivTransaction([])
  fixture.imageCreate.mockResolvedValueOnce({ count: 0 })
  expect(
    await publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [pixivMedia('11/42/new.mp4')] })
  ).toMatchObject({ newImages: 0 })
  fixture.imageCreate.mockRejectedValueOnce(new Error('unique constraint'))
  vi.mocked(fixture.transaction.scanRunItem.upsert).mockClear()
  vi.mocked(fixture.transaction.userSetting.findMany).mockClear()
  await expect(
    publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [pixivMedia('11/42/new.mp4')] })
  ).rejects.toThrow('unique constraint')
  expect(fixture.transaction.scanRunItem.upsert).not.toHaveBeenCalled()
  expect(fixture.transaction.userSetting.findMany).not.toHaveBeenCalled()
})

it('rejects colliding incoming paths without writing images', async () => {
  const fixture = pixivTransaction([])
  await expect(
    publishPixivArtwork({
      ...pixivInput(fixture.transaction),
      media: [pixivMedia('11/42/a.mp4'), pixivMedia('/11/42/A.mp4')]
    })
  ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
  expect(fixture.imageCreate).not.toHaveBeenCalled()
})

it('retains chapter sampling time and skips unchanged Image updates while appending new media after the maximum order', async () => {
  const incoming = pixivMedia('11/42/42_p0.mp4')
  const existing = {
    ...incoming,
    id: 9,
    path: incoming.relativePath,
    sortOrder: 17,
    chaptersUpdatedAt: mediaModifiedAt
  }
  const fixture = existingPixivTransaction({ existingImages: [existing] })
  await publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [incoming, pixivMedia('11/42/42_p1.mp4')] })
  expect(fixture.imageUpdate).not.toHaveBeenCalled()
  expect(fixture.imageCreate).toHaveBeenCalledWith({ data: [expect.objectContaining({ sortOrder: 18 })] })
})

it('checks summary and invalidates changed animation source even if final Image fields are identical', async () => {
  const incoming = pixivMedia('11/42/42_p0.mp4')
  const sourceState = { sizeBytes: 5n, mtimeMs: 99n, ctimeMs: 2n, deviceId: 3n, inode: 4n }
  const existing = {
    ...incoming,
    id: 9,
    path: incoming.relativePath,
    sortOrder: 1,
    chaptersUpdatedAt: mediaModifiedAt,
    animationMetadata: {
      ...confirmedAnimationFixture(incoming.relativePath).previous.animationMetadata,
      sourceSize: 5n
    }
  }
  const fixture = existingPixivTransaction({ existingImages: [existing] })
  await publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [{ ...incoming, sourceState }] })
  expect(fixture.imageUpdate).not.toHaveBeenCalled()
  expect(checkArtworkSummarySource).toHaveBeenCalledWith(fixture.transaction, 9, incoming.relativePath, {
    ...sourceState,
    size: 5n
  })
  expect(invalidateAnimationDurationSource).toHaveBeenCalledWith(fixture.transaction, {
    imageId: 9,
    sourcePath: incoming.relativePath
  })
})

it('records real settlement timing and leaves unmeasured durations unknown', async () => {
  const fixture = pixivTransaction([])
  const timing = { startedAt: now, finishedAt: new Date(now.getTime() + 30), durationMs: 29 }
  await publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [], checkpointTiming: () => timing })
  expect(fixture.transaction.scanRunItem.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ create: expect.objectContaining(timing), update: expect.objectContaining(timing) })
  )
  await publishPixivArtwork({ ...pixivInput(fixture.transaction), media: [] })
  const call = vi.mocked(fixture.transaction.scanRunItem.upsert).mock.calls.at(-1)![0]
  expect(call.create).not.toHaveProperty('durationMs')
})

it('creates only missing general tags in one batch without changing existing tag attributes', async () => {
  const findMany = vi
    .fn()
    .mockResolvedValueOnce([{ id: 1, name: 'existing' }])
    .mockResolvedValueOnce([
      { id: 1, name: 'existing' },
      { id: 2, name: 'missing' }
    ])
  const createMany = vi.fn(async () => ({ count: 1 }))
  const tag = { findMany, createMany, update: vi.fn(), upsert: vi.fn() }
  const artworkTag = { deleteMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() }
  await replacePixivSourceTags({ tag, artworkTag } as unknown as ScanTransaction, 42, 'ref-pixiv', [
    'existing',
    'missing',
    'missing'
  ])
  expect(createMany).toHaveBeenCalledWith({ data: [{ namespace: 'general', name: 'missing' }], skipDuplicates: true })
  expect(tag.update).not.toHaveBeenCalled()
  expect(tag.upsert).not.toHaveBeenCalled()
  expect(artworkTag.createMany).toHaveBeenCalledWith({
    data: [1, 2].map((tagId) => ({ artworkId: 42, tagId, provenance: 'SOURCE', sourceRefId: 'ref-pixiv' })),
    skipDuplicates: true
  })
})
