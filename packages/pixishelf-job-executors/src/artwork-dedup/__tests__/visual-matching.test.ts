import { describe, expect, it } from 'vitest'
import fixture from './visual-template-regression.json'
import { assignVisualPair, compareProductionVisual, matchVisualPages, validVisualViews, visualIdentity } from '../visual-matching.ts'
import { compareVisualViews, VISUAL_PARAMETER_PRESETS, type VisualView } from '../visual-experiment.ts'
describe('production suspected versions', () => {
  it('rejects the observed cropped global12/local0 template false pair without changing the historical experiment', () => {
    const a = fixture['fresh-03-template-0'], b = fixture['fresh-09-template-0']
    expect(compareVisualViews(a, b, VISUAL_PARAMETER_PRESETS[1]!).matched).toBe(true)
    expect(compareProductionVisual(a, b).matched).toBe(false)
    expect(compareProductionVisual(a, a).matched).toBe(true)
  })
  it('requires local information for crop acceptance and keeps one informative agreement sufficient', () => {
    const a = [{ name: 'trim-crop5', feature: { width: 96, height: 96, hashes: Array<string>(10).fill('0000000000000000'), information: Array<number>(10).fill(30) } }]
    const b = [{ name: 'original', feature: { ...a[0]!.feature, hashes: ['0000000000000fff', ...Array<string>(9).fill('ffffffffffffffff')] } }]
    expect(compareProductionVisual(a, b).matched).toBe(false)
    b[0]!.feature.hashes[1] = '0000000000000000'
    expect(compareProductionVisual(a, b).matched).toBe(true)
    b[0]!.feature.information = [30, ...Array<number>(9).fill(0)]
    expect(compareProductionVisual(a, b).matched).toBe(false)
  })
  it('never pairs two page occurrences to one right page and reports budgets instead of partial results', async () => {
    const views = fixture['fresh-03-template-0'] as VisualView[]
    const page = (imageId: number, artworkId: number) => ({ imageId, artworkId, index: imageId, size: 5n, sha256: String(imageId), views })
    expect((await matchVisualPages([page(1, 1), page(2, 1), page(3, 2)], async () => {})).pairs).toHaveLength(0)
    const run = await matchVisualPages(Array.from({ length: 2001 }, (_, i) => page(i, 1)), async () => {})
    expect(run).toEqual({ pairs: [], reason: 'VISUAL_ARTWORK_BUDGET' })
  })
  it('validates persisted feature structure and invalidates identity on source, content, stat or root changes', () => {
    expect(validVisualViews(fixture['fresh-03-template-0'])).toBe(true)
    expect(validVisualViews([{ name: 'x', feature: { hashes: [] } }])).toBe(false)
    const row = { imageId: 1, sourceRevision: 1n, sourcePath: 'a.png', rootIdentity: 'r', directoryId: 'd', directoryGeneration: 1n,
      canonicalPath: 'a.png', sha256: 'a', size: 1n, mtimeNs: 1n, ctimeNs: 1n, deviceId: 1n, inode: 1n }
    for (const change of [{ sourceRevision: 2n }, { sha256: 'b' }, { mtimeNs: 2n }, { directoryGeneration: 2n }, { rootIdentity: 'new' }])
      expect(visualIdentity({ ...row, ...change })).not.toBe(visualIdentity(row))
  })
})


describe('mixed originals in visual matching', () => {
  const page = (imageId: number, artworkId: number, unchecked = false) => ({ imageId, artworkId, index: imageId % 10,
    size: 5n, sha256: String(imageId), views: unchecked ? [] : fixture['fresh-03-template-0'] as VisualView[], unchecked })
  it('retains real indices and accounts for unchecked originals separately, even when their bytes match', () => {
    const left = Array.from({ length: 5 }, (_, i) => page(i + 1, 1, i === 0))
    const right = Array.from({ length: 6 }, (_, i) => page(i + 11, 2, i === 0))
    right[0]!.sha256 = left[0]!.sha256
    const edges = new Map(left.slice(1).map((p, i) => [p.imageId, new Set([right[i + 1]!.imageId])]))
    const pair = assignVisualPair(left, right, edges)!
    expect(pair.pages.map(p => p.kind)).toEqual(['UNCHECKED', 'SIMILAR', 'SIMILAR', 'SIMILAR', 'SIMILAR', 'UNCHECKED', 'UNMATCHED'])
    expect(pair.pages[0]).toMatchObject({ left: { imageId: 1, index: 1 }, right: null })
    expect(pair.pages[5]).toMatchObject({ left: null, right: { imageId: 11, index: 1 } })
  })
  it('keeps the 80% denominator over all originals and never visual-matches animation-only works', async () => {
    const left = Array.from({ length: 5 }, (_, i) => page(i + 1, 1, i !== 0))
    const right = Array.from({ length: 5 }, (_, i) => page(i + 11, 2, i !== 0))
    expect(assignVisualPair(left, right, new Map([[1, new Set([11])]]))).toBeNull()
    expect((await matchVisualPages([page(1, 1, true), page(11, 2, true)], async () => {})).pairs).toEqual([])
  })
})
