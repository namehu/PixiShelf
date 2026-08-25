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
      metadataContentHash: 'a'.repeat(64),
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
    const fixture = pixivTransaction([{ id: 99, path: '/11/42/42_p0.mp4', sortOrder: 8 }])

    await expect(
      publishPixivArtwork({
        transaction: fixture.transaction,
        runId: 'run-1',
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:legacy',
        metadataRelativePath: '11/42/42-meta.json',
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
    expect(fixture.artworkTagUpsert).toHaveBeenCalledTimes(6)
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
      data: expect.objectContaining({ artworkId: 42, path: '11/42/42_p1.mp4', sortOrder: 9 })
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
  const imageCreate = vi.fn(async (_input: { data: Record<string, unknown> }) => ({}))
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
    $queryRaw: queryRaw,
    scanRunItem: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    artworkExternalRef: {
      findUnique: vi.fn(async () => null),
      upsert: artworkExternalRefUpsert
    },
    artistExternalRef: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'artist-ref-1' }))
    },
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
      create: imageCreate,
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
  const imageCreate = vi.fn(async (_input: { data: Record<string, unknown> }) => ({}))
  const imageDeleteMany = vi.fn(async () => ({ count: 0 }))
  const artworkSourceSnapshotUpsert = vi.fn(async () => ({}))
  const artworkTagUpsert = vi.fn(async ({ where, create, update }) => {
    const existing = tags.find((row) => row.tagId === where.artworkId_tagId.tagId)
    if (!existing) tags.push({ tagId: create.tagId, provenance: create.provenance, sourceRefId: create.sourceRefId })
    if (Object.keys(update).length > 0) throw new Error('The fixture only supports ownership-preserving upserts')
    return existing ?? create
  })
  const artworkTagUpdateMany = vi.fn(async ({ where, data }) => {
    const existing = tags.find(
      (row) => row.tagId === where.tagId && row.provenance === where.provenance && row.sourceRefId === where.sourceRefId
    )
    if (!existing) return { count: 0 }
    Object.assign(existing, data)
    return { count: 1 }
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
    artworkSourceSnapshot: { upsert: artworkSourceSnapshotUpsert },
    artwork: { update: artworkUpdate, updateMany: artworkUpdateMany },
    artist: { upsert: artistUpsert },
    artworkRawMetadata: { upsert: vi.fn(async () => ({})) },
    tag: {
      upsert: vi.fn(async ({ where }) => {
        const name = where.namespace_name.name as string
        const id = options.tagIdsByName?.get(name)
        if (id === undefined) throw new Error(`Missing fixture tag id for ${name}`)
        return { id }
      })
    },
    artworkTag: { deleteMany: artworkTagDeleteMany, updateMany: artworkTagUpdateMany, upsert: artworkTagUpsert },
    image: {
      findMany: vi.fn(async () => options.existingImages ?? []),
      create: imageCreate,
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
    artworkTagUpsert,
    imageUpdate,
    imageCreate,
    imageDeleteMany
  }
}
