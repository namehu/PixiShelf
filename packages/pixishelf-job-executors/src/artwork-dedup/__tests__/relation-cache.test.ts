import { describe, expect, it } from 'vitest'
import { matchVisualPages, type VisualPage } from '../visual-matching.ts'
import { visualRelationSignature } from '../relation-cache.ts'
function page(imageId: number, artworkId: number, hash = '0000000000000000'): VisualPage {
  return { imageId, artworkId, index: imageId, size: 5n, sha256: String(imageId), views: [{ name: 'original', feature: {
    width: 96, height: 96, hashes: Array<string>(10).fill(hash), information: Array<number>(10).fill(30)
  } }] }
}
const checkpoint = async () => {}
describe('F02 relation complete-input reuse', () => {
  it('reuses direct positive and negative pairs without transitive A~B~C inference and admits new work', async () => {
    const pages = [page(1, 1), page(2, 2, '0000000000000fff'), page(3, 3, '0000000000ffffff')]
    const cold = await matchVisualPages(pages, checkpoint)
    expect(cold.pairs.map(p => [p.leftArtworkId, p.rightArtworkId])).toEqual([[1, 2], [2, 3]])
    const reuse = { artworks: new Set([1, 2, 3]), candidatePairs: cold.candidatePairs!, pairs: cold.pairs }
    const hot = await matchVisualPages(pages, checkpoint, reuse)
    expect(hot).toMatchObject({ comparedComparisons: 0, reusedComparisons: 3, pairs: cold.pairs })
    const added = await matchVisualPages([...pages, page(4, 4, '0000000000ffffff')], checkpoint, reuse)
    expect(added.pairs.map(p => [p.leftArtworkId, p.rightArtworkId])).toEqual([[1, 2], [2, 3], [2, 4], [3, 4]])
    expect(added).toMatchObject({ comparedComparisons: 3, reusedComparisons: 3 })
  })
  it('rechecks current dense posting budgets even when prior inputs and negative evidence are unchanged', async () => {
    const pages = [page(1, 1), page(2, 2)]
    const cold = await matchVisualPages(pages, checkpoint)
    const dense = [...pages, ...Array.from({ length: 499 }, (_, i) => page(i + 3, i + 3))]
    expect(await matchVisualPages(dense, checkpoint, { artworks: new Set([1, 2]), candidatePairs: cold.candidatePairs!, pairs: cold.pairs }))
      .toEqual({ pairs: [], reason: 'VISUAL_POSTING_BUDGET' })
  })
  it('retains below-threshold candidate pairs in the current artwork-pair budget', async () => {
    const pages = Array.from({ length: 88 }, (_, i) => page(i + 1, Math.floor(i / 2) + 1))
    const cold = await matchVisualPages(pages, checkpoint)
    expect(cold.reason).toBeNull(); expect(cold.pairs).toHaveLength(0); expect(cold.candidatePairs).toHaveLength(946)
    expect(await matchVisualPages([...pages, page(89, 45), page(90, 45), page(91, 46), page(92, 46)], checkpoint,
      { artworks: new Set(pages.map(p => p.artworkId)), candidatePairs: cold.candidatePairs!, pairs: [] }))
      .toEqual({ pairs: [], reason: 'VISUAL_PAIR_BUDGET' })
  })
  it('signs complete feature inputs and IDs while leaving display order out', () => {
    const pages = [page(1, 1), page(2, 1)]
    expect(visualRelationSignature(pages)).toBe(visualRelationSignature([...pages].reverse().map(p => ({ ...p, index: 99 }))))
    for (const changed of [{ ...pages[0]!, imageId: 3 }, { ...pages[0]!, sha256: 'new' }, { ...pages[0]!, size: 6n }, page(1, 1, '0000000000000001')])
      expect(visualRelationSignature([changed, pages[1]!])).not.toBe(visualRelationSignature(pages))
  })
})
