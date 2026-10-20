import { describe, expect, it, vi } from 'vitest'
import { IntakeSubmissionTrace } from '../intake-submission-transaction'

const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ default: logs }))

describe('intake submission diagnostics', () => {
  it('records failure stage/code without exposing keys, credentials or full URLs', async () => {
    const trace = new IntakeSubmissionTrace()
    const error = Object.assign(
      new Error('failed https://e-hentai.org/g/123/private-path/?token=private-token Cookie=private-cookie'),
      { code: 'P2028' }
    )
    await expect(
      trace.run(
        {
          operation: 'createArchiveIntakeSubmission',
          submissionKey: 'private-key',
          itemCount: 100
        },
        async () => {
          trace.phase('capacityLock')
          throw error
        }
      )
    ).rejects.toBe(error)
    expect(logs.error).toHaveBeenLastCalledWith(
      'Archive intake submission failed',
      expect.objectContaining({
        outcome: 'failed',
        failedPhase: 'capacityLock',
        errorCode: 'P2028',
        itemCount: 100,
        phasesMs: expect.objectContaining({ capacityLock: expect.any(Number) })
      })
    )
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('private-')
  })

  it('logs successful replay only after its operation finishes', async () => {
    const trace = new IntakeSubmissionTrace()
    const result = await trace.run(
      { operation: 'addArchiveUploaderScanItems', submissionKey: 'attempt', itemCount: 100 },
      async () => {
        trace.phase('serialization')
        trace.replayed = true
        return 'original'
      }
    )
    expect(result).toBe('original')
    expect(logs.info).toHaveBeenLastCalledWith(
      'Archive intake submission completed',
      expect.objectContaining({
        outcome: 'replayed',
        durationMs: expect.any(Number)
      })
    )
  })
})
