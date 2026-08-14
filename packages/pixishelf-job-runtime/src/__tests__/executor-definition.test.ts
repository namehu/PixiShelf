import { describe, expect, it } from 'vitest'
import { parseJobExecutionOutcome } from '../executor-definition.js'

describe('shared executor outcome contract', () => {
  it('accepts canonical outcomes including transaction-bound finalization', () => {
    expect(parseJobExecutionOutcome({ kind: 'completed', result: { count: 1 } })).toEqual({
      kind: 'completed',
      result: { count: 1 }
    })
    expect(parseJobExecutionOutcome({ kind: 'transactionally-finalized' })).toEqual({
      kind: 'transactionally-finalized'
    })
  })

  it('rejects unknown fields and unsupported outcome kinds', () => {
    expect(() => parseJobExecutionOutcome({ kind: 'completed', unexpected: true })).toThrow()
    expect(() => parseJobExecutionOutcome({ kind: 'mystery' })).toThrow()
  })

  it('requires a valid Date for retry scheduling', () => {
    expect(() =>
      parseJobExecutionOutcome({
        kind: 'retry',
        availableAt: '2026-08-15T00:00:00.000Z',
        errorCode: 'DATABASE_UNAVAILABLE',
        error: 'retry'
      })
    ).toThrow()
  })
})
