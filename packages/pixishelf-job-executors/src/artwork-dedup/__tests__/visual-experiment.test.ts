import { describe, expect, it } from 'vitest'
import {
  compareVisual,
  dctHash,
  featureFromGray96,
  hamming,
  pairPages,
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
})
