import { describe, expect, it } from 'vitest'
import {
  compareVisual,
  dctHash,
  featureFromGray96,
  hamming,
  pairPages,
  whiteBorderRectangle,
  insetRectangle,
  compareVisualViews,
  VisualViewIndex,
  VISUAL_PARAMETER_PRESETS
} from '../visual-experiment.ts'

describe('offline visual experiment', () => {
  it('has a reproducible DC-independent hash and rejects flat fields as evidence', () => {
    const field = Uint8Array.from({ length: 1024 }, (_, i) => 20 + ((i * 37 + Math.floor(i / 32) * 19) % 160))
    const shifted = field.map((v) => v + 20)
    expect(hamming(dctHash(field).hash, dctHash(shifted).hash)).toBe(0)
    const white = featureFromGray96(new Uint8Array(9216).fill(255), 96, 96)
    expect(white.information.every((v) => v === 0)).toBe(true)
    expect(compareVisual(white, white, VISUAL_PARAMETER_PRESETS[0]!, true).matched).toBe(false)
  })

  it('uses informative local agreement without bypassing aspect or global ceilings', () => {
    const feature = {
      width: 96,
      height: 96,
      hashes: Array<string>(10).fill('0000000000000000'),
      information: Array<number>(10).fill(30)
    }
    const changed = { ...feature, hashes: ['00000000000fffff', ...feature.hashes.slice(1)] }
    const p = VISUAL_PARAMETER_PRESETS[1]!
    expect(compareVisual(feature, changed, p, false).matched).toBe(false)
    expect(compareVisual(feature, changed, p, true).matched).toBe(true)
    expect(compareVisual(feature, { ...changed, information: Array<number>(10).fill(0) }, p, true).matched).toBe(false)
    expect(compareVisual(feature, { ...changed, width: 192 }, p, true).matched).toBe(false)
    expect(
      compareVisual(feature, { ...changed, hashes: ['ffffffffffffffff', ...feature.hashes.slice(1)] }, p, true).matched
    ).toBe(false)
  })

  it('never allows two occurrences to consume one target page', () => {
    const result = pairPages([[0], [0]], 1)
    expect(result.matched).toBe(1)
    expect(result.leftUnmatched).toBe(1)
    expect(result.ambiguousRight).toBe(1)
  })

  it('finds augmenting assignments and preserves ambiguity', () => {
    const result = pairPages([[0, 1], [0]], 2)
    expect(result.matched).toBe(2)
    expect(result.pairs).toEqual([
      { left: 1, right: 0 },
      { left: 0, right: 1 }
    ])
    expect(result.ambiguousLeft).toBe(1)
    expect(result.ambiguousRight).toBe(1)
  })

  it('rejects malformed feature inputs and target indexes', () => {
    expect(() => featureFromGray96(new Uint8Array(10), 10, 1)).toThrow()
    expect(() => dctHash(new Uint8Array(10))).toThrow()
    expect(() => pairPages([[2]], 2)).toThrow()
  })

  it('trims qualifying edges but retains flat images and over-wide white margins', () => {
    const image = new Uint8Array(100 * 100 * 3).fill(250)
    for (let y = 10; y < 90; y++) for (let x = 10; x < 90; x++) image.fill(30, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3)
    expect(whiteBorderRectangle(image, 100, 100)).toEqual({ left: 10, top: 10, width: 80, height: 80 })
    expect(insetRectangle({ left: 10, top: 10, width: 80, height: 80 }, 0.05)).toEqual({
      left: 14,
      top: 14,
      width: 72,
      height: 72
    })
    expect(whiteBorderRectangle(new Uint8Array(30000).fill(255), 100, 100)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100
    })
    const broad = new Uint8Array(30000).fill(0)
    for (let y = 0; y < 100; y++) broad.fill(255, y * 300, y * 300 + 21 * 3)
    expect(whiteBorderRectangle(broad, 100, 100).left).toBe(0)
    expect(() => whiteBorderRectangle(new Uint8Array(1), 1, 1)).toThrow()
  })

  it('requires 99.5 percent white pixels and all three channels at least 245', () => {
    const image = new Uint8Array(100 * 100 * 3)
    image.fill(255, 0, 300)
    image[0] = 244
    expect(whiteBorderRectangle(image, 100, 100).top).toBe(0)
    image[0] = 245
    expect(whiteBorderRectangle(image, 100, 100).top).toBe(1)
  })

  it('retrieves across view names and does not use flat regions as candidates', () => {
    const feature = {
      width: 96,
      height: 96,
      hashes: Array<string>(10).fill('0000000000000000'),
      information: Array<number>(10).fill(30)
    }
    const index = new VisualViewIndex()
    index.add(7, [{ name: 'white-trim', feature }])
    const query = index.query([{ name: 'original', feature }])
    expect(query.status).toBe('complete')
    expect(query.candidates).toEqual([7])
    expect(
      compareVisualViews(
        [{ name: 'original', feature }],
        [{ name: 'white-trim', feature }],
        VISUAL_PARAMETER_PRESETS[1]!
      ).matched
    ).toBe(true)
    expect(
      index.query([{ name: 'original', feature: { ...feature, information: Array<number>(10).fill(0) } }]).candidates
    ).toEqual([])
  })

  it('reports both posting exhaustion with duplicate pages and unique-candidate exhaustion', () => {
    const feature = {
      width: 96,
      height: 96,
      hashes: Array<string>(10).fill('0000000000000000'),
      information: Array<number>(10).fill(30)
    }
    const views = [{ name: 'original', feature }]
    const repeated = new VisualViewIndex()
    repeated.add(1, views)
    const posting = repeated.query(views, 2, 20_000)
    expect(posting).toMatchObject({ status: 'incomplete', reason: 'posting-budget', postingVisits: 2, candidates: [1] })
    const unique = new VisualViewIndex()
    unique.add(1, views)
    unique.add(2, views)
    expect(unique.query(views, 20_000, 1)).toMatchObject({
      status: 'incomplete',
      reason: 'candidate-budget',
      candidates: [1]
    })
    expect(() => compareVisualViews([], views, VISUAL_PARAMETER_PRESETS[1]!)).toThrow()
    expect(() => compareVisualViews(Array(5).fill(views[0]), views, VISUAL_PARAMETER_PRESETS[1]!)).toThrow()
  })
})
