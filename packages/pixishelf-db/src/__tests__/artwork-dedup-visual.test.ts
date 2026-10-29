import { describe, expect, it } from 'vitest'
import { ARTWORK_DEDUP_MIXED_VISUAL_EVIDENCE_VERSION, ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION, assertArtworkDedupVisualSummary } from '../artwork-dedup-visual'
const mixed = { evidenceVersion: ARTWORK_DEDUP_MIXED_VISUAL_EVIDENCE_VERSION, leftArtworkId: 1, rightArtworkId: 2,
  leftFileCount: '5', rightFileCount: '6', pairedCount: '4', exactCount: '3', similarCount: '1',
  leftUnmatchedCount: '0', rightUnmatchedCount: '1', leftUncheckedCount: '1', rightUncheckedCount: '1' }
describe('versioned mixed visual evidence', () => {
  it('accepts complete original counts without claiming unchecked media were paired', () => {
    expect(assertArtworkDedupVisualSummary(mixed)).toMatchObject({ leftFileCount: 5n, rightFileCount: 6n })
  })
  it('keeps historical evidence readable only with zero unchecked', () => {
    expect(() => assertArtworkDedupVisualSummary({ ...mixed, evidenceVersion: ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION })).toThrow('VISUAL_EVIDENCE_REQUIRED')
    expect(assertArtworkDedupVisualSummary({ ...mixed, evidenceVersion: ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION,
      leftFileCount: '4', rightFileCount: '5', leftUncheckedCount: '0', rightUncheckedCount: '0' })).toMatchObject({ leftFileCount: 4n })
  })
  it.each([{ leftUncheckedCount: '0' }, { leftFileCount: '6', leftUncheckedCount: '2' }, { similarCount: '0', exactCount: '4' }])('rejects lost originals and weak evidence %j', change => {
    expect(() => assertArtworkDedupVisualSummary({ ...mixed, ...change })).toThrow('VISUAL_EVIDENCE_REQUIRED')
  })
})
