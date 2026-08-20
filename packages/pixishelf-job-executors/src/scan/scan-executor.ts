import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Prisma } from '@pixishelf/db'
import type { ScanPayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { mapBounded, throwIfAborted } from './bounded.ts'
import { readStableFileContent, type StableFileState } from './content-reader.ts'
import { collectArtworkMedia, discoverMetadataCandidatePages } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import {
  ensurePixivInventoryRootIdentity,
  freezeIncrementalInventorySnapshot,
  recordExistingInventoryDecision,
  recordInventoryFailure,
  recordPublishedInventory
} from './inventory-run.ts'
import { hashScanRootIdentity } from './inventory.ts'
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
    const inventoryRootPathHash = hashScanRootIdentity(root.absolutePath)
    await ensurePixivInventoryRootIdentity({ context, rootPathHash: inventoryRootPathHash, now: now() })
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
            inventoryBaselineGeneration: run.inventoryBaselineGeneration,
            inventoryRootPathHash,
            row,
            policy: policyFor(context.payload),
            now: now(),
            limits
          })
        } catch (error) {
          // Cancellation and Worker shutdown are control flow, not bad metadata. Let the
          // outer finalizer pause/cancel/release the job without polluting inventory state.
          throwIfAborted(context.signal)
          const failure = unwrapInputFailure(error)
          context.logger.warn('scan.input.failed', { ordinal: row.ordinal, code: safeInputCode(failure.error) })
          return recordInputFailure(context, run.id, row, failure.error, failure.parsed, failure.state, now())
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
    const result = summarize(run.id, snapshot.metadataCandidates, results, {
      skipped: snapshot.inventoryUnchanged,
      // ScanRunItem is the idempotent source of truth across retries of the same ScanRun.
      failed: await dependencies.database.scanRunItem.count({ where: { scanRunId: run.id, status: 'FAILED' } })
    })
    if (result.failed > 0) {
      const retryableFailure = await dependencies.database.pixivMetadataInventory.findFirst({
        where: { lastSeenScanRunId: run.id, lastErrorRetryable: true },
        select: { id: true }
      })
      await context.mutateInTransaction<ScanTransaction & QueueSqlExecutor>(async (transaction) => {
        await transaction.scanRun.update({
          where: { id: run.id },
          data: {
            processedArtworks: result.succeeded + result.skipped + result.failed,
            succeededArtworks: result.succeeded,
            skippedArtworks: result.skipped,
            failedArtworks: result.failed,
            newImages: result.newImages
          }
        })
      })
      throw new ScanExecutorError(
        retryableFailure ? 'SOURCE_NOT_READABLE' : 'METADATA_INVALID',
        `${result.failed} frozen metadata inputs failed validation or publish`,
        retryableFailure !== null
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
  if (input.context.payload.mode === 'INCREMENTAL') {
    return freezeIncrementalInventorySnapshot({
      context: input.context,
      database: input.dependencies.database,
      root: input.root,
      run: input.run,
      now: input.now,
      limits: input.limits
    })
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
  inventoryBaselineGeneration: number | null
  inventoryRootPathHash: string
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
  if (checkpoint?.status === 'FAILED') {
    const inventory = await input.dependencies.database.pixivMetadataInventory.findUnique({
      where: { relativePath: input.row.relativePath },
      select: {
        lastSeenScanRunId: true,
        lastAttemptedContentHash: true,
        lastErrorCode: true,
        lastErrorRetryable: true
      }
    })
    if (!inventory) return { status: 'FAILED' as const, newImages: 0 }
    const sameFailedAttempt =
      inventory.lastSeenScanRunId === input.runId &&
      inventory.lastAttemptedContentHash === input.row.contentHash &&
      inventory.lastErrorCode !== null
    if (sameFailedAttempt && inventory.lastErrorRetryable !== true) {
      return { status: 'FAILED' as const, newImages: 0 }
    }
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
  let metadata
  try {
    metadata = parseMetadataDocument(document.bytes.toString('utf8'), candidate.format)
  } catch {
    throw new MetadataInputFailure(
      new ScanExecutorError('METADATA_INVALID', 'Metadata document is invalid'),
      false,
      document.state
    )
  }
  if (metadata.id !== candidate.artworkId) {
    throw new MetadataInputFailure(
      new ScanExecutorError('METADATA_INVALID', 'Metadata identity does not match its frozen filename'),
      false,
      document.state
    )
  }
  if (input.policy === 'SKIP') {
    const existing = await input.context.mutateInTransaction<
      ScanTransaction & QueueSqlExecutor,
      Awaited<ReturnType<typeof recordExistingInventoryDecision>>
    >((transaction) =>
      recordExistingInventoryDecision({
        transaction,
        runId: input.runId,
        checkpointOrdinal: input.row.ordinal,
        checkpointKey: checkpointKey(input.row),
        relativePath: candidate.relativePath,
        contentHash: input.row.contentHash!,
        state: document.state,
        externalId: metadata.id,
        title: metadata.title,
        artistName: metadata.user,
        inventoryBaselineGeneration: input.inventoryBaselineGeneration,
        inventoryRootPathHash: input.inventoryRootPathHash,
        now: input.now
      })
    )
    if (existing) return existing
  }
  try {
    const media = await collectArtworkMedia(
      input.root,
      candidate,
      { maxEntries: input.limits.maxEntries, maxMediaPerArtwork: input.limits.maxMediaPerArtwork },
      input.context.signal
    )
    if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Artwork has no supported media')
    const publishStarted = performance.now()
    return input.context.mutateInTransaction<
      ScanTransaction & QueueSqlExecutor,
      Awaited<ReturnType<typeof publishPixivArtwork>>
    >(async (transaction) => {
      if (input.context.payload.mode === 'ARTWORK_RESCAN') {
        await assertArtworkRescanSnapshot({
          transaction,
          artworkId: input.context.payload.artworkId,
          externalId: metadata.id,
          metadataRelativePath: candidate.relativePath
        })
      }
      const previousCheckpoint = await transaction.scanRunItem.findUnique({
        where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: checkpointKey(input.row) } },
        select: { status: true, action: true }
      })
      const result = await publishPixivArtwork({
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
      await recordPublishedInventory({
        transaction,
        runId: input.runId,
        checkpointOrdinal: input.row.ordinal,
        checkpointKey: checkpointKey(input.row),
        relativePath: candidate.relativePath,
        contentHash: input.row.contentHash!,
        state: document.state,
        externalId: metadata.id,
        publishStatus: result.status,
        publishDurationMs: performance.now() - publishStarted,
        previousCheckpoint,
        now: input.now
      })
      return result
    })
  } catch (error) {
    throwIfAborted(input.context.signal)
    throw new MetadataInputFailure(error, true, document.state)
  }
}

async function assertArtworkRescanSnapshot(input: {
  transaction: ScanTransaction
  artworkId: number
  externalId: string
  metadataRelativePath: string
}) {
  const locked = await input.transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT artwork."id"
    FROM "Artwork" AS artwork
    JOIN "artwork_external_refs" AS source_ref
      ON source_ref."artworkId" = artwork."id"
      AND source_ref."providerKey" = 'pixiv'
      AND source_ref."externalId" = ${input.externalId}
    WHERE artwork."id" = ${input.artworkId}
      AND artwork."metaSource" = ${input.metadataRelativePath}
      AND NOT EXISTS (
        SELECT 1
        FROM "artwork_external_refs" AS other_ref
        WHERE other_ref."artworkId" = artwork."id"
          AND other_ref."providerKey" = 'pixiv'
          AND other_ref."id" <> source_ref."id"
      )
    FOR UPDATE OF artwork, source_ref
  `)
  if (locked.length !== 1) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Artwork Pixiv source changed after the rescan snapshot was frozen')
  }
}

async function recordInputFailure(
  context: ExecutionContext<ScanPayload, EnqueuedChildJob>,
  runId: string,
  row: MetadataInputRow,
  error: unknown,
  parsed: boolean,
  state: StableFileState | undefined,
  now: Date
) {
  return context.mutateInTransaction<
    ScanTransaction & QueueSqlExecutor,
    Awaited<ReturnType<typeof recordInventoryFailure>>
  >(async (transaction) => {
    const candidate = metadataCandidateFromPath({ relativePath: row.relativePath, absolutePath: row.relativePath })
    return recordInventoryFailure({
      transaction,
      runId,
      checkpointOrdinal: row.ordinal,
      checkpointKey: checkpointKey(row),
      relativePath: row.relativePath,
      contentHash: row.contentHash!,
      externalId: candidate?.artworkId ?? '',
      state: state ?? stableStateFromRow(row),
      error,
      parsed,
      now
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
  results: readonly { status: 'SUCCESS' | 'SKIPPED' | 'FAILED'; newImages: number }[],
  initial: { skipped: number; failed: number } = { skipped: 0, failed: 0 }
): ScanExecutionResult {
  return {
    scanRunId,
    total,
    succeeded: results.filter((item) => item.status === 'SUCCESS').length,
    skipped: initial.skipped + results.filter((item) => item.status === 'SKIPPED').length,
    failed: initial.failed,
    newImages: results.reduce((sum, item) => sum + item.newImages, 0)
  }
}

function safeInputCode(error: unknown) {
  return error instanceof ScanExecutorError ? error.code : 'UNEXPECTED'
}

class MetadataInputFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly parsed: boolean,
    readonly state: StableFileState | undefined = undefined
  ) {
    super(error instanceof Error ? error.message : 'Metadata input failed')
  }
}

function unwrapInputFailure(error: unknown): { error: unknown; parsed: boolean; state: StableFileState | undefined } {
  return error instanceof MetadataInputFailure ? error : { error, parsed: false, state: undefined }
}

function stableStateFromRow(row: MetadataInputRow): StableFileState | undefined {
  if (row.sizeBytes === null || row.mtimeMs === null) return undefined
  return {
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs,
    ctimeMs: row.ctimeMs,
    deviceId: row.deviceId,
    inode: row.inode
  }
}
