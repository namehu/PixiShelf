import { createHash } from 'node:crypto'
import logger from '@/lib/logger'
import { redactArchiveText } from '@/services/archive/archive-redaction'

export const INTAKE_SUBMISSION_TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 5_000 } as const

type SubmissionPhase =
  | 'transactionWait'
  | 'sourceLock'
  | 'identityLocks'
  | 'idempotencyLock'
  | 'capacityLock'
  | 'creatorCatalogLock'
  | 'stateChecks'
  | 'intakeWrite'
  | 'serialization'
  | 'catalogWrite'

export class IntakeSubmissionTrace {
  private readonly startedAt = performance.now()
  private phaseStartedAt = this.startedAt
  private currentPhase: SubmissionPhase = 'transactionWait'
  private readonly phases: Partial<Record<SubmissionPhase, number>> = {}
  replayed = false

  phase(next: SubmissionPhase) {
    const now = performance.now()
    this.phases[this.currentPhase] = (this.phases[this.currentPhase] ?? 0) + now - this.phaseStartedAt
    this.currentPhase = next
    this.phaseStartedAt = now
  }

  async run<T>(metadata: { operation: string; submissionKey: string; itemCount: number }, operation: () => Promise<T>) {
    let failure: unknown
    let succeeded = false
    try {
      const result = await operation()
      succeeded = true
      return result
    } catch (error) {
      failure = error
      throw error
    } finally {
      const failedPhase = this.currentPhase
      this.phase(this.currentPhase)
      const data = {
        operation: metadata.operation,
        // Direct URL callers supply their own key; never log it verbatim.
        submissionKeyHash: createHash('sha256').update(metadata.submissionKey).digest('hex'),
        itemCount: metadata.itemCount,
        outcome: succeeded ? (this.replayed ? 'replayed' : 'committed') : 'failed',
        durationMs: Math.round(performance.now() - this.startedAt),
        phasesMs: Object.fromEntries(Object.entries(this.phases).map(([name, ms]) => [name, Math.round(ms)])),
        ...(!succeeded && {
          failedPhase,
          errorName: failure instanceof Error ? redactArchiveText(failure.name) : 'UnknownError',
          errorCode:
            failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string'
              ? redactArchiveText(failure.code)
              : undefined,
          error: redactArchiveText(failure instanceof Error ? failure.message : String(failure), 4096)
        })
      }
      if (succeeded) logger.info('Archive intake submission completed', data)
      else logger.error('Archive intake submission failed', data)
    }
  }
}
