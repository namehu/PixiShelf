import * as fs from 'node:fs/promises'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTION_LANES,
  SCAN_DEFINITION_VERSION,
  scanV2PayloadSchema,
  workerCapabilitySchema,
  type JobStatus
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { lockSingletonJobType } from '@/services/background-task/manual-job-singleton'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  SOURCE_AUDIT_CLASSIFICATION_VALUES,
  listSourceAuditItemsInputSchema,
  sourceAuditAvailabilitySchema,
  sourceAuditItemPageSchema,
  sourceAuditRunIdInputSchema,
  sourceAuditSummarySchema,
  startSourceAuditInputSchema,
  startSourceAuditResultSchema,
  type SourceAuditAvailability,
  type SourceAuditClassification
} from './contracts'
import { decideSourceAuditItemApply, sourceAuditLatestApplyResult } from './apply-item-policy'
import { decodeSourceAuditCursor, encodeSourceAuditCursor } from './cursor'

const ACTIVE_STATUSES = [...ACTIVE_JOB_STATUSES]
const SOURCE_AUDIT_OPERATION = 'CONSISTENCY_AUDIT'
const SOURCE_AUDIT_PAYLOAD = { mode: SOURCE_AUDIT_OPERATION, verification: 'FAST' } as const
const SOURCE_AUDIT_PRIORITY = 10
const SOURCE_AUDIT_MAX_ATTEMPTS = 3
const DEFAULT_ROOT_PROBE_TIMEOUT_MS = 3_000
const KNOWN_REASON_CODES = new Set([
  'DUPLICATE_METADATA_IDENTITY',
  'IDENTITY_CONFLICT',
  'METADATA_INVALID',
  'METADATA_TOO_LARGE',
  'SOURCE_MISSING'
])

export type SourceAuditDatabase = typeof prisma
interface ReadinessClient {
  pixivMetadataInventoryState: {
    findUnique(input: { where: { id: string }; select: { status: true } }): Promise<{ status: string } | null>
  }
  workerInstance: {
    findMany(input: {
      where: { status: 'READY'; heartbeatAt: { gte: Date } }
      orderBy: { heartbeatAt: 'desc' }
      take: number
      select: { capabilities: true }
    }): Promise<Array<{ capabilities: unknown }>>
  }
}

export class SourceAuditServiceError extends Error {
  constructor(
    readonly code: 'BLOCKED' | 'CONFLICT' | 'NOT_FOUND' | 'INVALID_CURSOR',
    message: string
  ) {
    super(message)
    this.name = 'SourceAuditServiceError'
  }
}

interface SourceAuditEnvironment {
  CENTRAL_DISPATCHER_CUTOVER_ENABLED?: string
  WORKER_DISPATCH_ENABLED?: string
}

export interface SourceAuditServiceOptions {
  database?: SourceAuditDatabase
  environment?: SourceAuditEnvironment
  now?: () => Date
  inspectRoot?: (configuredRoot: string) => Promise<void>
  getScanRoot?: () => Promise<string | null>
  rootProbeTimeoutMs?: number
}

export async function getSourceAuditAvailability(
  options: SourceAuditServiceOptions = {}
): Promise<SourceAuditAvailability> {
  const database = options.database ?? prisma
  const environment = options.environment ?? process.env
  const now = options.now?.() ?? new Date()
  const active = await findActiveScan(database)
  if (active) {
    const activeAudit = activeAuditReference(active)
    if (activeAudit) {
      return sourceAuditAvailabilitySchema.parse({
        available: false,
        reason: 'AUDIT_ACTIVE',
        activeAudit
      })
    }
    return blockedAvailability('SCAN_BUSY')
  }
  if (
    !isCentralDispatcherCutoverEnabled({
      CENTRAL_DISPATCHER_CUTOVER_ENABLED: environment.CENTRAL_DISPATCHER_CUTOVER_ENABLED
    })
  ) {
    return blockedAvailability('CUTOVER_DISABLED')
  }
  if (!environmentFlagEnabled(environment.WORKER_DISPATCH_ENABLED)) return blockedAvailability('DISPATCH_DISABLED')

  const configuredRoot = await readConfiguredScanRoot(database, options)
  if (!configuredRoot) return blockedAvailability('SCAN_ROOT_NOT_CONFIGURED')

  const inventoryState = await database.pixivMetadataInventoryState.findUnique({
    where: { id: 'pixiv' },
    select: { status: true }
  })
  if (inventoryState?.status !== 'READY') return blockedAvailability('INVENTORY_NOT_READY')

  const workers = await database.workerInstance.findMany({
    where: {
      status: 'READY',
      heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) }
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  if (!workers.some((worker) => supportsScanV2(worker.capabilities))) {
    return blockedAvailability('WORKER_NOT_READY')
  }

  return sourceAuditAvailabilitySchema.parse({ available: true, reason: null, activeAudit: null })
}

export async function startSourceAudit(
  input: { requestId: string },
  requestedByUserId: string,
  options: SourceAuditServiceOptions = {}
) {
  const parsed = startSourceAuditInputSchema.parse(input)
  const database = options.database ?? prisma
  const idempotencyKey = `source-audit:${parsed.requestId}`
  const idempotent = await database.systemJob.findUnique({
    where: { idempotencyKey },
    include: { scanRun: { select: { id: true, operationKind: true } } }
  })
  if (idempotent) {
    const audit = activeOrHistoricalAuditReference(idempotent)
    if (!audit || idempotent.requestedByUserId !== requestedByUserId) {
      throw new SourceAuditServiceError('CONFLICT', 'The audit request id is already bound to another request')
    }
    return startSourceAuditResultSchema.parse({ ...audit, reused: true })
  }
  const existingActive = await findActiveScan(database)
  if (existingActive) {
    throw new SourceAuditServiceError(
      'CONFLICT',
      activeAuditReference(existingActive) ? 'A source audit is already active' : 'Another scan is already active'
    )
  }

  const availability = await getSourceAuditAvailability(options)
  if (!availability.available) {
    throw new SourceAuditServiceError(
      availability.reason === 'SCAN_BUSY' ? 'CONFLICT' : 'BLOCKED',
      availabilityMessage(availability.reason)
    )
  }
  const configuredRoot = await readConfiguredScanRoot(database, options)
  if (!configuredRoot) throw new SourceAuditServiceError('BLOCKED', 'Scan root is not configured')
  try {
    await withTimeout(
      (options.inspectRoot ?? inspectSafeScanRoot)(configuredRoot),
      options.rootProbeTimeoutMs ?? DEFAULT_ROOT_PROBE_TIMEOUT_MS
    )
  } catch {
    throw new SourceAuditServiceError('BLOCKED', 'Scan root is not safely accessible')
  }

  return database.$transaction(async (transaction) => {
    await lockSingletonJobType(transaction, 'SCAN')

    const idempotent = await transaction.systemJob.findUnique({
      where: { idempotencyKey },
      include: { scanRun: { select: { id: true, operationKind: true } } }
    })
    if (idempotent) {
      const audit = activeOrHistoricalAuditReference(idempotent)
      if (!audit || idempotent.requestedByUserId !== requestedByUserId) {
        throw new SourceAuditServiceError('CONFLICT', 'The audit request id is already bound to another request')
      }
      return startSourceAuditResultSchema.parse({ ...audit, reused: true })
    }

    const active = await transaction.systemJob.findFirst({
      where: { type: 'SCAN', status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
      include: { scanRun: { select: { id: true, operationKind: true } } }
    })
    if (active) {
      throw new SourceAuditServiceError(
        'CONFLICT',
        activeAuditReference(active) ? 'A source audit is already active' : 'Another scan is already active'
      )
    }

    await assertTransactionalReadiness(transaction, options.now?.() ?? new Date())

    const timestamp = options.now?.() ?? new Date()
    const job = await transaction.systemJob.create({
      data: {
        type: 'SCAN',
        executionLane: EXECUTION_LANES.BACKGROUND_WRITER,
        definitionVersion: SCAN_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId,
        idempotencyKey,
        payload: SOURCE_AUDIT_PAYLOAD,
        queuePriority: SOURCE_AUDIT_PRIORITY,
        effectivePriority: SOURCE_AUDIT_PRIORITY,
        availableAt: timestamp,
        maxAttempts: SOURCE_AUDIT_MAX_ATTEMPTS
      }
    })
    const auditRun = await transaction.scanRun.create({
      data: {
        systemJobId: job.id,
        type: 'PIXIV',
        mode: 'INCREMENTAL',
        operationKind: SOURCE_AUDIT_OPERATION,
        status: 'PENDING',
        checkpointStage: 'QUEUED',
        walkedEntries: 0,
        metadataCandidates: 0,
        inventoryUnchanged: 0,
        contentHashed: 0,
        contentChanged: 0,
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0,
        missingInputs: 0,
        auditNewInputs: 0,
        auditChangedInputs: 0,
        auditInvalidInputs: 0,
        auditIdentityConflictInputs: 0,
        discoveryDurationMs: 0,
        hashDurationMs: 0,
        publishDurationMs: 0
      }
    })
    await transaction.systemJobEvent.create({
      data: {
        jobId: job.id,
        type: 'job.queued',
        level: 'INFO',
        attempt: 0,
        message: 'Pixiv source consistency audit queued',
        data: { triggerSource: 'MANUAL', priority: SOURCE_AUDIT_PRIORITY }
      }
    })
    return startSourceAuditResultSchema.parse({
      jobId: job.id,
      auditRunId: auditRun.id,
      status: job.status,
      reused: false
    })
  })
}

export async function getSourceAudit(input: { auditRunId: string }, options: SourceAuditServiceOptions = {}) {
  const parsed = sourceAuditRunIdInputSchema.parse(input)
  const database = options.database ?? prisma
  const run = await database.scanRun.findFirst({
    where: { id: parsed.auditRunId, type: 'PIXIV', operationKind: SOURCE_AUDIT_OPERATION },
    select: {
      id: true,
      systemJobId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      auditNewInputs: true,
      auditChangedInputs: true,
      missingInputs: true,
      auditInvalidInputs: true,
      auditIdentityConflictInputs: true,
      inventoryUnchanged: true,
      walkedEntries: true,
      metadataCandidates: true,
      contentHashed: true,
      contentChanged: true,
      discoveryDurationMs: true,
      hashDurationMs: true,
      systemJob: {
        select: {
          id: true,
          status: true,
          errorCode: true,
          startedAt: true,
          finishedAt: true,
          events: {
            where: { type: 'job.paused' },
            orderBy: { id: 'desc' },
            take: 1,
            select: { data: true }
          }
        }
      }
    }
  })
  if (!run?.systemJob || !run.systemJobId) return null

  const status = run.systemJob.status
  return sourceAuditSummarySchema.parse({
    id: run.id,
    jobId: run.systemJobId,
    status,
    verification: 'FAST',
    startedAt: iso(run.startedAt ?? run.systemJob.startedAt),
    finishedAt: iso(run.finishedAt ?? run.systemJob.finishedAt),
    completed: status === 'COMPLETED' && run.status === 'COMPLETED',
    actionRequiredReason: actionRequiredReason(status, run.systemJob.errorCode, run.systemJob.events[0]?.data),
    counts: {
      new: nonnegative(run.auditNewInputs),
      changed: nonnegative(run.auditChangedInputs),
      missing: nonnegative(run.missingInputs),
      invalid: nonnegative(run.auditInvalidInputs),
      identityConflict: nonnegative(run.auditIdentityConflictInputs),
      unchanged: nonnegative(run.inventoryUnchanged)
    },
    work: {
      walked: nonnegative(run.walkedEntries),
      candidates: nonnegative(run.metadataCandidates),
      hashed: nonnegative(run.contentHashed),
      changed: nonnegative(run.contentChanged),
      discoveryDurationMs: nonnegative(run.discoveryDurationMs),
      hashDurationMs: nonnegative(run.hashDurationMs)
    }
  })
}

export async function listSourceAuditItems(
  input: {
    auditRunId: string
    classification?: SourceAuditClassification
    cursor?: string
    limit?: number
  },
  options: SourceAuditServiceOptions = {}
) {
  const parsed = listSourceAuditItemsInputSchema.parse(input)
  const database = options.database ?? prisma
  const run = await database.scanRun.findFirst({
    where: { id: parsed.auditRunId, type: 'PIXIV', operationKind: SOURCE_AUDIT_OPERATION },
    select: { id: true, status: true, systemJob: { select: { status: true } } }
  })
  if (!run) throw new SourceAuditServiceError('NOT_FOUND', 'Source audit was not found')
  if (run.status !== 'COMPLETED' || run.systemJob?.status !== 'COMPLETED') {
    throw new SourceAuditServiceError('BLOCKED', 'Source audit results are not complete')
  }

  let cursor: ReturnType<typeof decodeSourceAuditCursor> | undefined
  if (parsed.cursor) {
    try {
      cursor = decodeSourceAuditCursor(parsed.cursor)
      if (cursor.auditRunId !== parsed.auditRunId || cursor.classification !== (parsed.classification ?? null)) {
        throw new Error('Source audit cursor does not match this result view')
      }
    } catch {
      throw new SourceAuditServiceError('INVALID_CURSOR', 'Source audit cursor is invalid')
    }
  }

  const rows = await database.pixivSourceAuditItem.findMany({
    where: {
      scanRunId: run.id,
      differenceKind: parsed.classification ?? { in: [...SOURCE_AUDIT_CLASSIFICATION_VALUES] },
      ...(cursor
        ? {
            OR: [{ ordinal: { gt: cursor.ordinal } }, { ordinal: cursor.ordinal, id: { gt: cursor.id } }]
          }
        : {})
    },
    orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    take: parsed.limit + 1,
    select: {
      id: true,
      ordinal: true,
      differenceKind: true,
      relativePath: true,
      expectedExternalId: true,
      observedExternalId: true,
      title: true,
      artistName: true,
      artworkId: true,
      issueCode: true
    }
  })
  const hasMore = rows.length > parsed.limit
  const visible = hasMore ? rows.slice(0, parsed.limit) : rows
  const latestApplyRows = await database.scanRunItem.findMany({
    where: {
      sourceAuditItemId: { in: visible.map((row) => row.id) },
      scanRun: { operationKind: 'AUDIT_APPLY', sourceAuditRunId: run.id }
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      sourceAuditItemId: true,
      auditDifferenceKind: true,
      applyOutcome: true,
      resultArtworkId: true,
      applyReasonCode: true,
      applyRetryable: true,
      finishedAt: true,
      scanRun: { select: { id: true, systemJob: { select: { status: true } } } }
    }
  })
  const applyHistoryByAuditItemId = new Map<string, Array<(typeof latestApplyRows)[number]>>()
  for (const apply of latestApplyRows) {
    if (!apply.sourceAuditItemId) continue
    const history = applyHistoryByAuditItemId.get(apply.sourceAuditItemId) ?? []
    history.push(apply)
    applyHistoryByAuditItemId.set(apply.sourceAuditItemId, history)
  }
  const artworkIds = [
    ...new Set([
      ...visible.flatMap((row) => (row.artworkId ? [row.artworkId] : [])),
      ...latestApplyRows.flatMap((row) => (row.resultArtworkId ? [row.resultArtworkId] : []))
    ])
  ]
  const artworks =
    artworkIds.length === 0
      ? []
      : await database.artwork.findMany({
          where: { id: { in: artworkIds } },
          select: { id: true, title: true }
        })
  const artworkById = new Map(artworks.map((artwork) => [artwork.id, artwork]))

  return sourceAuditItemPageSchema.parse({
    items: visible.map((row) => {
      const classification = sourceAuditClassification(row.differenceKind)
      const applyHistory = applyHistoryByAuditItemId.get(row.id) ?? []
      const applyDecision = decideSourceAuditItemApply(actionForClassification(classification), applyHistory)
      const artworkId = applyHistory.find((item) => item.resultArtworkId)?.resultArtworkId ?? row.artworkId
      const artwork = artworkId ? (artworkById.get(artworkId) ?? null) : null
      const reasonCode = safeReasonCode(row.issueCode)
      const action = actionForClassification(classification)
      return {
        id: row.id,
        classification,
        externalId: row.observedExternalId ?? row.expectedExternalId,
        title: row.title ?? artwork?.title ?? null,
        artistName: row.artistName,
        metadataRelativePath: row.relativePath,
        artwork,
        expectedExternalId: row.expectedExternalId,
        observedExternalId: row.observedExternalId,
        reasonCode,
        reasonSummary: reasonCode ? reasonSummary(reasonCode) : null,
        eligibleAction: action,
        apply: { state: applyDecision.state, action: applyDecision.action },
        latestApplyResult: sourceAuditLatestApplyResult(action, applyDecision.latestResult)
      }
    }),
    nextCursor: hasMore
      ? encodeSourceAuditCursor({
          version: 1,
          auditRunId: parsed.auditRunId,
          classification: parsed.classification ?? null,
          ordinal: visible.at(-1)!.ordinal,
          id: visible.at(-1)!.id
        })
      : null
  })
}

function blockedAvailability(reason: Exclude<SourceAuditAvailability['reason'], null>): SourceAuditAvailability {
  return sourceAuditAvailabilitySchema.parse({ available: false, reason, activeAudit: null })
}

function environmentFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true'
}

export async function inspectSafeScanRoot(configuredRoot: string) {
  const metadata = await fs.lstat(configuredRoot)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Unsafe scan root')
  const resolved = await fs.realpath(configuredRoot)
  const resolvedMetadata = await fs.lstat(resolved)
  if (!resolvedMetadata.isDirectory()) throw new Error('Unsafe scan root')
}

export async function readConfiguredScanRoot(database: SourceAuditDatabase, options: SourceAuditServiceOptions) {
  const value = options.getScanRoot
    ? await options.getScanRoot()
    : (await database.setting.findUnique({ where: { key: 'scanPath' }, select: { value: true } }))?.value
  return value?.trim() || null
}

export async function assertTransactionalReadiness(
  transaction: ReadinessClient,
  now: Date,
  definitionVersion = SCAN_DEFINITION_VERSION
) {
  const inventoryState = await transaction.pixivMetadataInventoryState.findUnique({
    where: { id: 'pixiv' },
    select: { status: true }
  })
  if (inventoryState?.status !== 'READY') {
    throw new SourceAuditServiceError('BLOCKED', 'Pixiv metadata inventory is not ready')
  }
  const workers = await transaction.workerInstance.findMany({
    where: {
      status: 'READY',
      heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) }
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  if (!workers.some((worker) => supportsScanVersion(worker.capabilities, definitionVersion))) {
    throw new SourceAuditServiceError('BLOCKED', `No fresh READY Worker supports SCAN v${definitionVersion}`)
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Invalid source audit root probe timeout')
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Source audit root probe timed out')), timeoutMs)
        timeout.unref?.()
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function supportsScanV2(value: unknown) {
  return supportsScanVersion(value, SCAN_DEFINITION_VERSION)
}

export function supportsScanVersion(value: unknown, definitionVersion: number) {
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    const capability = workerCapabilitySchema.safeParse(entry)
    return (
      capability.success &&
      capability.data.jobType === 'SCAN' &&
      capability.data.executionLane === EXECUTION_LANES.BACKGROUND_WRITER &&
      capability.data.definitionVersions.includes(definitionVersion)
    )
  })
}

async function findActiveScan(database: SourceAuditDatabase) {
  return database.systemJob.findFirst({
    where: { type: 'SCAN', status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
    include: { scanRun: { select: { id: true, operationKind: true } } }
  })
}

function activeAuditReference(job: Awaited<ReturnType<typeof findActiveScan>> | null) {
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status as JobStatus)) return null
  return activeOrHistoricalAuditReference(job)
}

function activeOrHistoricalAuditReference(job: {
  id: string
  status: string
  definitionVersion: number
  payload: unknown
  scanRun: { id: string; operationKind: string | null } | null
}) {
  const payload = scanV2PayloadSchema.safeParse(job.payload)
  if (
    job.definitionVersion !== SCAN_DEFINITION_VERSION ||
    !payload.success ||
    payload.data.mode !== SOURCE_AUDIT_OPERATION ||
    job.scanRun?.operationKind !== SOURCE_AUDIT_OPERATION
  ) {
    return null
  }
  return { auditRunId: job.scanRun.id, jobId: job.id, status: job.status }
}

function availabilityMessage(reason: SourceAuditAvailability['reason']) {
  switch (reason) {
    case 'CUTOVER_DISABLED':
      return 'Central Dispatcher is not enabled'
    case 'DISPATCH_DISABLED':
      return 'Worker dispatch is not enabled'
    case 'SCAN_ROOT_NOT_CONFIGURED':
      return 'Scan root is not configured'
    case 'SCAN_ROOT_UNAVAILABLE':
      return 'Scan root is not safely accessible'
    case 'INVENTORY_NOT_READY':
      return 'Pixiv metadata inventory is not ready'
    case 'WORKER_NOT_READY':
      return 'No fresh READY Worker supports SCAN v2'
    case 'SCAN_BUSY':
      return 'Another scan is already active'
    default:
      return 'Source audit cannot be started'
  }
}

function sourceAuditClassification(value: string): SourceAuditClassification {
  const parsed = SOURCE_AUDIT_CLASSIFICATION_VALUES.find((classification) => classification === value)
  if (!parsed) throw new Error('Unexpected source audit classification')
  return parsed
}

function safeReasonCode(value: string | null) {
  return value && KNOWN_REASON_CODES.has(value) ? value : value ? 'SOURCE_DIFFERENCE' : null
}

function reasonSummary(code: string) {
  switch (code) {
    case 'DUPLICATE_METADATA_IDENTITY':
      return '多个元数据文件声明了同一个 Pixiv 作品标识。'
    case 'IDENTITY_CONFLICT':
      return '元数据中的作品标识与现有来源记录不一致。'
    case 'METADATA_INVALID':
      return '元数据文件无法通过格式校验。'
    case 'METADATA_TOO_LARGE':
      return '元数据文件超过安全读取限制。'
    case 'SOURCE_MISSING':
      return '基线中的元数据文件未出现在本次完整核对中。'
    default:
      return '该来源差异需要人工检查。'
  }
}

function actionForClassification(classification: SourceAuditClassification) {
  return classification === 'NEW' ? ('IMPORT' as const) : classification === 'CHANGED' ? ('SYNC' as const) : null
}

function actionRequiredReason(status: string, errorCode: string | null, pausedEventData: unknown) {
  if (status === 'CANCELLED' || status === 'CANCELLING') return 'CANCELLED'
  if (status === 'COMPLETED' || status === 'SKIPPED') return null
  const decisionCode = status === 'PAUSED' ? readDecisionCode(pausedEventData) : null
  if (decisionCode === 'EMPTY_CONSISTENCY_AUDIT') return 'EMPTY_SOURCE'
  if (decisionCode === 'AUDIT_SAFETY_LIMIT_EXCEEDED' || decisionCode === 'FULL_SWEEP_LIMIT_EXCEEDED') {
    return 'SAFETY_LIMIT_EXCEEDED'
  }
  if (errorCode === 'SOURCE_NOT_FOUND' || errorCode === 'PATH_OUTSIDE_ALLOWED_ROOT') return 'SOURCE_CHANGED'
  if (errorCode === 'PRECONDITION_FAILED') return 'PRECONDITION_FAILED'
  if (status === 'FAILED' || errorCode === 'INTERNAL_ERROR') return 'EXECUTION_FAILED'
  return null
}

function readDecisionCode(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if ('decisionCode' in value && typeof value.decisionCode === 'string') return value.decisionCode
  if (!('data' in value) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) return null
  return 'decisionCode' in value.data && typeof value.data.decisionCode === 'string' ? value.data.decisionCode : null
}

function nonnegative(value: number | null) {
  return Math.max(0, value ?? 0)
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}
