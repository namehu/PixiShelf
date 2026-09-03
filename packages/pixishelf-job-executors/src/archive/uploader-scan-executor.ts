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
import { compareArchiveUploaderMetadata } from './providers/e-hentai.ts'
import { lockArchiveUploaderCatalogIdentities } from './uploader-catalog-lock.ts'
import type {
  ArchiveUploaderGallerySummary,
  ArchiveUploaderMetadataChangeReason,
  ArchiveUploaderProviderRegistry,
  ArchiveUploaderScanResult
} from './types.ts'

const SCAN_LIMIT = 100
const MAX_RETRY_DELAY_MS = 30_000
const ACTIVE_INTAKE_STATUSES = ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] as const
const ACTIVE_IMPORT_STATUSES = ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] as const
const ACTIVE_INTAKE_STATUS_SET = new Set<string>(ACTIVE_INTAKE_STATUSES)
const ACTIVE_IMPORT_STATUS_SET = new Set<string>(ACTIVE_IMPORT_STATUSES)

type ScanContext = ExecutionContext<ArchiveUploaderScanPayload, EnqueuedChildJob>
type ScanTransaction = Prisma.TransactionClient & QueueSqlExecutor
type ScanScope = FencedExecutionTransaction<ScanTransaction>
type ScanClassification = 'NEW' | 'ACTIVE' | 'ARCHIVED' | 'POSSIBLE_UPDATE' | 'REPLACEMENT'
type CatalogClassification = Exclude<ScanClassification, 'ACTIVE'>

interface ClassifiedScanItem {
  classification: ScanClassification
  catalogClassification: CatalogClassification
  comparisonKnown: boolean
  changeReasons: ArchiveUploaderMetadataChangeReason[]
  latestWorkflow: CatalogWorkflowSnapshot | null
}

interface CatalogWorkflowSnapshot {
  kind: 'INTAKE' | 'IMPORT' | 'REFERENCE' | 'CATALOG'
  id: string
  outcome: 'SUBMITTED' | 'FAILED' | 'CANCELLED' | 'DUPLICATE' | 'ARCHIVED'
  eventAt: Date
  errorCode: string | null
  errorMessage: string | null
}

interface CatalogIntakeWorkflow {
  id: string
  status: string
  externalId: string | null
  submittedUrl: string
  canonicalUrl: string | null
  finishedAt: Date | null
  updatedAt: Date
  createdAt: Date
  errorCode: string | null
  errorMessage: string | null
}

interface CatalogImportWorkflow {
  id: string
  status: string
  externalId: string
  canonicalUrl: string
  finishedAt: Date | null
  updatedAt: Date
  createdAt: Date
  errorCode: string | null
  errorMessage: string | null
}

interface CatalogReferenceWorkflow {
  id: string
  lastSuccessAt: Date | null
  updatedAt: Date
  createdAt: Date
}

interface CatalogDurableWorkflow {
  id: string
  externalId: string
  lastOutcome: CatalogWorkflowSnapshot['outcome']
  lastOutcomeAt: Date
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

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
        stopReason: null,
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
        await scope.cancel('上传者扫描在访问来源站点前已取消')
        return
      }
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '上传者扫描已不再满足执行条件' })
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
    await scope.cancel('上传者扫描已取消')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'PAUSED', completedAt)
    await scope.pause({ reason: 'USER_REQUESTED', message: '上传者扫描已暂停' })
    return
  }

  await lockArchiveUploaderCatalogIdentities(
    scope.transaction,
    result.items.map((item) => ({
      providerKey: item.providerKey,
      externalId: item.externalId,
      canonicalUrls: [item.canonicalUrl]
    }))
  )
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
        const classification = classifications.get(item.externalId)?.classification ?? 'NEW'
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
    for (const item of result.items) {
      const classified = classifications.get(item.externalId) ?? {
        classification: 'NEW' as const,
        catalogClassification: 'NEW' as const,
        comparisonKnown: true,
        changeReasons: [],
        latestWorkflow: null
      }
      const catalogData = {
        canonicalUrl: item.canonicalUrl,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        uploaderName: item.uploaderName,
        postedAt: item.postedAt,
        relationships: toJsonValue(item.relationships),
        // ACTIVE is an observation about the workflow at scan time, not a durable
        // recommendation. The live catalog query derives processing state from the
        // linked Intake/Import while this stable classification survives retention.
        classification: classified.catalogClassification,
        changeReasons: toJsonValue(classified.changeReasons),
        comparisonSnapshot: toJsonValue(item.comparisonSnapshot),
        comparisonFingerprint: item.metadataFingerprint,
        comparisonKnown: classified.comparisonKnown,
        lastSeenAt: completedAt,
        lastScanRunId: run.id
      }
      const workflowData = classified.latestWorkflow ? catalogWorkflowData(classified.latestWorkflow) : {}
      const catalog = await scope.transaction.archiveUploaderCatalogItem.upsert({
        where: {
          sourceId_providerKey_externalId: {
            sourceId: run.source.id,
            providerKey: item.providerKey,
            externalId: item.externalId
          }
        },
        create: {
          sourceId: run.source.id,
          providerKey: item.providerKey,
          externalId: item.externalId,
          ...catalogData,
          ...workflowData,
          firstSeenAt: completedAt
        },
        update: catalogData,
        select: { id: true }
      })
      if (classified.latestWorkflow) {
        await scope.transaction.archiveUploaderCatalogItem.updateMany({
          where: {
            id: catalog.id,
            OR: [{ lastOutcomeAt: null }, { lastOutcomeAt: { lt: classified.latestWorkflow.eventAt } }]
          },
          data: catalogWorkflowData(classified.latestWorkflow)
        })
      }
    }
  }

  const stopReason = result.reachedStop
    ? 'WATERMARK_REACHED'
    : result.nextCursor === null
      ? 'REMOTE_END'
      : 'LIMIT_REACHED'
  const runChanged = await scope.transaction.archiveUploaderScanRun.updateMany({
    where: { id: run.id, systemJobId: context.job.id, status: 'RUNNING' },
    data: {
      status: 'COMPLETED',
      stopReason,
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
  if (runChanged.count !== 1) throw new Error('上传者扫描记录在完成前发生变化')

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
    message: `上传者扫描完成，共发现 ${result.items.length} 个画廊`
  })
}

async function classifyScanItems(
  transaction: ScanTransaction,
  items: ArchiveUploaderGallerySummary[]
): Promise<Map<string, ClassifiedScanItem>> {
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
  const [activeIntake, activeImports, references, durableOutcomes] = await Promise.all([
    transaction.archiveIntakeItem.findMany({
      where: {
        OR: [
          { providerKey: 'e-hentai', externalId: { in: externalIds } },
          { submittedUrl: { in: canonicalUrls } },
          { canonicalUrl: { in: canonicalUrls } }
        ]
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        externalId: true,
        submittedUrl: true,
        canonicalUrl: true,
        finishedAt: true,
        updatedAt: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true
      }
    }),
    transaction.archiveImport.findMany({
      where: {
        providerKey: 'e-hentai',
        externalId: { in: externalIds }
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        externalId: true,
        canonicalUrl: true,
        finishedAt: true,
        updatedAt: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true
      }
    }),
    transaction.artworkExternalRef.findMany({
      where: { providerKey: 'e-hentai', externalId: { in: [...new Set([...externalIds, ...relatedIds])] } },
      select: {
        id: true,
        externalId: true,
        lastSuccessAt: true,
        updatedAt: true,
        createdAt: true,
        snapshots: { orderBy: { fetchedAt: 'desc' }, take: 1, select: { normalizedMetadata: true } }
      }
    }),
    transaction.archiveUploaderCatalogItem.findMany({
      where: {
        providerKey: 'e-hentai',
        externalId: { in: externalIds },
        lastOutcome: { not: null },
        lastOutcomeAt: { not: null }
      },
      orderBy: [{ lastOutcomeAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        externalId: true,
        lastOutcome: true,
        lastOutcomeAt: true,
        lastErrorCode: true,
        lastErrorMessage: true
      }
    })
  ])
  const referencesById = new Map(references.map((reference) => [reference.externalId, reference]))
  const classifications = new Map<string, ClassifiedScanItem>()
  for (const item of items) {
    const matchingIntakes = activeIntake.filter(
      (candidate) =>
        candidate.externalId === item.externalId ||
        candidate.submittedUrl === item.canonicalUrl ||
        candidate.canonicalUrl === item.canonicalUrl
    )
    const matchingImports = activeImports.filter((candidate) => candidate.externalId === item.externalId)
    const exact = referencesById.get(item.externalId)
    const comparison = exact
      ? compareArchiveUploaderMetadata(exact.snapshots[0]?.normalizedMetadata, item.comparisonSnapshot)
      : null
    const catalogClassification: CatalogClassification = exact
      ? comparison && comparison.changeReasons.length > 0
        ? 'POSSIBLE_UPDATE'
        : 'ARCHIVED'
      : item.relationships.some(
            (relationship) =>
              relationship.direction === 'OUTBOUND' &&
              relationship.providerKey === item.providerKey &&
              referencesById.has(relationship.externalId)
          )
        ? 'REPLACEMENT'
        : 'NEW'
    const hasActiveWorkflow =
      matchingIntakes.some((candidate) => ACTIVE_INTAKE_STATUS_SET.has(candidate.status)) ||
      matchingImports.some((candidate) => ACTIVE_IMPORT_STATUS_SET.has(candidate.status))
    const matchingDurableOutcomes = durableOutcomes.filter(
      (candidate): candidate is CatalogDurableWorkflow =>
        candidate.externalId === item.externalId && candidate.lastOutcome !== null && candidate.lastOutcomeAt !== null
    )
    const latestWorkflow = latestCatalogWorkflow(matchingIntakes, matchingImports, exact, matchingDurableOutcomes)
    classifications.set(item.externalId, {
      classification: hasActiveWorkflow ? 'ACTIVE' : catalogClassification,
      catalogClassification,
      comparisonKnown: !exact || comparison !== null,
      changeReasons: comparison?.changeReasons ?? [],
      latestWorkflow
    })
  }
  return classifications
}

function latestCatalogWorkflow(
  intakes: CatalogIntakeWorkflow[],
  imports: CatalogImportWorkflow[],
  reference: CatalogReferenceWorkflow | undefined,
  durableOutcomes: CatalogDurableWorkflow[]
): CatalogWorkflowSnapshot | null {
  const candidates: Array<CatalogWorkflowSnapshot & { priority: number }> = [
    ...intakes.map((intake) => ({
      kind: 'INTAKE' as const,
      id: intake.id,
      outcome:
        intake.status === 'FAILED'
          ? ('FAILED' as const)
          : intake.status === 'CANCELLED'
            ? ('CANCELLED' as const)
            : intake.status === 'DUPLICATE'
              ? ('DUPLICATE' as const)
              : ('SUBMITTED' as const),
      eventAt: intake.finishedAt ?? intake.updatedAt ?? intake.createdAt,
      errorCode: ['FAILED', 'CANCELLED', 'DUPLICATE'].includes(intake.status) ? intake.errorCode : null,
      errorMessage: ['FAILED', 'CANCELLED', 'DUPLICATE'].includes(intake.status) ? intake.errorMessage : null,
      priority: 20
    })),
    ...imports.map((archiveImport) => ({
      kind: 'IMPORT' as const,
      id: archiveImport.id,
      outcome:
        archiveImport.status === 'COMPLETED'
          ? ('ARCHIVED' as const)
          : archiveImport.status === 'FAILED'
            ? ('FAILED' as const)
            : archiveImport.status === 'CANCELLED'
              ? ('CANCELLED' as const)
              : ('SUBMITTED' as const),
      eventAt: archiveImport.finishedAt ?? archiveImport.updatedAt ?? archiveImport.createdAt,
      errorCode: ['FAILED', 'CANCELLED'].includes(archiveImport.status) ? archiveImport.errorCode : null,
      errorMessage: ['FAILED', 'CANCELLED'].includes(archiveImport.status) ? archiveImport.errorMessage : null,
      priority: 30
    })),
    ...(reference
      ? [
          {
            kind: 'REFERENCE' as const,
            id: reference.id,
            outcome: 'ARCHIVED' as const,
            eventAt: reference.lastSuccessAt ?? reference.updatedAt ?? reference.createdAt,
            errorCode: null,
            errorMessage: null,
            priority: 10
          }
        ]
      : []),
    ...durableOutcomes.map((catalog) => ({
      kind: 'CATALOG' as const,
      id: catalog.id,
      outcome: catalog.lastOutcome,
      eventAt: catalog.lastOutcomeAt,
      errorCode: catalog.lastErrorCode,
      errorMessage: catalog.lastErrorMessage,
      priority: 5
    }))
  ]
  candidates.sort(
    (left, right) =>
      right.eventAt.getTime() - left.eventAt.getTime() ||
      right.priority - left.priority ||
      right.id.localeCompare(left.id)
  )
  return candidates[0] ?? null
}

function catalogWorkflowData(workflow: CatalogWorkflowSnapshot) {
  return {
    ...(workflow.kind === 'INTAKE' ? { lastIntakeItemId: workflow.id } : {}),
    ...(workflow.kind === 'IMPORT' ? { lastArchiveImportId: workflow.id } : {}),
    lastOutcome: workflow.outcome,
    lastOutcomeAt: workflow.eventAt,
    lastErrorCode: workflow.errorCode,
    lastErrorMessage: workflow.errorMessage
  }
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
    await scope.cancel('上传者扫描已取消')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await markRun(scope.transaction, run.id, context.job.id, 'PAUSED', failedAt, error)
    await scope.pause({ reason: 'USER_REQUESTED', message: '上传者扫描已暂停' })
    return
  }
  if (context.signal.aborted) {
    await markRun(scope.transaction, run.id, context.job.id, 'PENDING', failedAt, error)
    await scope.release('后台任务进程在扫描上传者时停止')
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
      message: '上传者扫描已安排重试'
    })
    return
  }

  await markRun(scope.transaction, run.id, context.job.id, 'FAILED', failedAt, error)
  await scope.fail({
    errorCode: mapJobErrorCode(error.code),
    error: error.message,
    message: '上传者扫描失败'
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
      stopReason: null,
      finishedAt: status === 'FAILED' || status === 'CANCELLED' ? timestamp : null,
      errorCode: error?.code ?? (status === 'CANCELLED' ? 'CANCELLED' : null),
      errorMessage: error?.message ?? null
    }
  })
  if (changed.count !== 1) throw new Error('上传者扫描记录在任务完成前发生变化')
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

function toJsonValue(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
