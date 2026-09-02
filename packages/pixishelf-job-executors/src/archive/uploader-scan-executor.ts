import {
  archiveUploaderScanPayloadSchema,
  JOB_DEFINITION_VERSION,
  type ArchiveUploaderScanPayload,
  type JobErrorCode
} from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { toArchiveExecutorError } from './errors.ts'
import { hashArchiveUploaderDiscoveryMetadata } from './providers/e-hentai.ts'
import type {
  ArchiveUploaderGallerySummary,
  ArchiveUploaderProviderRegistry,
  ArchiveUploaderScanResult,
  SourceRelationshipValue
} from './types.ts'

const SCAN_LIMIT = 100
const MAX_RETRY_DELAY_MS = 30_000
const ACTIVE_INTAKE_STATUSES = ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] as const
const ACTIVE_IMPORT_STATUSES = ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] as const

type ScanContext = ExecutionContext<ArchiveUploaderScanPayload, EnqueuedChildJob>
type ScanTransaction = Prisma.TransactionClient & QueueSqlExecutor
type ScanScope = FencedExecutionTransaction<ScanTransaction>
type ScanClassification = 'NEW' | 'ACTIVE' | 'ARCHIVED' | 'POSSIBLE_UPDATE' | 'REPLACEMENT'

interface ClaimedScanRun {
  id: string
  mode: 'LATEST' | 'HISTORY'
  cursorBefore: string | null
  source: {
    id: string
    providerKey: string
    identityKind: 'NAME' | 'UID'
    identityValue: string
    latestSeenExternalId: string | null
    incrementalHeadExternalId: string | null
  }
}

export interface ArchiveUploaderScanExecutorDependencies {
  database: PrismaClient
  providers: ArchiveUploaderProviderRegistry
  now?: () => Date
  random?: () => number
}

export function createArchiveUploaderScanExecutorRegistrations(
  dependencies: ArchiveUploaderScanExecutorDependencies
): ExecutorDefinition<ArchiveUploaderScanPayload>[] {
  return [
    {
      jobType: 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => archiveUploaderScanPayloadSchema.parse(payload),
      execute: (context) => executeArchiveUploaderScan(context, dependencies)
    }
  ]
}

export async function executeArchiveUploaderScan(
  context: ScanContext,
  dependencies: ArchiveUploaderScanExecutorDependencies
): Promise<JobExecutionOutcome> {
  const now = dependencies.now ?? (() => new Date())
  const startedAt = now()
  const run = await context.mutateInTransaction<ScanTransaction, ClaimedScanRun | null>(async (transaction) => {
    const current = await transaction.archiveUploaderScanRun.findUnique({
      where: { id: context.payload.scanRunId },
      include: { source: true }
    })
    if (
      !current ||
      current.systemJobId !== context.job.id ||
      !['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(current.status) ||
      current.source.status !== 'ACTIVE'
    ) {
      return null
    }
    const claimed = await transaction.archiveUploaderScanRun.updateMany({
      where: { id: current.id, systemJobId: context.job.id, status: current.status },
      data: {
        status: 'RUNNING',
        startedAt,
        finishedAt: null,
        errorCode: null,
        errorMessage: null
      }
    })
    if (claimed.count !== 1) return null
    await transaction.archiveUploaderSource.update({
      where: { id: current.sourceId },
      data: { lastScanAt: startedAt, lastRunId: current.id }
    })
    return {
      id: current.id,
      mode: current.mode,
      cursorBefore: current.cursorBefore,
      source: {
        id: current.source.id,
        providerKey: current.source.providerKey,
        identityKind: current.source.identityKind,
        identityValue: current.source.identityValue,
        latestSeenExternalId: current.source.latestSeenExternalId,
        incrementalHeadExternalId: current.source.incrementalHeadExternalId
      }
    }
  })

  if (!run) {
    return context.finalizeInTransaction<ScanTransaction>(async (scope) => {
      if (scope.controlStatus === 'CANCEL_REQUESTED') {
        await markRun(scope.transaction, context.payload.scanRunId, context.job.id, 'CANCELLED', now())
        await scope.cancel('Uploader scan cancelled before provider execution')
        return
      }
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: 'Uploader scan run is no longer executable' })
    })
  }

  try {
    await context.progress({ progress: 5, stage: 'UPLOADER_SEARCH', message: '正在读取上传者公开画廊列表...' })
    const provider = dependencies.providers.getUploaderScanner(run.source.providerKey)
    const result = await provider.scanUploader(
      {
        identityKind: run.source.identityKind,
        identityValue: run.source.identityValue,
        cursor: run.cursorBefore,
        stopAtExternalId: run.mode === 'LATEST' ? run.source.latestSeenExternalId : null,
        limit: SCAN_LIMIT
      },
      { signal: context.signal }
    )
    return context.finalizeInTransaction<ScanTransaction>((scope) => finalizeScan(scope, context, run, result, now()))
  } catch (error) {
    const classified = toArchiveExecutorError(error)
    return context.finalizeInTransaction<ScanTransaction>((scope) =>
      finalizeScanError(scope, context, run, classified, now(), dependencies.random ?? Math.random)
    )
  }
}

async function finalizeScan(
  scope: ScanScope,
  context: ScanContext,
  run: ClaimedScanRun,
  result: ArchiveUploaderScanResult,
  completedAt: Date
) {
  if (scope.controlStatus === 'CANCEL_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'CANCELLED', completedAt)
    await scope.cancel('Uploader scan cancelled')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'PAUSED', completedAt)
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Uploader scan paused' })
    return
  }

  const classifications = await classifyScanItems(scope.transaction, result.items)
  const counts: Record<ScanClassification, number> = {
    NEW: 0,
    ACTIVE: 0,
    ARCHIVED: 0,
    POSSIBLE_UPDATE: 0,
    REPLACEMENT: 0
  }
  await scope.transaction.archiveUploaderScanItem.deleteMany({ where: { runId: run.id } })
  if (result.items.length > 0) {
    await scope.transaction.archiveUploaderScanItem.createMany({
      data: result.items.map((item) => {
        const classification = classifications.get(item.externalId) ?? 'NEW'
        counts[classification] += 1
        return {
          runId: run.id,
          providerKey: item.providerKey,
          externalId: item.externalId,
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          thumbnailUrl: item.thumbnailUrl,
          uploaderName: item.uploaderName,
          postedAt: item.postedAt,
          metadataFingerprint: item.metadataFingerprint,
          relationships: toJsonValue(item.relationships),
          classification
        }
      })
    })
  }

  const runChanged = await scope.transaction.archiveUploaderScanRun.updateMany({
    where: { id: run.id, systemJobId: context.job.id, status: 'RUNNING' },
    data: {
      status: 'COMPLETED',
      cursorAfter: result.nextCursor,
      itemCount: result.items.length,
      newCount: counts.NEW,
      activeCount: counts.ACTIVE,
      archivedCount: counts.ARCHIVED,
      possibleUpdateCount: counts.POSSIBLE_UPDATE,
      replacementCount: counts.REPLACEMENT,
      finishedAt: completedAt,
      errorCode: null,
      errorMessage: null
    }
  })
  if (runChanged.count !== 1) throw new Error('Uploader scan run changed before completion')

  const firstExternalId = result.items[0]?.externalId ?? null
  const sourceData: Prisma.ArchiveUploaderSourceUpdateInput = {
    lastSuccessAt: completedAt,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastRunId: run.id
  }
  if (run.source.identityKind === 'UID' && result.items[0]?.uploaderName) {
    sourceData.displayName = result.items[0].uploaderName
  }
  if (run.mode === 'HISTORY') {
    sourceData.historyCursor = result.nextCursor
  } else if (run.source.latestSeenExternalId === null) {
    sourceData.latestSeenExternalId = firstExternalId
    sourceData.historyCursor = result.nextCursor
    sourceData.incrementalCursor = null
    sourceData.incrementalHeadExternalId = null
  } else if (result.reachedStop || result.nextCursor === null) {
    sourceData.latestSeenExternalId =
      run.source.incrementalHeadExternalId ?? firstExternalId ?? run.source.latestSeenExternalId
    sourceData.incrementalCursor = null
    sourceData.incrementalHeadExternalId = null
  } else {
    sourceData.incrementalCursor = result.nextCursor
    sourceData.incrementalHeadExternalId = run.source.incrementalHeadExternalId ?? firstExternalId
  }
  await scope.transaction.archiveUploaderSource.update({ where: { id: run.source.id }, data: sourceData })
  await scope.complete({
    result: { scanRunId: run.id, itemCount: result.items.length, counts },
    message: `Uploader scan completed with ${result.items.length} galleries`
  })
}

async function classifyScanItems(
  transaction: ScanTransaction,
  items: ArchiveUploaderGallerySummary[]
): Promise<Map<string, ScanClassification>> {
  const externalIds = [...new Set(items.map(({ externalId }) => externalId))]
  const canonicalUrls = [...new Set(items.map(({ canonicalUrl }) => canonicalUrl))]
  const relatedIds = [
    ...new Set(
      items.flatMap(({ relationships }) =>
        relationships.filter(({ providerKey }) => providerKey === 'e-hentai').map(({ externalId }) => externalId)
      )
    )
  ]
  if (externalIds.length === 0) return new Map()
  const [activeIntake, activeImports, references] = await Promise.all([
    transaction.archiveIntakeItem.findMany({
      where: {
        status: { in: [...ACTIVE_INTAKE_STATUSES] },
        OR: [
          { providerKey: 'e-hentai', externalId: { in: externalIds } },
          { submittedUrl: { in: canonicalUrls } },
          { canonicalUrl: { in: canonicalUrls } }
        ]
      },
      select: { externalId: true, submittedUrl: true, canonicalUrl: true }
    }),
    transaction.archiveImport.findMany({
      where: {
        providerKey: 'e-hentai',
        externalId: { in: externalIds },
        status: { in: [...ACTIVE_IMPORT_STATUSES] }
      },
      select: { externalId: true }
    }),
    transaction.artworkExternalRef.findMany({
      where: { providerKey: 'e-hentai', externalId: { in: [...new Set([...externalIds, ...relatedIds])] } },
      select: {
        externalId: true,
        snapshots: { orderBy: { fetchedAt: 'desc' }, take: 1, select: { normalizedMetadata: true } }
      }
    })
  ])
  const activeExternalIds = new Set(
    [...activeIntake, ...activeImports].map(({ externalId }) => externalId).filter((value) => value !== null)
  )
  const activeUrls = new Set(
    activeIntake
      .flatMap(({ submittedUrl, canonicalUrl }) => [submittedUrl, canonicalUrl])
      .filter((value) => value !== null)
  )
  const referencesById = new Map(references.map((reference) => [reference.externalId, reference]))
  const classifications = new Map<string, ScanClassification>()
  for (const item of items) {
    if (activeExternalIds.has(item.externalId) || activeUrls.has(item.canonicalUrl)) {
      classifications.set(item.externalId, 'ACTIVE')
      continue
    }
    const exact = referencesById.get(item.externalId)
    if (exact) {
      const storedFingerprint = hashArchiveUploaderDiscoveryMetadata(exact.snapshots[0]?.normalizedMetadata)
      classifications.set(
        item.externalId,
        storedFingerprint && storedFingerprint !== item.metadataFingerprint ? 'POSSIBLE_UPDATE' : 'ARCHIVED'
      )
      continue
    }
    const replacesExisting = item.relationships.some(
      (relationship) =>
        relationship.direction === 'OUTBOUND' &&
        relationship.providerKey === item.providerKey &&
        referencesById.has(relationship.externalId)
    )
    classifications.set(item.externalId, replacesExisting ? 'REPLACEMENT' : 'NEW')
  }
  return classifications
}

async function finalizeScanError(
  scope: ScanScope,
  context: ScanContext,
  run: ClaimedScanRun,
  error: ReturnType<typeof toArchiveExecutorError>,
  failedAt: Date,
  random: () => number
) {
  if (scope.controlStatus === 'CANCEL_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'CANCELLED', failedAt, error)
    await scope.cancel('Uploader scan cancelled')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'PAUSED', failedAt, error)
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Uploader scan paused' })
    return
  }
  if (context.signal.aborted) {
    await markRun(scope.transaction, run.id, context.job.id, 'PENDING', failedAt, error)
    await scope.release('Worker stopped while scanning uploader')
    return
  }

  const retryable = error.recoverable && context.job.attempt < context.job.maxAttempts
  if (retryable) {
    const availableAt = new Date(failedAt.getTime() + retryDelayMs(context.job.attempt, error.retryAfterMs, random))
    await markRun(scope.transaction, run.id, context.job.id, 'RETRY_WAIT', failedAt, error)
    await scope.retry({
      availableAt,
      errorCode: mapJobErrorCode(error.code),
      error: error.message,
      message: 'Uploader scan retry scheduled'
    })
    return
  }

  await markRun(scope.transaction, run.id, context.job.id, 'FAILED', failedAt, error)
  await scope.fail({
    errorCode: mapJobErrorCode(error.code),
    error: error.message,
    message: 'Uploader scan failed'
  })
}

async function markRun(
  transaction: ScanTransaction,
  runId: string,
  systemJobId: string,
  status: 'PENDING' | 'RETRY_WAIT' | 'PAUSED' | 'FAILED' | 'CANCELLED',
  timestamp: Date,
  error?: { code: string; message: string }
) {
  const changed = await transaction.archiveUploaderScanRun.updateMany({
    where: { id: runId, systemJobId, status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } },
    data: {
      status,
      finishedAt: status === 'FAILED' || status === 'CANCELLED' ? timestamp : null,
      errorCode: error?.code ?? (status === 'CANCELLED' ? 'CANCELLED' : null),
      errorMessage: error?.message ?? null
    }
  })
  if (changed.count !== 1) throw new Error('Uploader scan run changed before job finalization')
  if (error) {
    await transaction.archiveUploaderSource.updateMany({
      where: { runs: { some: { id: runId } } },
      data: { lastErrorCode: error.code, lastErrorMessage: error.message, lastRunId: runId }
    })
  }
}

function retryDelayMs(attempt: number, providerDelay: number | null, random: () => number) {
  if (providerDelay !== null) return Math.max(1_000, providerDelay)
  const exponential = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.max(0, attempt - 1))
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4
  return Math.max(1_000, Math.round(exponential * jitter))
}

function mapJobErrorCode(code: string): JobErrorCode {
  if (code === 'INVALID_URL' || code === 'UNSUPPORTED_PROVIDER' || code === 'SSRF_BLOCKED') {
    return 'PRECONDITION_FAILED'
  }
  if (code === 'REMOTE_NOT_FOUND') return 'SOURCE_NOT_FOUND'
  if (code === 'REMOTE_RATE_LIMITED' || code === 'REMOTE_QUOTA_EXCEEDED') return 'RESOURCE_BUSY'
  return 'INTERNAL_ERROR'
}

function toJsonValue(value: SourceRelationshipValue[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
