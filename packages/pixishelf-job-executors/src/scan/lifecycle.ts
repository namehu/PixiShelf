import type { JobErrorCode, LocalDirectoryImportPayload, ScanPayload, ScanV2Payload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { ScanExecutorError } from './errors.ts'
import type { ScanExecutionResult, ScanTransaction } from './types.ts'

type ScanContext =
  | ExecutionContext<ScanPayload, EnqueuedChildJob>
  | ExecutionContext<ScanV2Payload, EnqueuedChildJob>
  | ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob>

export async function finalizeScanSuccess(input: {
  context: ScanContext
  runId: string
  result: ScanExecutionResult
  startedAt: Date | null
  now: Date
}): Promise<JobExecutionOutcome<ScanExecutionResult>> {
  return input.context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'PAUSING') {
      await setRunPaused(scope.transaction, input.runId, input.now)
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Scan paused at a durable checkpoint' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await setRunCancelled(scope.transaction, input.runId, input.now)
      await scope.cancel('Scan cancelled')
      return
    }

    await scope.transaction.scanRun.update({
      where: { id: input.runId },
      data: {
        status: 'COMPLETED',
        finishedAt: input.now,
        checkpointStage: 'COMPLETED',
        processedArtworks: input.result.succeeded + input.result.skipped + input.result.failed,
        succeededArtworks: input.result.succeeded,
        skippedArtworks: input.result.skipped,
        failedArtworks: input.result.failed,
        failedInputs: input.result.failed,
        newImages: input.result.newImages,
        durationMs: elapsedMilliseconds(input.startedAt, input.now),
        errorMessage: null
      }
    })
    await scope.complete({ result: input.result, message: 'Scan completed' })
  })
}

function elapsedMilliseconds(startedAt: Date | null, finishedAt: Date): number | null {
  if (!startedAt) return null
  return Math.min(2_147_483_647, Math.max(0, finishedAt.getTime() - startedAt.getTime()))
}

export async function finalizeScanError(input: {
  context: ScanContext
  runId: string
  error: unknown
  now: Date
  retryDelayMs: number
}): Promise<JobExecutionOutcome<ScanExecutionResult>> {
  const classified = classifyScanError(input.error)
  return input.context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'PAUSING') {
      await setRunPaused(scope.transaction, input.runId, input.now)
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Scan paused at a durable checkpoint' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await setRunCancelled(scope.transaction, input.runId, input.now)
      await scope.cancel('Scan cancelled')
      return
    }
    if (input.context.signal.aborted) {
      await scope.transaction.scanRun.update({
        where: { id: input.runId },
        data: { status: 'PENDING', checkpointStage: 'INTERRUPTED', errorMessage: null }
      })
      await scope.release('Worker stopped; scan will resume from its checkpoint')
      return
    }
    if (
      input.error instanceof ScanExecutorError &&
      (input.error.code === 'EMPTY_CONSISTENCY_AUDIT' || input.error.code === 'AUDIT_SAFETY_LIMIT_EXCEEDED')
    ) {
      await setRunPaused(scope.transaction, input.runId, input.now)
      await scope.pause({
        reason: 'ACTION_REQUIRED',
        message: input.error.message,
        data: { decisionCode: input.error.code }
      })
      return
    }
    if (classified.recoverable && input.context.job.attempt < input.context.job.maxAttempts) {
      await scope.transaction.scanRun.update({
        where: { id: input.runId },
        data: { status: 'RETRY_WAIT', checkpointStage: 'RETRY_WAIT', errorMessage: classified.message }
      })
      await scope.retry({
        availableAt: new Date(input.now.getTime() + input.retryDelayMs),
        errorCode: classified.jobErrorCode,
        error: classified.message,
        message: 'Scan will retry from its durable checkpoint'
      })
      return
    }
    await scope.transaction.scanRun.update({
      where: { id: input.runId },
      data: {
        status: 'FAILED',
        finishedAt: input.now,
        checkpointStage: 'FAILED',
        errorMessage: classified.message
      }
    })
    await scope.fail({
      errorCode: classified.jobErrorCode,
      error: classified.message,
      message: 'Scan failed'
    })
  })
}

function classifyScanError(error: unknown): { jobErrorCode: JobErrorCode; message: string; recoverable: boolean } {
  if (error instanceof ScanExecutorError) {
    const jobErrorCode: JobErrorCode =
      error.code === 'SOURCE_NOT_FOUND'
        ? 'SOURCE_NOT_FOUND'
        : error.code === 'PATH_OUTSIDE_SCAN_ROOT' || error.code === 'SYMLINK_NOT_ALLOWED'
          ? 'PATH_OUTSIDE_ALLOWED_ROOT'
          : error.code === 'CONFIGURATION_INVALID' ||
              error.code === 'INPUT_SNAPSHOT_INVALID' ||
              error.code === 'STATE_CONFLICT' ||
              error.code === 'SOURCE_NOT_READABLE' ||
              error.code === 'METADATA_INVALID' ||
              error.code === 'MEDIA_NOT_FOUND'
            ? 'PRECONDITION_FAILED'
            : 'INTERNAL_ERROR'
    return { jobErrorCode, message: error.message, recoverable: error.recoverable }
  }
  return { jobErrorCode: 'INTERNAL_ERROR', message: 'Scan execution failed unexpectedly', recoverable: true }
}

async function setRunPaused(transaction: ScanTransaction, runId: string, now: Date) {
  await transaction.scanRun.update({
    where: { id: runId },
    data: { status: 'PAUSED', finishedAt: now, checkpointStage: 'PAUSED', errorMessage: null }
  })
}

async function setRunCancelled(transaction: ScanTransaction, runId: string, now: Date) {
  await transaction.scanRun.update({
    where: { id: runId },
    data: { status: 'CANCELLED', finishedAt: now, checkpointStage: 'CANCELLED', errorMessage: null }
  })
}
