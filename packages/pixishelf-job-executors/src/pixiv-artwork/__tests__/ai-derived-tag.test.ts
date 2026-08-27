import { describe, expect, it, vi } from 'vitest'
import {
  normalizeImportedPixivSourceTags,
  reconcilePixivAiGeneratedTag,
  resolvePixivAiGenerated
} from '../ai-derived-tag.js'

describe('Pixiv AI derived tag', () => {
  it('prefers Pixiv aiType and removes only the downloader-generated source tag', () => {
    expect(resolvePixivAiGenerated(2, false)).toBe(true)
    expect(resolvePixivAiGenerated(1, true)).toBe(false)
    expect(resolvePixivAiGenerated(null, true)).toBe(true)
    expect(resolvePixivAiGenerated(null, false)).toBe(false)
    expect(resolvePixivAiGenerated(null, null)).toBeNull()
    expect(normalizeImportedPixivSourceTags(['R-18', 'AI生成', '原神'], true)).toEqual(['R-18', '原神'])
    expect(normalizeImportedPixivSourceTags(['AI生成'], false)).toEqual(['AI生成'])
  })

  it('converts an owned source relation to derived without touching protected ownership', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const transaction = {
      tag: { findFirst: vi.fn().mockResolvedValue({ id: 9 }) },
      artworkTag: {
        findUnique: vi.fn().mockResolvedValue({ id: 4, provenance: 'SOURCE', sourceRefId: 'pixiv-ref' }),
        update
      }
    }
    await expect(
      reconcilePixivAiGeneratedTag(transaction as never, {
        artworkId: 1,
        sourceRefId: 'pixiv-ref',
        sourceTags: [],
        isAiGenerated: true
      })
    ).resolves.toBe('CONVERTED_TO_DERIVED')
    expect(update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { provenance: 'DERIVED', sourceRefId: null }
    })

    transaction.artworkTag.findUnique.mockResolvedValue({ id: 5, provenance: 'MANUAL', sourceRefId: null })
    await expect(
      reconcilePixivAiGeneratedTag(transaction as never, {
        artworkId: 1,
        sourceRefId: 'pixiv-ref',
        sourceTags: [],
        isAiGenerated: true
      })
    ).resolves.toBe('PROTECTED')
    expect(update).toHaveBeenCalledTimes(1)
  })
})
