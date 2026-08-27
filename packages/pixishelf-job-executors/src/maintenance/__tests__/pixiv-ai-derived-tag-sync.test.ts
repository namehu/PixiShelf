import { describe, expect, it, vi } from 'vitest'
import { PIXIV_AI_DERIVED_TAG_SYNC_BATCH_SIZE, syncPixivAiDerivedTags } from '../pixiv-ai-derived-tag-sync.js'
import type { RunMaintenanceMutation } from '../types.js'

describe('Pixiv AI derived-tag maintenance', () => {
  it('audits historical source conversion and stale derived removal without writing', async () => {
    const mutate = vi.fn()
    const artworkFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, pixivAiType: 2, isAiGenerated: false },
        { id: 2, pixivAiType: 1, isAiGenerated: true }
      ])
      .mockResolvedValueOnce([])
    const result = await syncPixivAiDerivedTags({
      payload: { dryRun: true },
      database: {
        artwork: { count: vi.fn().mockResolvedValue(2), findMany: artworkFindMany },
        tag: { findFirst: vi.fn().mockResolvedValue({ id: 99 }) },
        artworkTag: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([
            { id: 11, artworkId: 1, provenance: 'SOURCE', sourceRef: { providerKey: 'pixiv' } },
            { id: 12, artworkId: 2, provenance: 'DERIVED', sourceRef: null }
          ])
        }
      } as never,
      mutate: mutate as never,
      signal: new AbortController().signal,
      progress: vi.fn()
    })

    expect(result).toMatchObject({
      dryRun: true,
      scannedArtworks: 2,
      aiGeneratedArtworks: 1,
      nonAiArtworks: 1,
      wouldConvertSourceRelations: 1,
      wouldRemoveStaleDerivedRelations: 1,
      finalDerivedRelations: 1
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(artworkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' }, take: PIXIV_AI_DERIVED_TAG_SYNC_BATCH_SIZE })
    )
  })

  it('applies idempotent batches while preserving manual relations and using pixivAiType first', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const transaction = {
      tag: {
        findFirst: vi.fn().mockResolvedValue({ id: 99 }),
        update: vi.fn().mockResolvedValue({ id: 99 }),
        create: vi.fn()
      },
      artworkTag: { createMany, updateMany, deleteMany }
    }
    const artworkFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, pixivAiType: 2, isAiGenerated: false },
        { id: 2, pixivAiType: 2, isAiGenerated: true },
        { id: 3, pixivAiType: 2, isAiGenerated: true },
        { id: 4, pixivAiType: 1, isAiGenerated: true },
        { id: 5, pixivAiType: null, isAiGenerated: true }
      ])
      .mockResolvedValueOnce([])
    const count = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3)

    const result = await syncPixivAiDerivedTags({
      payload: { dryRun: false },
      database: {
        artwork: { count: vi.fn().mockResolvedValue(5), findMany: artworkFindMany },
        tag: { findFirst: vi.fn().mockResolvedValue({ id: 99 }) },
        artworkTag: {
          count,
          findMany: vi.fn().mockResolvedValue([
            { id: 12, artworkId: 2, provenance: 'SOURCE', sourceRef: { providerKey: 'pixiv' } },
            { id: 13, artworkId: 3, provenance: 'MANUAL', sourceRef: null },
            { id: 14, artworkId: 4, provenance: 'DERIVED', sourceRef: null },
            { id: 15, artworkId: 5, provenance: 'LEGACY', sourceRef: null }
          ])
        }
      } as never,
      mutate: (async (operation) => operation(transaction as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn()
    })

    expect(result).toMatchObject({
      dryRun: false,
      scannedArtworks: 5,
      aiGeneratedArtworks: 4,
      nonAiArtworks: 1,
      wouldCreateDerivedRelations: 1,
      wouldConvertSourceRelations: 1,
      wouldConvertLegacyRelations: 1,
      wouldRemoveStaleDerivedRelations: 1,
      protectedManualRelations: 1,
      appliedCreatedRelations: 1,
      appliedConvertedRelations: 2,
      appliedRemovedRelations: 1,
      finalDerivedRelations: 3
    })
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provenance: 'DERIVED' }) })
    )
  })
})
