import { createHash } from 'node:crypto'
import type { ScanPayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { mapBounded, throwIfAborted } from './bounded.ts'
import { readStableFileContent } from './content-reader.ts'
import { collectArtworkMedia, discoverMetadataCandidatePages } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { finalizeScanError, finalizeScanSuccess } from './lifecycle.ts'
import { executeLocalArtworkRescan } from './local-rescan.ts'
import { metadataCandidateFromPath, parseMetadataDocument } from './metadata.ts'
import { publishPixivArtwork, type ExistingArtworkPolicy } from './pixiv-publisher.ts'
import { reportScanPageProgress } from './progress.ts'
import { resolveSafeExistingPath, resolveSafeScanRoot } from './paths.ts'
import {
  freezeDiscoveredMetadataPages,
  iterateFrozenMetadataPages,
  scanMode,
  startOrResumeScanRun,
  verifyFrozenMetadataSnapshot,
  type MetadataInputRow,
  type ScanRunRecord
} from './run-store.ts'
import {
  DEFAULT_SCAN_LIMITS,
  type ScanExecutionResult,
  type ScanExecutorDependencies,
  type ScanExecutorLimits,
  type ScanTransaction
} from './types.ts'

const DEFAULT_RETRY_DELAY_MS = 60_000

export async function executeScan(
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>,
  dependencies: ScanExecutorDependencies
): Promise<JobExecutionOutcome<ScanExecutionResult>> {
  const now = dependencies.now ?? (() => new Date())
  const limits = { ...DEFAULT_SCAN_LIMITS, ...dependencies.config.limits }
  let runId: string | null = null
  context.logger.info('scan.snapshot.start', { mode: context.payload.mode })
  try {
    const root = await resolveSafeScanRoot(dependencies.config.scanRoot)
    const existingRun =
      context.payload.mode === 'ARTWORK_RESCAN'
        ? await dependencies.database.scanRun.findUnique({ where: { systemJobId: context.job.id } })
        : null
    const isLocalRescan = existingRun?.type === 'LOCAL_IMPORT' && existingRun.mode === 'LOCAL_RESCAN'
    let run = await startOrResumeScanRun({
      context,
      database: dependencies.database,
      kind: isLocalRescan ? 'LOCAL_ARTWORK_RESCAN' : 'SCAN',
      mode: isLocalRescan ? 'LOCAL_RESCAN' : scanMode(context.payload),
      now: now(),
      requireFrozen: context.payload.mode === 'CLIENT_LIST' || context.payload.mode === 'ARTWORK_RESCAN'
    })
    runId = run.id
    if (isLocalRescan) {
      const localResult = await executeLocalArtworkRescan({
        context,
        dependencies,
        root,
        run,
        limits,
        now: now()
      })
      const result = summarize(run.id, 1, [localResult])
      return finalizeScanSuccess({ context, runId: run.id, result, startedAt: run.startedAt, now: now() })
    }
    run = await ensureMetadataSnapshot({ context, dependencies, root, run, now: now(), limits })
    const snapshot = await verifyFrozenMetadataSnapshot({
      database: dependencies.database,
      run,
      payload: context.payload,
      pageSize: limits.pageSize,
      maxEntries: limits.maxEntries
    })
    context.logger.info('scan.snapshot.validated', { mode: context.payload.mode, inputCount: snapshot.count })

    const results: Array<{ status: 'SUCCESS' | 'SKIPPED' | 'FAILED'; newImages: number }> = []
    for await (const page of iterateFrozenMetadataPages(dependencies.database, run.id, limits.pageSize)) {
      throwIfAborted(context.signal)
      const pageResults = await mapBounded(page, limits.concurrency, context.signal, async (row) => {
        try {
          return await processMetadataInput({
            context,
            dependencies,
            root,
            runId: run.id,
            row,
            policy: policyFor(context.payload),
            now: now(),
            limits
          })
        } catch (error) {
          const message = safeInputError(error)
          context.logger.warn('scan.input.failed', { ordinal: row.ordinal, code: safeInputCode(error) })
          await recordInputFailure(context, run.id, row, message, now())
          return { status: 'FAILED' as const, newImages: 0 }
        }
      })
      results.push(...pageResults)
      await reportScanPageProgress({
        context,
        event: 'scan.progress.page',
        processed: results.length,
        total: snapshot.count
      })
    }
    const result = summarize(run.id, snapshot.count, results)
    if (result.failed > 0) {
      throw new ScanExecutorError(
        'METADATA_INVALID',
        `${result.failed} frozen metadata inputs failed validation or publish`
      )
    }
    throwIfAborted(context.signal)
    context.logger.info('scan.finalize.start', { mode: context.payload.mode, inputCount: snapshot.count })
    return finalizeScanSuccess({
      context,
      runId: run.id,
      result,
      startedAt: run.startedAt,
      now: now(),
      ...(context.payload.mode === 'FULL_RECONCILE'
        ? {
            fullReconcile: {
              frozenAt: snapshot.inputFrozenAt,
              maxSweepReferences: limits.maxFullSweepReferences
            }
          }
        : {})
    })
  } catch (error) {
    context.logger.warn('scan.execution.failed', { mode: context.payload.mode, code: safeInputCode(error) })
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

async function ensureMetadataSnapshot(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  dependencies: ScanExecutorDependencies
  root: Awaited<ReturnType<typeof resolveSafeScanRoot>>
  run: ScanRunRecord
  now: Date
  limits: ScanExecutorLimits
}) {
  if (input.run.inputFrozenAt) return input.run
  if (input.context.payload.mode === 'CLIENT_LIST') {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Client metadata input was not transactionally frozen')
  }
  if (input.context.payload.mode === 'ARTWORK_RESCAN') {
    throw new ScanExecutorError(
      'INPUT_SNAPSHOT_INVALID',
      'Artwork rescan metadata must be transactionally frozen before enqueue'
    )
  }
  return freezeDiscoveredMetadataPages({
    context: input.context,
    run: input.run,
    pages: discoverMetadataCandidatePages(input.root, input.limits, input.context.signal),
    now: input.now,
    maxEntries: input.limits.maxEntries
  })
}

async function processMetadataInput(input: {
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>
  dependencies: ScanExecutorDependencies
  root: Awaited<ReturnType<typeof resolveSafeScanRoot>>
  runId: string
  row: MetadataInputRow
  policy: ExistingArtworkPolicy
  now: Date
  limits: ScanExecutorLimits
}) {
  throwIfAborted(input.context.signal)
  const checkpoint = await input.dependencies.database.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: checkpointKey(input.row) } },
    select: { status: true, newImageCount: true }
  })
  if (checkpoint?.status === 'SUCCESS' || checkpoint?.status === 'SKIPPED') {
    return { status: checkpoint.status, newImages: checkpoint.newImageCount }
  }
  const resolved = await resolveSafeExistingPath(input.root, input.row.relativePath, 'file')
  const candidate = metadataCandidateFromPath(resolved)
  if (!candidate || !input.row.contentHash) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata path is invalid')
  }
  const document = await readStableFileContent({
    absolutePath: candidate.absolutePath,
    maxBytes: input.limits.maxMetadataBytes,
    signal: input.context.signal
  })
  if (document.sha256 !== input.row.contentHash) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata content changed before processing')
  }
  const metadata = parseMetadataDocument(document.bytes.toString('utf8'), candidate.format)
  if (metadata.id !== candidate.artworkId) {
    throw new ScanExecutorError('METADATA_INVALID', 'Metadata identity does not match its frozen filename')
  }
  if (input.context.payload.mode === 'ARTWORK_RESCAN') {
    const artwork = await input.dependencies.database.artwork.findUnique({
      where: { id: input.context.payload.artworkId },
      select: { externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } } }
    })
    if (!artwork || artwork.externalRefs.length !== 1 || artwork.externalRefs[0]?.externalId !== metadata.id) {
      throw new ScanExecutorError(
        'STATE_CONFLICT',
        'Artwork Pixiv identity changed after the rescan snapshot was frozen'
      )
    }
  }
  const media = await collectArtworkMedia(
    input.root,
    candidate,
    { maxEntries: input.limits.maxEntries, maxMediaPerArtwork: input.limits.maxMediaPerArtwork },
    input.context.signal
  )
  if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Artwork has no supported media')
  return input.context.mutateInTransaction<
    ScanTransaction & QueueSqlExecutor,
    Awaited<ReturnType<typeof publishPixivArtwork>>
  >((transaction) =>
    publishPixivArtwork({
      transaction,
      runId: input.runId,
      checkpointOrdinal: input.row.ordinal,
      checkpointKey: checkpointKey(input.row),
      metadataRelativePath: candidate.relativePath,
      metadata,
      media,
      existingPolicy: input.policy,
      now: input.now
    })
  )
}

async function recordInputFailure(
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>,
  runId: string,
  row: MetadataInputRow,
  message: string,
  now: Date
) {
  await context.mutateInTransaction<ScanTransaction & QueueSqlExecutor>(async (transaction) => {
    await transaction.scanRunItem.upsert({
      where: { scanRunId_checkpointKey: { scanRunId: runId, checkpointKey: checkpointKey(row) } },
      create: {
        scanRunId: runId,
        checkpointKey: checkpointKey(row),
        metadataRelativePath: row.relativePath,
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
      where: { id: runId, checkpointOrdinal: { lt: row.ordinal + 1 } },
      data: { checkpointOrdinal: row.ordinal + 1, checkpointStage: 'PROCESSING' }
    })
  })
}

function policyFor(payload: ScanPayload): ExistingArtworkPolicy {
  if (payload.mode === 'CLIENT_LIST') return payload.existingPolicy
  return payload.mode === 'INCREMENTAL' ? 'SKIP' : 'REFRESH'
}

function checkpointKey(row: { ordinal: number; relativePath: string }) {
  return `metadata:${row.ordinal}:${createHash('sha256').update(row.relativePath).digest('hex')}`
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

function safeInputError(error: unknown) {
  if (error instanceof ScanExecutorError) return error.message
  if (error instanceof SyntaxError) return 'Metadata document is invalid'
  return 'Frozen metadata input could not be processed'
}

function safeInputCode(error: unknown) {
  return error instanceof ScanExecutorError ? error.code : 'UNEXPECTED'
}
