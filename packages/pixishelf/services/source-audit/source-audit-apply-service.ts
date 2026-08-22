import { createHash } from 'node:crypto'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTION_LANES,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  canonicalizeAuditApplyInputs,
  scanAuditApplyPayloadSchema,
  type AuditApplyInputEvidence,
  type JobStatus
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { lockSingletonJobType } from '@/services/background-task/manual-job-singleton'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  sourceAuditApplyOperationSchema,
  sourceAuditApplyOverviewInputSchema,
  sourceAuditApplyOverviewSchema,
  sourceAuditApplyOperationInputSchema,
  startSourceAuditApplyInputSchema,
  startSourceAuditApplyResultSchema,
  type SourceAuditApplyOperation,
  type StartSourceAuditApplyResult
} from './contracts'
import { decideSourceAuditItemApply, safeApplyResultCode, safeApplyResultSummary } from './apply-item-policy'
import {
  SourceAuditServiceError,
  inspectSafeScanRoot,
  readConfiguredScanRoot,
  supportsScanVersion,
  withTimeout,
  type SourceAuditDatabase,
  type SourceAuditServiceOptions
} from './source-audit-service'

const APPLY_OPERATION = 'AUDIT_APPLY'
const AUDIT_OPERATION = 'CONSISTENCY_AUDIT'
const APPLY_PRIORITY = 20
const APPLY_MAX_ATTEMPTS = 3
const APPLY_ROOT_PROBE_TIMEOUT_MS = 3_000
const ACTIVE_STATUSES = [...ACTIVE_JOB_STATUSES]
const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'])
const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/

type ApplyBlockedReason = Extract<StartSourceAuditApplyResult, { outcome: 'BLOCKED' }>['reason']

export async function startSourceAuditApply(
  input: { auditRunId: string; itemIds: string[]; idempotencyKey: string },
  requestedByUserId: string,
  options: SourceAuditServiceOptions = {}
): Promise<StartSourceAuditApplyResult> {
  const parsed = startSourceAuditApplyInputSchema.parse(input)
  const database = options.database ?? prisma
  const idempotencyKey = `source-audit-apply:${parsed.idempotencyKey}`
  const existing = await findApplyByIdempotencyKey(database, idempotencyKey)
  if (existing) return replayApply(existing, parsed, requestedByUserId)

  const environment = options.environment ?? process.env
  if (
    !isCentralDispatcherCutoverEnabled({
      CENTRAL_DISPATCHER_CUTOVER_ENABLED: environment.CENTRAL_DISPATCHER_CUTOVER_ENABLED
    })
  ) {
    return blocked('CUTOVER_DISABLED')
  }
  if (environment.WORKER_DISPATCH_ENABLED?.trim().toLowerCase() !== 'true') return blocked('DISPATCH_DISABLED')

  const configuredRoot = await readConfiguredScanRoot(database, options)
  if (!configuredRoot) return blocked('SCAN_ROOT_NOT_CONFIGURED')
  try {
    await withTimeout(
      (options.inspectRoot ?? inspectSafeScanRoot)(configuredRoot),
      options.rootProbeTimeoutMs ?? APPLY_ROOT_PROBE_TIMEOUT_MS
    )
  } catch {
    return blocked('SOURCE_ROOT_UNAVAILABLE')
  }

  return database.$transaction(async (transaction) => {
    await lockSingletonJobType(transaction, 'SCAN')

    const existing = await findApplyByIdempotencyKey(transaction as SourceAuditDatabase, idempotencyKey)
    if (existing) return replayApply(existing, parsed, requestedByUserId)

    const active = await findActiveScan(transaction as SourceAuditDatabase)
    if (active) return activeScanBlocked(active, parsed.auditRunId)

    const timestamp = options.now?.() ?? new Date()
    const readiness = await readApplyReadiness(transaction as SourceAuditDatabase, timestamp)
    if (readiness.reason) return blocked(readiness.reason)

    const audit = await transaction.scanRun.findFirst({
      where: { id: parsed.auditRunId, type: 'PIXIV', operationKind: AUDIT_OPERATION },
      select: {
        id: true,
        status: true,
        inputFrozenAt: true,
        inventoryBaselineGeneration: true,
        systemJob: { select: { status: true } },
        sourceAuditItems: {
          where: { id: { in: parsed.itemIds } },
          orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            ordinal: true,
            differenceKind: true,
            relativePath: true,
            expectedExternalId: true,
            observedExternalId: true,
            title: true,
            artistName: true,
            inventoryId: true,
            externalRefId: true,
            artworkId: true,
            observedContentHash: true,
            processedContentHash: true,
            sizeBytes: true,
            mtimeMs: true,
            ctimeMs: true,
            deviceId: true,
            inode: true,
            issueCode: true
          }
        },
        metadataInputs: {
          where: { sourceAuditItemId: { in: parsed.itemIds } },
          select: {
            sourceAuditItemId: true,
            auditDifferenceKind: true,
            relativePath: true,
            contentHash: true,
            expectedExternalId: true,
            expectedInventoryId: true,
            expectedExternalRefId: true,
            expectedArtworkId: true,
            sizeBytes: true,
            mtimeMs: true,
            ctimeMs: true,
            deviceId: true,
            inode: true
          }
        }
      }
    })
    if (
      !audit ||
      audit.status !== 'COMPLETED' ||
      audit.systemJob?.status !== 'COMPLETED' ||
      !audit.inputFrozenAt ||
      audit.inventoryBaselineGeneration === null
    ) {
      return blocked('AUDIT_NOT_COMPLETE')
    }
    if (readiness.baselineGeneration !== audit.inventoryBaselineGeneration) {
      return blocked('ITEMS_NOT_ELIGIBLE')
    }

    const evidence = freezeSelectedEvidence(audit, parsed.itemIds)
    if (!evidence) return blocked('ITEMS_NOT_ELIGIBLE')
    const applyHistory = await transaction.scanRunItem.findMany({
      where: {
        sourceAuditItemId: { in: parsed.itemIds },
        scanRun: { operationKind: APPLY_OPERATION, sourceAuditRunId: audit.id }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        sourceAuditItemId: true,
        auditDifferenceKind: true,
        applyOutcome: true,
        applyReasonCode: true,
        applyRetryable: true,
        finishedAt: true,
        scanRun: { select: { id: true, systemJob: { select: { status: true } } } }
      }
    })
    const historyByAuditItemId = new Map<string, typeof applyHistory>()
    for (const historyItem of applyHistory) {
      if (!historyItem.sourceAuditItemId) return blocked('ITEMS_NOT_ELIGIBLE')
      const history = historyByAuditItemId.get(historyItem.sourceAuditItemId) ?? []
      history.push(historyItem)
      historyByAuditItemId.set(historyItem.sourceAuditItemId, history)
    }
    const allItemsEligible = evidence.items.every((item) => {
      const action = item.differenceKind === 'NEW' ? 'IMPORT' : 'SYNC'
      return decideSourceAuditItemApply(action, historyByAuditItemId.get(item.id) ?? []).state === 'ELIGIBLE'
    })
    if (!allItemsEligible) return blocked('ITEMS_NOT_ELIGIBLE')

    const inputDigest = createHash('sha256').update(canonicalizeAuditApplyInputs(audit.id, evidence.rows)).digest('hex')
    const payload = scanAuditApplyPayloadSchema.parse({
      mode: APPLY_OPERATION,
      auditRunId: audit.id,
      inputCount: evidence.rows.length,
      inputDigest
    })

    const job = await transaction.systemJob.create({
      data: {
        type: 'SCAN',
        executionLane: EXECUTION_LANES.BACKGROUND_WRITER,
        definitionVersion: SCAN_AUDIT_APPLY_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId,
        idempotencyKey,
        payload,
        queuePriority: APPLY_PRIORITY,
        effectivePriority: APPLY_PRIORITY,
        availableAt: timestamp,
        maxAttempts: APPLY_MAX_ATTEMPTS
      }
    })
    const applyRun = await transaction.scanRun.create({
      data: {
        systemJobId: job.id,
        type: 'PIXIV',
        mode: 'INCREMENTAL',
        operationKind: APPLY_OPERATION,
        sourceAuditRunId: audit.id,
        status: 'PENDING',
        inputDigest,
        inputCount: evidence.rows.length,
        inputFrozenAt: timestamp,
        inventoryBaselineGeneration: audit.inventoryBaselineGeneration,
        checkpointStage: 'QUEUED',
        checkpointOrdinal: 0,
        totalArtworks: evidence.rows.length,
        processedArtworks: 0,
        succeededArtworks: 0,
        skippedArtworks: 0,
        failedArtworks: 0,
        metadataCandidates: evidence.rows.length,
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0,
        auditNewInputs: evidence.newCount,
        auditChangedInputs: evidence.changedCount,
        auditApplyStaleInputs: 0,
        auditApplyConflictInputs: 0,
        publishDurationMs: 0
      }
    })
    await transaction.scanRunMetadataInput.createMany({
      data: evidence.rows.map((row) => ({
        scanRunId: applyRun.id,
        ordinal: row.ordinal,
        relativePath: row.relativePath,
        contentHash: row.observedContentHash,
        sizeBytes: row.sizeBytes,
        mtimeMs: row.mtimeMs,
        ctimeMs: row.ctimeMs,
        deviceId: row.deviceId,
        inode: row.inode,
        sourceAuditItemId: row.sourceAuditItemId,
        auditDifferenceKind: row.auditDifferenceKind,
        expectedExternalId: row.expectedExternalId,
        observedExternalId: row.observedExternalId,
        expectedInventoryId: row.expectedInventoryId,
        expectedExternalRefId: row.expectedExternalRefId,
        expectedArtworkId: row.expectedArtworkId,
        expectedProcessedContentHash: row.processedContentHash
      }))
    })
    await transaction.scanRunItem.createMany({
      data: evidence.items.map((item) => ({
        scanRunId: applyRun.id,
        checkpointKey: `audit-apply:${item.id}`,
        sourceAuditItemId: item.id,
        auditDifferenceKind: item.differenceKind,
        externalId: item.expectedExternalId,
        title: item.title,
        artistName: item.artistName,
        metadataRelativePath: item.relativePath,
        status: 'PENDING',
        action: item.differenceKind === 'NEW' ? 'CREATE' : 'UPDATE',
        attempt: 0
      }))
    })
    await transaction.systemJobEvent.create({
      data: {
        jobId: job.id,
        type: 'job.queued',
        level: 'INFO',
        attempt: 0,
        message: 'Pixiv source audit apply queued',
        data: { triggerSource: 'MANUAL', priority: APPLY_PRIORITY, auditRunId: audit.id }
      }
    })
    return startSourceAuditApplyResultSchema.parse({
      outcome: 'ACCEPTED',
      operationId: applyRun.id,
      jobId: job.id,
      status: job.status,
      reused: false
    })
  })
}

export async function getSourceAuditApplyOverview(
  input: { auditRunId: string },
  options: SourceAuditServiceOptions = {}
) {
  const parsed = sourceAuditApplyOverviewInputSchema.parse(input)
  const database = options.database ?? prisma
  const audit = await database.scanRun.findFirst({
    where: { id: parsed.auditRunId, type: 'PIXIV', operationKind: AUDIT_OPERATION },
    select: { id: true }
  })
  if (!audit) throw new SourceAuditServiceError('NOT_FOUND', 'Source audit was not found')
  const runs = await database.scanRun.findMany({
    where: { type: 'PIXIV', operationKind: APPLY_OPERATION, sourceAuditRunId: audit.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: { id: true, systemJobId: true, systemJob: { select: { status: true } } }
  })
  const references = runs.flatMap((run) => {
    if (!run.systemJobId || !run.systemJob) return []
    return [{ operationId: run.id, jobId: run.systemJobId, status: run.systemJob.status }]
  })
  return sourceAuditApplyOverviewSchema.parse({
    activeOperation: references.find((reference) => ACTIVE_JOB_STATUSES.has(reference.status as JobStatus)) ?? null,
    latestOperation: references[0] ?? null
  })
}

export async function getSourceAuditApplyOperation(
  input: { operationId: string },
  options: SourceAuditServiceOptions = {}
): Promise<SourceAuditApplyOperation> {
  const parsed = sourceAuditApplyOperationInputSchema.parse(input)
  const database = options.database ?? prisma
  const run = await database.scanRun.findFirst({
    where: { id: parsed.operationId, type: 'PIXIV', operationKind: APPLY_OPERATION },
    select: {
      id: true,
      systemJobId: true,
      sourceAuditRunId: true,
      status: true,
      checkpointStage: true,
      auditNewInputs: true,
      auditChangedInputs: true,
      inputCount: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      systemJob: { select: { status: true, startedAt: true, finishedAt: true } },
      metadataInputs: {
        orderBy: { ordinal: 'asc' },
        select: { sourceAuditItemId: true, relativePath: true, auditDifferenceKind: true }
      },
      items: {
        select: {
          id: true,
          sourceAuditItemId: true,
          auditDifferenceKind: true,
          externalId: true,
          title: true,
          artistName: true,
          metadataRelativePath: true,
          status: true,
          applyOutcome: true,
          resultArtworkId: true,
          applyReasonCode: true,
          applyRetryable: true,
          startedAt: true,
          finishedAt: true
        }
      }
    }
  })
  if (!run?.systemJob || !run.systemJobId || !run.sourceAuditRunId) {
    throw new SourceAuditServiceError('NOT_FOUND', 'Source audit apply operation was not found')
  }

  const itemByAuditId = new Map(
    run.items.flatMap((item) => (item.sourceAuditItemId ? [[item.sourceAuditItemId, item]] : []))
  )
  const ordered = run.metadataInputs.flatMap((inputRow) => {
    if (!inputRow.sourceAuditItemId) return []
    const item = itemByAuditId.get(inputRow.sourceAuditItemId)
    return item ? [{ inputRow, item }] : []
  })
  const artworkIds = [...new Set(ordered.flatMap(({ item }) => (item.resultArtworkId ? [item.resultArtworkId] : [])))]
  const artworks =
    artworkIds.length === 0
      ? []
      : await database.artwork.findMany({ where: { id: { in: artworkIds } }, select: { id: true, title: true } })
  const artworkById = new Map(artworks.map((artwork) => [artwork.id, artwork]))
  const items = ordered.map(({ inputRow, item }) => {
    const classification = applyClassification(item.auditDifferenceKind ?? inputRow.auditDifferenceKind)
    const code = safeApplyResultCode(item.applyReasonCode)
    return {
      id: item.id,
      auditItemId: inputRow.sourceAuditItemId!,
      classification,
      action: classification === 'NEW' ? ('IMPORT' as const) : ('SYNC' as const),
      state: applyItemState(item.status, item.applyOutcome, code),
      externalId: item.externalId,
      title: item.title,
      artistName: item.artistName,
      metadataRelativePath: item.metadataRelativePath ?? inputRow.relativePath,
      artwork: item.resultArtworkId ? (artworkById.get(item.resultArtworkId) ?? null) : null,
      code,
      summary: code ? safeApplyResultSummary(code) : null,
      retryable: item.applyRetryable === true,
      startedAt: iso(item.startedAt),
      finishedAt: iso(item.finishedAt)
    }
  })
  const counts = countApplyStates(items.map((item) => item.state))
  const status = run.systemJob.status
  const terminal = TERMINAL_JOB_STATUSES.has(status)
  const completedItems = counts.applied + counts.skipped + counts.stale + counts.conflict + counts.failed
  const resultComplete = terminal && TERMINAL_RUN_STATUSES.has(run.status) && completedItems === run.inputCount
  return sourceAuditApplyOperationSchema.parse({
    id: run.id,
    auditRunId: run.sourceAuditRunId,
    jobId: run.systemJobId,
    status,
    terminal,
    resultComplete,
    progress: run.inputCount === 0 ? 0 : Math.min(100, Math.floor((completedItems / run.inputCount) * 100)),
    stage: safeApplyStage(run.checkpointStage, status),
    requested: {
      total: run.inputCount,
      new: Math.max(0, run.auditNewInputs ?? 0),
      changed: Math.max(0, run.auditChangedInputs ?? 0)
    },
    counts,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt ?? run.systemJob.startedAt),
    finishedAt: iso(run.finishedAt ?? run.systemJob.finishedAt),
    items
  })
}

async function findApplyByIdempotencyKey(database: SourceAuditDatabase, idempotencyKey: string) {
  return database.systemJob.findUnique({
    where: { idempotencyKey },
    include: {
      scanRun: {
        select: {
          id: true,
          operationKind: true,
          sourceAuditRunId: true,
          inputDigest: true,
          inputCount: true,
          inputFrozenAt: true,
          metadataInputs: { orderBy: { ordinal: 'asc' }, select: { sourceAuditItemId: true } }
        }
      }
    }
  })
}

function replayApply(
  job: NonNullable<Awaited<ReturnType<typeof findApplyByIdempotencyKey>>>,
  input: { auditRunId: string; itemIds: string[] },
  requestedByUserId: string
): StartSourceAuditApplyResult {
  const payload = scanAuditApplyPayloadSchema.safeParse(job.payload)
  const frozenItemIds = job.scanRun?.metadataInputs.flatMap((row) => row.sourceAuditItemId ?? []) ?? []
  const sameItems = sameSortedStrings(frozenItemIds, input.itemIds)
  if (
    job.type !== 'SCAN' ||
    job.definitionVersion !== SCAN_AUDIT_APPLY_DEFINITION_VERSION ||
    job.requestedByUserId !== requestedByUserId ||
    !payload.success ||
    payload.data.auditRunId !== input.auditRunId ||
    job.scanRun?.operationKind !== APPLY_OPERATION ||
    job.scanRun.sourceAuditRunId !== input.auditRunId ||
    !job.scanRun.inputFrozenAt ||
    job.scanRun.inputCount !== frozenItemIds.length ||
    payload.data.inputCount !== frozenItemIds.length ||
    job.scanRun.inputDigest !== payload.data.inputDigest ||
    !sameItems
  ) {
    return blocked('IDEMPOTENCY_CONFLICT')
  }
  return startSourceAuditApplyResultSchema.parse({
    outcome: 'ACCEPTED',
    operationId: job.scanRun.id,
    jobId: job.id,
    status: job.status,
    reused: true
  })
}

async function findActiveScan(database: SourceAuditDatabase) {
  return database.systemJob.findFirst({
    where: { type: 'SCAN', status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
    include: { scanRun: { select: { id: true, operationKind: true, sourceAuditRunId: true } } }
  })
}

function activeScanBlocked(job: Awaited<ReturnType<typeof findActiveScan>>, requestedAuditRunId: string) {
  return job?.scanRun?.operationKind === APPLY_OPERATION && job.scanRun.sourceAuditRunId === requestedAuditRunId
    ? blocked('APPLY_ACTIVE', job.scanRun.id)
    : blocked('SCAN_BUSY')
}

async function readApplyReadiness(database: SourceAuditDatabase, now: Date) {
  const inventory = await database.pixivMetadataInventoryState.findUnique({
    where: { id: 'pixiv' },
    select: { status: true, baselineGeneration: true }
  })
  if (inventory?.status !== 'READY') {
    return { reason: 'INVENTORY_NOT_READY' as const, baselineGeneration: null }
  }
  const workers = await database.workerInstance.findMany({
    where: {
      status: 'READY',
      heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) }
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  if (!workers.some((worker) => supportsScanVersion(worker.capabilities, SCAN_AUDIT_APPLY_DEFINITION_VERSION))) {
    return { reason: 'WORKER_NOT_READY' as const, baselineGeneration: inventory.baselineGeneration }
  }
  return { reason: null, baselineGeneration: inventory.baselineGeneration }
}

function freezeSelectedEvidence(
  audit: {
    id: string
    sourceAuditItems: Array<{
      id: string
      ordinal: number
      differenceKind: string
      relativePath: string
      expectedExternalId: string | null
      observedExternalId: string | null
      title: string | null
      artistName: string | null
      inventoryId: string | null
      externalRefId: string | null
      artworkId: number | null
      observedContentHash: string | null
      processedContentHash: string | null
      sizeBytes: bigint | null
      mtimeMs: bigint | null
      ctimeMs: bigint | null
      deviceId: bigint | null
      inode: bigint | null
      issueCode: string | null
    }>
    metadataInputs: Array<{
      sourceAuditItemId: string | null
      auditDifferenceKind: string | null
      relativePath: string
      contentHash: string | null
      expectedExternalId: string | null
      expectedInventoryId: string | null
      expectedExternalRefId: string | null
      expectedArtworkId: number | null
      sizeBytes: bigint | null
      mtimeMs: bigint | null
      ctimeMs: bigint | null
      deviceId: bigint | null
      inode: bigint | null
    }>
  },
  requestedIds: readonly string[]
) {
  if (audit.sourceAuditItems.length !== requestedIds.length || audit.metadataInputs.length !== requestedIds.length) {
    return null
  }
  const requested = new Set(requestedIds)
  const sourceInputByItemId = new Map(
    audit.metadataInputs.flatMap((row) => (row.sourceAuditItemId ? [[row.sourceAuditItemId, row] as const] : []))
  )
  const rows: AuditApplyInputEvidence[] = []
  for (const [ordinal, item] of audit.sourceAuditItems.entries()) {
    if (!requested.has(item.id) || (item.differenceKind !== 'NEW' && item.differenceKind !== 'CHANGED')) return null
    const sourceInput = sourceInputByItemId.get(item.id)
    if (
      !sourceInput ||
      sourceInput.auditDifferenceKind !== item.differenceKind ||
      sourceInput.relativePath !== item.relativePath ||
      sourceInput.contentHash !== item.observedContentHash ||
      sourceInput.expectedExternalId !== item.expectedExternalId ||
      sourceInput.expectedInventoryId !== item.inventoryId ||
      sourceInput.expectedExternalRefId !== item.externalRefId ||
      sourceInput.expectedArtworkId !== item.artworkId ||
      sourceInput.sizeBytes !== item.sizeBytes ||
      sourceInput.mtimeMs !== item.mtimeMs ||
      sourceInput.ctimeMs !== item.ctimeMs ||
      sourceInput.deviceId !== item.deviceId ||
      sourceInput.inode !== item.inode ||
      !item.expectedExternalId ||
      item.observedExternalId !== item.expectedExternalId ||
      !item.inventoryId ||
      !item.observedContentHash ||
      !SHA256_PATTERN.test(item.observedContentHash) ||
      (item.processedContentHash !== null && !SHA256_PATTERN.test(item.processedContentHash)) ||
      item.sizeBytes === null ||
      item.mtimeMs === null ||
      item.issueCode !== null
    ) {
      return null
    }
    if (item.differenceKind === 'NEW' && (item.externalRefId !== null || item.artworkId !== null)) return null
    if (item.differenceKind === 'CHANGED' && (!item.externalRefId || !item.artworkId)) return null
    rows.push({
      ordinal,
      sourceAuditItemId: item.id,
      auditDifferenceKind: item.differenceKind,
      relativePath: item.relativePath,
      expectedExternalId: item.expectedExternalId,
      observedExternalId: item.observedExternalId,
      expectedInventoryId: item.inventoryId,
      expectedExternalRefId: item.externalRefId,
      expectedArtworkId: item.artworkId,
      observedContentHash: item.observedContentHash,
      processedContentHash: item.processedContentHash,
      sizeBytes: item.sizeBytes,
      mtimeMs: item.mtimeMs,
      ctimeMs: item.ctimeMs,
      deviceId: item.deviceId,
      inode: item.inode
    })
  }
  return {
    rows,
    items: audit.sourceAuditItems,
    newCount: audit.sourceAuditItems.filter((item) => item.differenceKind === 'NEW').length,
    changedCount: audit.sourceAuditItems.filter((item) => item.differenceKind === 'CHANGED').length
  }
}

function blocked(reason: ApplyBlockedReason, activeOperationId: string | null = null): StartSourceAuditApplyResult {
  return startSourceAuditApplyResultSchema.parse({ outcome: 'BLOCKED', reason, activeOperationId })
}

function sameSortedStrings(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

function applyClassification(value: string | null) {
  if (value === 'NEW' || value === 'CHANGED') return value
  throw new Error('Invalid source audit apply classification')
}

function applyItemState(status: string, outcome: string | null, code: string | null) {
  if (outcome === 'APPLIED') return 'APPLIED' as const
  if (outcome === 'SKIPPED') return code === 'STALE_SOURCE_INPUT' ? ('STALE' as const) : ('SKIPPED' as const)
  if (outcome === 'CONFLICT') return 'CONFLICT' as const
  if (outcome === 'FAILED') return 'FAILED' as const
  return status === 'PROCESSING' || status === 'RETRY_WAIT' ? ('PROCESSING' as const) : ('PENDING' as const)
}

function countApplyStates(states: Array<ReturnType<typeof applyItemState>>) {
  return {
    pending: states.filter((state) => state === 'PENDING').length,
    processing: states.filter((state) => state === 'PROCESSING').length,
    applied: states.filter((state) => state === 'APPLIED').length,
    skipped: states.filter((state) => state === 'SKIPPED').length,
    stale: states.filter((state) => state === 'STALE').length,
    conflict: states.filter((state) => state === 'CONFLICT').length,
    failed: states.filter((state) => state === 'FAILED').length
  }
}

function safeApplyStage(value: string | null, status: string) {
  if (status === 'PAUSED') return 'PAUSED'
  if (status === 'COMPLETED') return 'COMPLETED'
  if (status === 'FAILED') return 'FAILED'
  if (status === 'CANCELLED' || status === 'CANCELLING') return 'CANCELLED'
  if (value === 'VERIFYING' || value === 'APPLYING' || value === 'FINALIZING') return value
  return 'QUEUED'
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}
