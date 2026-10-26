import { isArtworkDedupPrepareRetryable } from '../artwork-dedup-operation-reader-recovery'
import { describe, expect, it } from 'vitest'
import { assertArtworkDedupPartialSummary } from '../artwork-dedup-partial'
import { assertArtworkDedupVisualSummary } from '../artwork-dedup-visual'
const summary = { evidenceVersion: 'sha256-multiset-overlap-v1', leftArtworkId: 1, rightArtworkId: 2,
  leftFileCount: '100', rightFileCount: '100', pairedCount: '80', exactCount: '80', similarCount: '0',
  leftUnmatchedCount: '20', rightUnmatchedCount: '20', leftUncheckedCount: '0', rightUncheckedCount: '0' }
describe('partial original multiset evidence', () => {
  it('accepts exactly 80% without inheriting the visual file budget', () => {
    expect(assertArtworkDedupPartialSummary(summary).pairedCount).toBe(80n)
    expect(assertArtworkDedupPartialSummary({ ...summary, leftFileCount: '20000', rightFileCount: '20000', pairedCount: '16000', exactCount: '16000', leftUnmatchedCount: '4000', rightUnmatchedCount: '4000' }).pairedCount).toBe(16000n)
  })
  it('keeps visual and partial semantics separate', () => {
    expect(() => assertArtworkDedupVisualSummary(summary)).toThrow('VISUAL_EVIDENCE_REQUIRED')
    expect(() => assertArtworkDedupPartialSummary({ ...summary, evidenceVersion: 'dct63-grid3-crop-local1-v1' })).toThrow('PARTIAL_EVIDENCE_REQUIRED')
  })
  it.each([
    { pairedCount: '79', exactCount: '79', leftUnmatchedCount: '21', rightUnmatchedCount: '21' },
    { leftFileCount: '80', leftUnmatchedCount: '0' },
    { similarCount: '1' }, { leftUncheckedCount: '1' }, { exactCount: '81' }, { leftUnmatchedCount: '19' }, { leftArtworkId: 2 }
  ])('refuses incomplete, contained, inconsistent or below-threshold evidence %j', change => {
    expect(() => assertArtworkDedupPartialSummary({ ...summary, ...change })).toThrow('PARTIAL_EVIDENCE_REQUIRED')
  })
})

it('keeps partial PREPARE recovery bound to protocol4 and definition5', () => {
  const operation = { id: 'o', status: 'FAILED', mode: 'PREPARE', originalAction: 'PREPARE', preparePurpose: 'DIRECT_DELETE', protocolVersion: 4,
    executionVersion: 1, jobId: 'j', readerToken: null, readerState: 'IDLE', cancelRequestedAt: null }
  const job = { id: 'j', type: 'ARTWORK_DEDUP_MAINTENANCE' as const, status: 'FAILED' as const, definitionVersion: 5, leaseExpiresAt: null,
    payload: { operationId: 'o', executionVersion: 1, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 4 } }
  expect(isArtworkDedupPrepareRetryable(operation, job, new Date())).toBe(true)
  for (const definitionVersion of [1, 2, 3, 4]) expect(isArtworkDedupPrepareRetryable(operation, { ...job, definitionVersion }, new Date())).toBe(false)
  expect(isArtworkDedupPrepareRetryable(operation, { ...job, payload: { ...job.payload, protocolVersion: 3 } }, new Date())).toBe(false)
  expect(isArtworkDedupPrepareRetryable({ ...operation, readerToken: 'active' }, job, new Date())).toBe(false)
})
