import { createHash } from 'node:crypto'
import { Prisma } from '@pixishelf/db'
import {
  canonicalizeAuditApplyInputs,
  type AuditApplyInputEvidence,
  type ScanAuditApplyPayload
} from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { throwIfAborted } from './bounded.ts'
import { readStableFileContent, type StableFileState } from './content-reader.ts'
import { collectArtworkMedia } from './discovery.ts'
import { ScanExecutorError } from './errors.ts'
import { hashScanRootIdentity } from './inventory.ts'
import { metadataCandidateFromPath, parseMetadataDocument, type ScanMetadata } from './metadata.ts'
import { resolveSafeExistingPath, resolveSafeScanRoot, type SafeScanRoot } from './paths.ts'
import { publishPixivArtwork } from './pixiv-publisher.ts'
import type { ScanDatabase, ScanExecutorDependencies, ScanTransaction } from './types.ts'

type ApplyContext = ExecutionContext<ScanAuditApplyPayload, EnqueuedChildJob>
type ApplyInput = Prisma.ScanRunMetadataInputGetPayload<Record<string, never>>
type SourceAuditItem = Prisma.PixivSourceAuditItemGetPayload<Record<string, never>>
type ApplyOutcome = 'APPLIED' | 'SKIPPED' | 'CONFLICT' | 'FAILED'

interface PreparedInput {
  candidate: NonNullable<ReturnType<typeof metadataCandidateFromPath>>
  state: StableFileState
  contentHash: string
  metadata: ScanMetadata
  media: Awaited<ReturnType<typeof collectArtworkMedia>>
}

export interface AuditApplyResult {
  scanRunId: string
  total: number
  applied: number
  skipped: number
  stale: number
  conflicts: number
  failed: number
  newImages: number
}

const DEFAULT_RETRY_DELAY_MS = 60_000

export async function executeAuditApply(
  context: ApplyContext,
  dependencies: ScanExecutorDependencies
): Promise<JobExecutionOutcome<AuditApplyResult>> {
  const now = dependencies.now ?? (() => new Date())
  let runId: string | null = null
  let currentItemId: string | null = null
  try {
    const run = await startApplyRun(context, now())
    runId = run.id
    const root = await resolveSafeScanRoot(dependencies.config.scanRoot)
    const inputs = await verifyFrozenApplyInputs(context.payload, run, dependencies.database)
    await assertApplyBarrier(dependencies.database, root, run.inventoryBaselineGeneration!)

    for (const row of inputs) {
      throwIfAborted(context.signal)
      const item = await markItemProcessing(context, run.id, row.sourceAuditItemId!, now())
      if (!item || item.applyOutcome !== null) continue
      currentItemId = item.id

      let prepared: PreparedInput
      try {
        prepared = await prepareInput(context, dependencies, root, row)
      } catch (error) {
        if (isStaleSourceError(error)) {
          await recordItemOutcome(
            context,
            run.id,
            item.id,
            row.ordinal,
            {
              status: 'SKIPPED',
              outcome: 'SKIPPED',
              reasonCode: 'STALE_SOURCE_INPUT',
              reasonSummary: 'Source metadata changed after the audit',
              retryable: false
            },
            now()
          )
          currentItemId = null
          continue
        }
        if (isBusinessInputError(error)) {
          await recordItemOutcome(
            context,
            run.id,
            item.id,
            row.ordinal,
            {
              status: 'FAILED',
              outcome: 'FAILED',
              reasonCode: businessReasonCode(error),
              reasonSummary: businessReasonSummary(error),
              retryable: isRetryableBusinessInput(error)
            },
            now()
          )
          currentItemId = null
          continue
        }
        throw error
      }

      const finalRoot = await resolveSafeScanRoot(dependencies.config.scanRoot)
      assertSameRoot(root, finalRoot)
      try {
        await applyPreparedInput({
          context,
          runId: run.id,
          inventoryBaselineGeneration: run.inventoryBaselineGeneration!,
          row,
          itemId: item.id,
          prepared,
          root,
          now: now()
        })
      } catch (error) {
        if (
          error instanceof ScanExecutorError &&
          error.code === 'STATE_CONFLICT' &&
          !(error instanceof ApplyBarrierError)
        ) {
          await recordItemOutcome(
            context,
            run.id,
            item.id,
            row.ordinal,
            {
              status: 'FAILED',
              outcome: 'CONFLICT',
              reasonCode: 'SOURCE_IDENTITY_CHANGED',
              reasonSummary: 'Source identity changed after the audit',
              retryable: false
            },
            now()
          )
          currentItemId = null
          continue
        }
        throw error
      }
      currentItemId = null
      await context.progress({
        progress: Math.min(99, Math.floor(((row.ordinal + 1) / inputs.length) * 100)),
        stage: 'APPLYING',
        message: 'Applying frozen Pixiv source audit inputs'
      })
    }
    return await finalizeApplySuccess(context, run.id, root, run.inventoryBaselineGeneration!, now())
  } catch (error) {
    context.logger.warn('scan.audit-apply.failed', { code: safeErrorCode(error) })
    if (!runId) throw error
    return finalizeApplyError({
      context,
      runId,
      currentItemId,
      error,
      now: now(),
      retryDelayMs: dependencies.config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    })
  }
}

async function startApplyRun(context: ApplyContext, now: Date) {
  return mutate(context, async (transaction) => {
    const run = await transaction.scanRun.findUnique({ where: { systemJobId: context.job.id } })
    if (
      !run ||
      run.type !== 'PIXIV' ||
      run.mode !== 'INCREMENTAL' ||
      run.operationKind !== 'AUDIT_APPLY' ||
      run.sourceAuditRunId !== context.payload.auditRunId ||
      run.inputFrozenAt === null ||
      run.inventoryBaselineGeneration === null
    ) {
      throw new ScanExecutorError('STATE_CONFLICT', 'The ScanRun does not match the audit apply job')
    }
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      throw new ScanExecutorError('STATE_CONFLICT', 'The audit apply run is already terminal')
    }
    return transaction.scanRun.update({
      where: { id: run.id },
      data: {
        status: 'RUNNING',
        startedAt: run.startedAt ?? now,
        finishedAt: null,
        checkpointStage: 'VERIFYING',
        errorMessage: null
      }
    })
  })
}

async function verifyFrozenApplyInputs(
  payload: ScanAuditApplyPayload,
  run: Prisma.ScanRunGetPayload<Record<string, never>>,
  database: ScanDatabase
) {
  if (run.inputCount !== payload.inputCount || run.inputDigest !== payload.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply payload does not match its frozen ScanRun')
  }
  const sourceAudit = await database.scanRun.findUnique({
    where: { id: payload.auditRunId },
    select: {
      status: true,
      operationKind: true,
      inputFrozenAt: true,
      inventoryBaselineGeneration: true,
      systemJob: { select: { status: true } }
    }
  })
  if (
    !sourceAudit ||
    sourceAudit.status !== 'COMPLETED' ||
    sourceAudit.operationKind !== 'CONSISTENCY_AUDIT' ||
    sourceAudit.inputFrozenAt === null ||
    sourceAudit.systemJob?.status !== 'COMPLETED' ||
    sourceAudit.inventoryBaselineGeneration !== run.inventoryBaselineGeneration
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'The source audit is not a complete current inventory snapshot')
  }
  const rows = await database.scanRunMetadataInput.findMany({
    where: { scanRunId: run.id },
    orderBy: { ordinal: 'asc' }
  })
  if (rows.length !== payload.inputCount) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply input count changed after enqueue')
  }
  const evidence = rows.map(evidenceFromInput)
  let digest: string
  try {
    digest = createHash('sha256').update(canonicalizeAuditApplyInputs(payload.auditRunId, evidence)).digest('hex')
  } catch {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply evidence is incomplete')
  }
  if (digest !== payload.inputDigest) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply evidence digest changed after enqueue')
  }
  const sourceItems = await database.pixivSourceAuditItem.findMany({
    where: { id: { in: rows.map((row) => row.sourceAuditItemId!) } }
  })
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]))
  for (const row of rows) {
    if (
      row.expectedInventoryId === null ||
      (row.auditDifferenceKind === 'NEW' && (row.expectedExternalRefId !== null || row.expectedArtworkId !== null)) ||
      (row.auditDifferenceKind === 'CHANGED' && (row.expectedExternalRefId === null || row.expectedArtworkId === null))
    ) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply identity evidence is incomplete')
    }
    assertSourceAuditEvidence(payload.auditRunId, row, sourceById.get(row.sourceAuditItemId!))
  }
  const checkpoints = await database.scanRunItem.findMany({
    where: { scanRunId: run.id, sourceAuditItemId: { in: rows.map((row) => row.sourceAuditItemId!) } }
  })
  const checkpointBySourceId = new Map(checkpoints.map((item) => [item.sourceAuditItemId, item]))
  if (checkpoints.length !== rows.length) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply checkpoints are incomplete')
  }
  for (const row of rows) {
    const checkpoint = checkpointBySourceId.get(row.sourceAuditItemId)
    const kind = differenceKind(row.auditDifferenceKind)
    if (
      !checkpoint ||
      checkpoint.auditDifferenceKind !== kind ||
      checkpoint.checkpointKey !== `audit-apply:${row.sourceAuditItemId}` ||
      checkpoint.metadataRelativePath !== row.relativePath ||
      checkpoint.externalId !== row.expectedExternalId ||
      checkpoint.action !== (kind === 'NEW' ? 'CREATE' : 'UPDATE')
    ) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply checkpoint evidence is inconsistent')
    }
  }
  return rows
}

function evidenceFromInput(row: ApplyInput): AuditApplyInputEvidence {
  return {
    ordinal: row.ordinal,
    sourceAuditItemId: required(row.sourceAuditItemId),
    auditDifferenceKind: differenceKind(row.auditDifferenceKind),
    relativePath: row.relativePath,
    expectedExternalId: required(row.expectedExternalId),
    observedExternalId: required(row.observedExternalId),
    expectedInventoryId: row.expectedInventoryId,
    expectedExternalRefId: row.expectedExternalRefId,
    expectedArtworkId: row.expectedArtworkId,
    observedContentHash: required(row.contentHash),
    processedContentHash: row.expectedProcessedContentHash,
    sizeBytes: required(row.sizeBytes),
    mtimeMs: required(row.mtimeMs),
    ctimeMs: row.ctimeMs,
    deviceId: row.deviceId,
    inode: row.inode
  }
}

function assertSourceAuditEvidence(auditRunId: string, row: ApplyInput, item: SourceAuditItem | undefined) {
  if (
    !item ||
    item.scanRunId !== auditRunId ||
    item.differenceKind !== row.auditDifferenceKind ||
    item.relativePath !== row.relativePath ||
    item.expectedExternalId !== row.expectedExternalId ||
    item.observedExternalId !== row.observedExternalId ||
    item.inventoryId !== row.expectedInventoryId ||
    item.externalRefId !== row.expectedExternalRefId ||
    item.artworkId !== row.expectedArtworkId ||
    item.observedContentHash !== row.contentHash ||
    item.processedContentHash !== row.expectedProcessedContentHash ||
    item.sizeBytes !== row.sizeBytes ||
    item.mtimeMs !== row.mtimeMs ||
    item.ctimeMs !== row.ctimeMs ||
    item.deviceId !== row.deviceId ||
    item.inode !== row.inode ||
    item.issueCode !== null
  ) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Source audit evidence changed after enqueue')
  }
}

async function prepareInput(
  context: ApplyContext,
  dependencies: ScanExecutorDependencies,
  root: SafeScanRoot,
  row: ApplyInput
): Promise<PreparedInput> {
  const resolved = await resolveSafeExistingPath(root, row.relativePath, 'file')
  const candidate = metadataCandidateFromPath(resolved)
  if (!candidate) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen metadata path is invalid')
  const document = await readStableFileContent({
    absolutePath: candidate.absolutePath,
    maxBytes: dependencies.config.limits?.maxMetadataBytes ?? 16 * 1024 * 1024,
    signal: context.signal
  })
  if (!sameFrozenState(document.state, stateFromInput(row)) || document.sha256 !== row.contentHash) {
    throw new StaleSourceInputError()
  }
  let metadata: ScanMetadata
  try {
    metadata = parseMetadataDocument(document.bytes.toString('utf8'), candidate.format)
  } catch {
    throw new ScanExecutorError('METADATA_INVALID', 'Metadata document is invalid')
  }
  if (
    metadata.id !== row.expectedExternalId ||
    metadata.id !== row.observedExternalId ||
    metadata.id !== candidate.artworkId
  ) {
    throw new StaleSourceInputError()
  }
  let media: Awaited<ReturnType<typeof collectArtworkMedia>>
  try {
    media = await collectArtworkMedia(
      root,
      candidate,
      {
        maxEntries: dependencies.config.limits?.maxEntries ?? 100_000,
        maxMediaPerArtwork: dependencies.config.limits?.maxMediaPerArtwork ?? 2_000
      },
      context.signal
    )
  } catch (error) {
    throwIfAborted(context.signal)
    if (error instanceof ScanExecutorError && error.code === 'SOURCE_NOT_READABLE') throw error
    throw new MediaInputError()
  }
  if (media.length === 0) throw new ScanExecutorError('MEDIA_NOT_FOUND', 'Artwork has no supported media')
  return { candidate, state: document.state, contentHash: document.sha256, metadata, media }
}

async function applyPreparedInput(input: {
  context: ApplyContext
  runId: string
  inventoryBaselineGeneration: number
  row: ApplyInput
  itemId: string
  prepared: PreparedInput
  root: SafeScanRoot
  now: Date
}) {
  return mutate(input.context, async (transaction) => {
    const checkpoint = await transaction.scanRunItem.findUnique({ where: { id: input.itemId } })
    if (!checkpoint || checkpoint.scanRunId !== input.runId) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply checkpoint is missing')
    }
    if (checkpoint.applyOutcome !== null) return
    await assertBarrierInTransaction(transaction, input.root, input.inventoryBaselineGeneration)
    const sourceItem = await transaction.pixivSourceAuditItem.findUnique({
      where: { id: input.row.sourceAuditItemId! }
    })
    assertSourceAuditEvidence(input.context.payload.auditRunId, input.row, sourceItem ?? undefined)

    const alreadyApplied = await findAlreadyApplied(transaction, input.row)
    if (alreadyApplied) {
      await writeOutcome(
        transaction,
        input.runId,
        input.itemId,
        input.row.ordinal,
        {
          status: 'SKIPPED',
          outcome: 'SKIPPED',
          reasonCode: 'ALREADY_APPLIED',
          reasonSummary: 'Source content was already synchronized',
          retryable: false,
          resultArtworkId: alreadyApplied.artworkId
        },
        input.now
      )
      return
    }

    const result = await publishPixivArtwork({
      transaction,
      runId: input.runId,
      checkpointOrdinal: input.row.ordinal,
      checkpointKey: `audit-apply:${input.row.sourceAuditItemId}`,
      metadataRelativePath: input.prepared.candidate.relativePath,
      metadata: input.prepared.metadata,
      metadataContentHash: input.prepared.contentHash,
      media: input.prepared.media,
      existingPolicy: 'REFRESH',
      now: input.now,
      manageCheckpoint: false,
      expectedIdentity: {
        expectedExternalId: input.row.expectedExternalId!,
        expectedInventoryId: input.row.expectedInventoryId,
        expectedExternalRefId: input.row.expectedExternalRefId,
        expectedArtworkId: input.row.expectedArtworkId,
        expectedProcessedContentHash: input.row.expectedProcessedContentHash
      }
    })
    const ref = await transaction.artworkExternalRef.findUnique({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId: input.prepared.metadata.id } },
      select: { id: true, artworkId: true }
    })
    if (!ref || ref.artworkId !== result.artworkId) {
      throw new ScanExecutorError('STATE_CONFLICT', 'Published Pixiv identity is incomplete')
    }
    const inventory = await transaction.pixivMetadataInventory.updateMany({
      where: {
        id: input.row.expectedInventoryId!,
        relativePath: input.row.relativePath,
        externalId: input.row.expectedExternalId,
        externalRefId: input.row.expectedExternalRefId,
        processedContentHash: input.row.expectedProcessedContentHash
      },
      data: {
        ...statData(input.prepared.state),
        observedContentHash: input.prepared.contentHash,
        processedContentHash: input.prepared.contentHash,
        lastAttemptedContentHash: input.prepared.contentHash,
        externalId: input.prepared.metadata.id,
        externalRefId: ref.id,
        lastSeenScanRunId: input.runId,
        lastAttemptedAt: input.now,
        lastProcessedAt: input.now,
        lastErrorCode: null,
        lastErrorSummary: null,
        lastErrorRetryable: null
      }
    })
    if (inventory.count !== 1) throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv inventory changed after the audit')
    await writeOutcome(
      transaction,
      input.runId,
      input.itemId,
      input.row.ordinal,
      {
        status: 'SUCCESS',
        outcome: 'APPLIED',
        reasonCode: null,
        reasonSummary: null,
        retryable: false,
        resultArtworkId: result.artworkId,
        newImageCount: result.newImages,
        mediaCount: input.prepared.media.length
      },
      input.now
    )
  })
}

async function findAlreadyApplied(transaction: ScanTransaction, row: ApplyInput) {
  const locked = await transaction.$queryRaw<Array<{ artworkId: number }>>(Prisma.sql`
    SELECT artwork."id" AS "artworkId"
    FROM "pixiv_metadata_inventory" AS inventory
    JOIN "artwork_external_refs" AS source_ref
      ON source_ref."id" = inventory."externalRefId"
    JOIN "Artwork" AS artwork
      ON artwork."id" = source_ref."artworkId"
    WHERE inventory."id" = ${row.expectedInventoryId}
      AND inventory."relativePath" = ${row.relativePath}
      AND inventory."externalId" = ${row.expectedExternalId}
      AND inventory."processedContentHash" = ${row.contentHash}
      AND source_ref."providerKey" = 'pixiv'
      AND source_ref."externalId" = ${row.expectedExternalId}
      AND artwork."metaSource" = ${row.relativePath}
      AND NOT EXISTS (
        SELECT 1
        FROM "artwork_external_refs" AS other_ref
        WHERE other_ref."artworkId" = artwork."id"
          AND other_ref."providerKey" = 'pixiv'
          AND other_ref."id" <> source_ref."id"
      )
    FOR UPDATE OF inventory, source_ref, artwork
  `)
  return locked.length === 1 ? locked[0]! : null
}

async function markItemProcessing(context: ApplyContext, runId: string, sourceAuditItemId: string, now: Date) {
  return mutate(context, async (transaction) => {
    const item = await transaction.scanRunItem.findUnique({
      where: { scanRunId_sourceAuditItemId: { scanRunId: runId, sourceAuditItemId } }
    })
    if (!item) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply checkpoint is missing')
    if (item.applyOutcome !== null) return item
    return transaction.scanRunItem.update({
      where: { id: item.id },
      data: { status: 'PROCESSING', attempt: { increment: 1 }, startedAt: now, finishedAt: null }
    })
  })
}

async function recordItemOutcome(
  context: ApplyContext,
  runId: string,
  itemId: string,
  ordinal: number,
  result: OutcomeWrite,
  now: Date
) {
  return mutate(context, (transaction) => writeOutcome(transaction, runId, itemId, ordinal, result, now))
}

interface OutcomeWrite {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  outcome: ApplyOutcome
  reasonCode: string | null
  reasonSummary: string | null
  retryable: boolean
  resultArtworkId?: number | null
  newImageCount?: number
  mediaCount?: number
}

async function writeOutcome(
  transaction: ScanTransaction,
  runId: string,
  itemId: string,
  ordinal: number,
  result: OutcomeWrite,
  now: Date
) {
  const updated = await transaction.scanRunItem.updateMany({
    where: { id: itemId, scanRunId: runId, applyOutcome: null },
    data: {
      status: result.status,
      applyOutcome: result.outcome,
      applyReasonCode: result.reasonCode,
      applyReasonSummary: result.reasonSummary,
      applyRetryable: result.retryable,
      resultArtworkId: result.resultArtworkId ?? null,
      newImageCount: result.newImageCount ?? 0,
      mediaCount: result.mediaCount ?? 0,
      errorMessage: null,
      finishedAt: now
    }
  })
  if (updated.count !== 1) return false
  await transaction.scanRun.update({
    where: { id: runId },
    data: {
      checkpointStage: 'APPLYING',
      checkpointOrdinal: { set: ordinal + 1 },
      processedArtworks: { increment: 1 },
      ...(result.outcome === 'APPLIED'
        ? {
            succeededArtworks: { increment: 1 },
            publishedInputs: { increment: 1 },
            newImages: { increment: result.newImageCount ?? 0 }
          }
        : result.outcome === 'SKIPPED'
          ? {
              skippedArtworks: { increment: 1 },
              ...(result.reasonCode === 'STALE_SOURCE_INPUT' ? { auditApplyStaleInputs: { increment: 1 } } : {})
            }
          : {
              failedArtworks: { increment: 1 },
              failedInputs: { increment: 1 },
              ...(result.outcome === 'CONFLICT' ? { auditApplyConflictInputs: { increment: 1 } } : {})
            })
    }
  })
  return true
}

async function finalizeApplySuccess(
  context: ApplyContext,
  runId: string,
  root: SafeScanRoot,
  generation: number,
  now: Date
) {
  return context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'PAUSING') {
      await scope.transaction.scanRunItem.updateMany({
        where: { scanRunId: runId, applyOutcome: null, status: 'PROCESSING' },
        data: { status: 'PENDING', finishedAt: null }
      })
      await scope.transaction.scanRun.update({
        where: { id: runId },
        data: { status: 'PAUSED', checkpointStage: 'PAUSED', finishedAt: now }
      })
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Audit apply paused at a durable checkpoint' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await cancelOutstanding(scope.transaction, runId, now)
      await scope.cancel('Audit apply cancelled')
      return
    }
    await assertBarrierInTransaction(scope.transaction, root, generation)
    const pending = await scope.transaction.scanRunItem.count({ where: { scanRunId: runId, applyOutcome: null } })
    if (pending !== 0) throw new ScanExecutorError('STATE_CONFLICT', 'Audit apply has unfinished checkpoints')
    const result = await summarizeResult(scope.transaction, runId)
    await scope.transaction.scanRun.update({
      where: { id: runId },
      data: { status: 'COMPLETED', checkpointStage: 'COMPLETED', finishedAt: now, errorMessage: null }
    })
    await scope.complete({ result, message: 'Pixiv source audit apply completed' })
  })
}

async function finalizeApplyError(input: {
  context: ApplyContext
  runId: string
  currentItemId: string | null
  error: unknown
  now: Date
  retryDelayMs: number
}) {
  return input.context.finalizeInTransaction<ScanTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'PAUSING') {
      await scope.transaction.scanRunItem.updateMany({
        where: { scanRunId: input.runId, applyOutcome: null, status: 'PROCESSING' },
        data: { status: 'PENDING', finishedAt: null }
      })
      await scope.transaction.scanRun.update({
        where: { id: input.runId },
        data: { status: 'PAUSED', checkpointStage: 'PAUSED', finishedAt: input.now }
      })
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Audit apply paused at a durable checkpoint' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await cancelOutstanding(scope.transaction, input.runId, input.now)
      await scope.cancel('Audit apply cancelled')
      return
    }
    if (input.context.signal.aborted) {
      await resetInFlight(scope.transaction, input.runId)
      await scope.transaction.scanRun.update({
        where: { id: input.runId },
        data: { status: 'PENDING', checkpointStage: 'INTERRUPTED', errorMessage: null }
      })
      await scope.release('Worker stopped; audit apply will resume from its checkpoint')
      return
    }
    const retryable = isRetryableInfrastructureError(input.error)
    if (retryable && input.context.job.attempt < input.context.job.maxAttempts) {
      if (input.currentItemId) {
        await scope.transaction.scanRunItem.updateMany({
          where: { id: input.currentItemId, scanRunId: input.runId, applyOutcome: null },
          data: { status: 'RETRY_WAIT', finishedAt: null }
        })
      }
      await scope.transaction.scanRun.update({
        where: { id: input.runId },
        data: { status: 'RETRY_WAIT', checkpointStage: 'RETRY_WAIT', errorMessage: safeErrorSummary(input.error) }
      })
      await scope.retry({
        availableAt: new Date(input.now.getTime() + input.retryDelayMs),
        errorCode: 'INTERNAL_ERROR',
        error: safeErrorSummary(input.error),
        message: 'Audit apply will retry from its durable checkpoint'
      })
      return
    }
    await terminalizeOutstanding(scope.transaction, input.runId, input.now, retryable)
    const result = await summarizeResult(scope.transaction, input.runId)
    await scope.transaction.scanRun.update({
      where: { id: input.runId },
      data: {
        status: 'FAILED',
        checkpointStage: 'FAILED',
        finishedAt: input.now,
        processedArtworks: result.total,
        succeededArtworks: result.applied,
        skippedArtworks: result.skipped,
        failedArtworks: result.conflicts + result.failed,
        publishedInputs: result.applied,
        failedInputs: result.conflicts + result.failed,
        auditApplyStaleInputs: result.stale,
        auditApplyConflictInputs: result.conflicts,
        newImages: result.newImages,
        errorMessage: safeErrorSummary(input.error)
      }
    })
    await scope.fail({
      errorCode: input.error instanceof ScanExecutorError ? 'PRECONDITION_FAILED' : 'INTERNAL_ERROR',
      error: safeErrorSummary(input.error),
      message: 'Audit apply failed'
    })
  })
}

async function cancelOutstanding(transaction: ScanTransaction, runId: string, now: Date) {
  await transaction.scanRunItem.updateMany({
    where: { scanRunId: runId, applyOutcome: null },
    data: {
      status: 'FAILED',
      applyOutcome: 'FAILED',
      applyReasonCode: 'OPERATION_CANCELLED',
      applyReasonSummary: 'Operation was cancelled before this item completed',
      applyRetryable: true,
      finishedAt: now
    }
  })
  const result = await summarizeResult(transaction, runId)
  await transaction.scanRun.update({
    where: { id: runId },
    data: {
      status: 'CANCELLED',
      checkpointStage: 'CANCELLED',
      finishedAt: now,
      processedArtworks: result.total,
      succeededArtworks: result.applied,
      skippedArtworks: result.skipped,
      failedArtworks: result.conflicts + result.failed,
      publishedInputs: result.applied,
      failedInputs: result.conflicts + result.failed,
      newImages: result.newImages,
      auditApplyStaleInputs: result.stale,
      auditApplyConflictInputs: result.conflicts,
      errorMessage: null
    }
  })
}

async function terminalizeOutstanding(transaction: ScanTransaction, runId: string, now: Date, retryable: boolean) {
  await transaction.scanRunItem.updateMany({
    where: { scanRunId: runId, applyOutcome: null },
    data: {
      status: 'FAILED',
      applyOutcome: 'FAILED',
      applyReasonCode: 'OPERATION_FAILED',
      applyReasonSummary: 'Operation ended before this item completed',
      applyRetryable: retryable,
      finishedAt: now
    }
  })
}

async function resetInFlight(transaction: ScanTransaction, runId: string) {
  await transaction.scanRunItem.updateMany({
    where: { scanRunId: runId, applyOutcome: null, status: 'PROCESSING' },
    data: { status: 'PENDING', finishedAt: null }
  })
}

async function summarizeResult(transaction: ScanTransaction, runId: string): Promise<AuditApplyResult> {
  const items = await transaction.scanRunItem.findMany({
    where: { scanRunId: runId },
    select: { applyOutcome: true, applyReasonCode: true, newImageCount: true }
  })
  return {
    scanRunId: runId,
    total: items.length,
    applied: items.filter((item) => item.applyOutcome === 'APPLIED').length,
    skipped: items.filter((item) => item.applyOutcome === 'SKIPPED').length,
    stale: items.filter((item) => item.applyOutcome === 'SKIPPED' && item.applyReasonCode === 'STALE_SOURCE_INPUT')
      .length,
    conflicts: items.filter((item) => item.applyOutcome === 'CONFLICT').length,
    failed: items.filter((item) => item.applyOutcome === 'FAILED').length,
    newImages: items.reduce((sum, item) => sum + item.newImageCount, 0)
  }
}

async function assertApplyBarrier(database: ScanDatabase, root: SafeScanRoot, generation: number) {
  const state = await database.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
  assertBarrierState(state, root, generation)
}

async function assertBarrierInTransaction(transaction: ScanTransaction, root: SafeScanRoot, generation: number) {
  const state = await transaction.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
  assertBarrierState(state, root, generation)
}

function assertBarrierState(
  state: {
    status: string
    baselineGeneration: number
    rootPathHash: string
    rootDeviceId: bigint | null
    rootInode: bigint | null
  } | null,
  root: SafeScanRoot,
  generation: number
) {
  if (
    !state ||
    state.status !== 'READY' ||
    state.baselineGeneration !== generation ||
    state.rootPathHash !== hashScanRootIdentity(root.absolutePath) ||
    state.rootDeviceId !== root.deviceId ||
    state.rootInode !== root.inode
  )
    throw new ApplyBarrierError()
}

function stateFromInput(row: ApplyInput): StableFileState {
  return {
    sizeBytes: required(row.sizeBytes),
    mtimeMs: required(row.mtimeMs),
    ctimeMs: row.ctimeMs,
    deviceId: row.deviceId,
    inode: row.inode
  }
}

function sameFrozenState(left: StableFileState, right: StableFileState) {
  return (
    left.sizeBytes === right.sizeBytes &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId &&
    left.inode === right.inode
  )
}

function statData(state: StableFileState) {
  return {
    sizeBytes: state.sizeBytes,
    mtimeMs: state.mtimeMs,
    ctimeMs: state.ctimeMs,
    deviceId: state.deviceId,
    inode: state.inode
  }
}

function assertSameRoot(expected: SafeScanRoot, actual: SafeScanRoot) {
  if (
    expected.absolutePath !== actual.absolutePath ||
    expected.deviceId !== actual.deviceId ||
    expected.inode !== actual.inode
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Pixiv source root changed during audit apply')
  }
}

function differenceKind(value: string | null): 'NEW' | 'CHANGED' {
  if (value === 'NEW' || value === 'CHANGED') return value
  throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply classification is invalid')
}

function required<T>(value: T | null): T {
  if (value === null) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Audit apply evidence is incomplete')
  return value
}

class StaleSourceInputError extends Error {}
class MediaInputError extends Error {}
class ApplyBarrierError extends ScanExecutorError {
  constructor() {
    super('STATE_CONFLICT', 'Pixiv inventory or source root changed after the audit')
  }
}

function isStaleSourceError(error: unknown) {
  return (
    error instanceof StaleSourceInputError ||
    (error instanceof ScanExecutorError &&
      ['SOURCE_NOT_FOUND', 'SYMLINK_NOT_ALLOWED', 'PATH_OUTSIDE_SCAN_ROOT', 'INPUT_SNAPSHOT_INVALID'].includes(
        error.code
      ))
  )
}

function isBusinessInputError(error: unknown) {
  return (
    error instanceof MediaInputError ||
    (error instanceof ScanExecutorError && ['METADATA_INVALID', 'MEDIA_NOT_FOUND'].includes(error.code))
  )
}

function businessReasonCode(error: unknown) {
  if (error instanceof MediaInputError) return 'MEDIA_VALIDATION_FAILED'
  return error instanceof ScanExecutorError && error.code === 'METADATA_INVALID'
    ? 'METADATA_INVALID'
    : 'MEDIA_NOT_FOUND'
}

function businessReasonSummary(error: unknown) {
  if (error instanceof MediaInputError) return 'Source media did not pass validation'
  return error instanceof ScanExecutorError && error.code === 'METADATA_INVALID'
    ? 'Metadata did not pass validation'
    : 'No supported media was found for the source item'
}

function isRetryableBusinessInput(error: unknown) {
  return error instanceof MediaInputError || (error instanceof ScanExecutorError && error.code === 'MEDIA_NOT_FOUND')
}

function isRetryableInfrastructureError(error: unknown) {
  return (
    !(error instanceof ScanExecutorError) ||
    error.code === 'SOURCE_NOT_FOUND' ||
    error.code === 'SOURCE_NOT_READABLE' ||
    error.recoverable
  )
}

function safeErrorCode(error: unknown) {
  return error instanceof ScanExecutorError ? error.code : 'UNEXPECTED'
}

function safeErrorSummary(error: unknown) {
  return error instanceof ScanExecutorError ? error.message : 'Audit apply failed unexpectedly'
}

function mutate<TResult>(context: ApplyContext, operation: (transaction: ScanTransaction) => Promise<TResult>) {
  return context.mutateInTransaction<ScanTransaction & QueueSqlExecutor, TResult>((transaction) =>
    operation(transaction)
  )
}
