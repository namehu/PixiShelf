import path from 'node:path'
import type { LocalDirectoryImportPayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { mapBounded, throwIfAborted } from './bounded.ts'
import { collectLocalMedia } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { finalizeScanError, finalizeScanSuccess } from './lifecycle.ts'
import { localCheckpointKey, publishLocalMediaWork, type LocalWorkRow } from './local-publisher.ts'
import { assertCanonicalRelativeScanPath, normalizeRelativeScanPath, resolveSafeScanRoot } from './paths.ts'
import { reportScanPageProgress } from './progress.ts'
import { iterateFrozenLocalWorkPages, startOrResumeScanRun, verifyFrozenLocalSnapshot } from './run-store.ts'
import { getOrCreateMediaDerivedTags, type MediaDerivedTagIds } from '../maintenance/media-derived-tag-sync.ts'
import {
  DEFAULT_SCAN_LIMITS,
  type ScanExecutionResult,
  type ScanExecutorDependencies,
  type ScanExecutorLimits,
  type ScanTransaction
} from './types.ts'

const DEFAULT_RETRY_DELAY_MS = 60_000

export async function executeLocalDirectoryImport(
  context: ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob>,
  dependencies: ScanExecutorDependencies
): Promise<JobExecutionOutcome<ScanExecutionResult>> {
  const now = dependencies.now ?? (() => new Date())
  const limits = { ...DEFAULT_SCAN_LIMITS, ...dependencies.config.limits }
  let runId: string | null = null
  context.logger.info('local-import.snapshot.start')
  try {
    const root = await resolveSafeScanRoot(dependencies.config.scanRoot)
    const run = await startOrResumeScanRun({
      context,
      database: dependencies.database,
      kind: 'LOCAL_DIRECTORY_IMPORT',
      mode: 'LOCAL_DIRECTORY_IMPORT',
      now: now(),
      requireFrozen: true
    })
    runId = run.id
    const snapshot = await verifyFrozenLocalSnapshot({
      database: dependencies.database,
      run,
      payload: context.payload,
      pageSize: limits.pageSize,
      maxEntries: limits.maxEntries
    })
    const mapping = new Map(snapshot.mappings.map((item) => [item.artistDirectory, item.artistId]))
    const mediaDerivedTagIds =
      mapping.size > 0
        ? await context.mutateInTransaction<ScanTransaction & QueueSqlExecutor, MediaDerivedTagIds>((transaction) =>
            getOrCreateMediaDerivedTags(transaction)
          )
        : null
    context.logger.info('local-import.snapshot.validated', {
      inputCount: snapshot.workCount,
      mappingCount: snapshot.mappings.length
    })

    const results: Array<{ status: 'SUCCESS' | 'SKIPPED' | 'FAILED'; newImages: number }> = []
    for await (const page of iterateFrozenLocalWorkPages(dependencies.database, run.id, limits.pageSize)) {
      throwIfAborted(context.signal)
      results.push(
        ...(await mapBounded(page, limits.concurrency, context.signal, async (work) => {
          try {
            return await processLocalWork({
              context,
              dependencies,
              root,
              runId: run.id,
              work,
              mapping,
              mediaDerivedTagIds,
              now: now(),
              limits
            })
          } catch (error) {
            context.logger.warn('local-import.input.failed', { ordinal: work.ordinal, code: safeLocalCode(error) })
            await recordLocalFailure(context, run.id, work, safeLocalError(error), now())
            return { status: 'FAILED' as const, newImages: 0 }
          }
        }))
      )
      await reportScanPageProgress({
        context,
        event: 'local-import.progress.page',
        processed: results.length,
        total: snapshot.workCount
      })
    }
    const result = summarize(run.id, snapshot.workCount, results)
    if (result.failed > 0) {
      throw new ScanExecutorError(
        'METADATA_INVALID',
        `${result.failed} frozen local works failed validation or publish`
      )
    }
    throwIfAborted(context.signal)
    context.logger.info('local-import.finalize.start', { inputCount: snapshot.workCount })
    return finalizeScanSuccess({ context, runId: run.id, result, startedAt: run.startedAt, now: now() })
  } catch (error) {
    context.logger.warn('local-import.execution.failed', { code: safeLocalCode(error) })
    if (!runId) throw error
    return finalizeScanError({
      context,
      runId,
      error,
      now: now(),
      retryDelayMs: dependencies.config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    })
  }
}

async function processLocalWork(input: {
  context: ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob>
  dependencies: ScanExecutorDependencies
  root: Awaited<ReturnType<typeof resolveSafeScanRoot>>
  runId: string
  work: LocalWorkRow
  mapping: Map<string, number>
  mediaDerivedTagIds: MediaDerivedTagIds | null
  now: Date
  limits: ScanExecutorLimits
}) {
  throwIfAborted(input.context.signal)
  const checkpoint = await input.dependencies.database.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: localCheckpointKey(input.work) } },
    select: { status: true, newImageCount: true }
  })
  if (checkpoint?.status === 'SUCCESS' || checkpoint?.status === 'SKIPPED') {
    return { status: checkpoint.status, newImages: checkpoint.newImageCount }
  }
  if (input.work.kind !== 'MEDIA_DIRECTORY') {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local work kind is no longer supported')
  }
  const localDirectory = normalizeRelativeScanPath(input.dependencies.config.localImportDirectory ?? 'local-imports')
  const artistDirectory = artistDirectoryFor(input.work.relativePath, localDirectory)
  const title = path.posix.basename(input.work.relativePath)
  const artistId = input.mapping.get(artistDirectory)
  if (!artistId) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work has no frozen artist mapping')
  const media = await collectLocalMedia(
    input.root,
    input.work.relativePath,
    {
      maxEntries: input.limits.maxEntries,
      maxMediaPerArtwork: input.limits.maxMediaPerArtwork,
      concurrency: input.limits.concurrency
    },
    input.context.signal
  )
  if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Local work has no supported media')
  const mediaDerivedTagIds = input.mediaDerivedTagIds
  if (!mediaDerivedTagIds) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Local work has no prepared media-derived tags')
  }
  return input.context.mutateInTransaction<
    ScanTransaction & QueueSqlExecutor,
    Awaited<ReturnType<typeof publishLocalMediaWork>>
  >((transaction) =>
    publishLocalMediaWork({
      transaction,
      runId: input.runId,
      work: input.work,
      title,
      now: input.now,
      artistId,
      media,
      mediaDerivedTagIds,
      defaultTagIds: input.context.payload.defaultTagIds
    })
  )
}

async function recordLocalFailure(
  context: ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob>,
  runId: string,
  work: LocalWorkRow,
  message: string,
  now: Date
) {
  await context.mutateInTransaction<ScanTransaction & QueueSqlExecutor>(async (transaction) => {
    await transaction.scanRunItem.upsert({
      where: { scanRunId_checkpointKey: { scanRunId: runId, checkpointKey: localCheckpointKey(work) } },
      create: {
        scanRunId: runId,
        checkpointKey: localCheckpointKey(work),
        title: path.posix.basename(work.relativePath),
        relativeDirectory: work.relativePath,
        status: 'FAILED',
        action: 'FAILED_WRITE',
        attempt: 1,
        errorMessage: message,
        finishedAt: now
      },
      update: {
        status: 'FAILED',
        action: 'FAILED_WRITE',
        attempt: { increment: 1 },
        errorMessage: message,
        finishedAt: now
      }
    })
    await transaction.scanRun.updateMany({
      where: { id: runId, checkpointOrdinal: { lt: work.ordinal + 1 } },
      data: { checkpointOrdinal: work.ordinal + 1, checkpointStage: 'PROCESSING' }
    })
  })
}

function artistDirectoryFor(relativePath: string, localDirectory: string) {
  const segments = assertCanonicalRelativeScanPath(relativePath).split('/')
  const prefix = localDirectory.split('/')
  if (segments.length <= prefix.length || prefix.some((segment, index) => segments[index] !== segment)) {
    throw new ScanExecutorError(
      'PATH_OUTSIDE_SCAN_ROOT',
      'Frozen local work is outside the configured import directory'
    )
  }
  return segments[prefix.length]!
}

function summarize(
  scanRunId: string,
  total: number,
  results: readonly { status: 'SUCCESS' | 'SKIPPED' | 'FAILED'; newImages: number }[]
): ScanExecutionResult {
  return {
    scanRunId,
    total,
    succeeded: results.filter((item) => item.status === 'SUCCESS').length,
    skipped: results.filter((item) => item.status === 'SKIPPED').length,
    failed: results.filter((item) => item.status === 'FAILED').length,
    newImages: results.reduce((sum, item) => sum + item.newImages, 0)
  }
}

function safeLocalError(error: unknown) {
  return error instanceof ScanExecutorError ? error.message : 'Frozen local work could not be processed'
}

function safeLocalCode(error: unknown) {
  return error instanceof ScanExecutorError ? error.code : 'UNEXPECTED'
}
