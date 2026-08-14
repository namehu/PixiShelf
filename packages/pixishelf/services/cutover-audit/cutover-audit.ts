import {
  ArchiveImportItemStatus,
  ArchiveImportStatus,
  ArchiveLifecycleState,
  ChapterPreviewStatus,
  JobStatus,
  MediaProbeStatus,
  PendingReplaceBatchStatus,
  PendingReplaceItemStatus,
  ScanRunStatus,
  VideoKeyframeSetStatus,
  VideoKeyframeStatus,
  VideoPosterStatus
} from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'

export const CUTOVER_AUDIT_SCHEMA_VERSION = 1
export const DEFAULT_CUTOVER_AUDIT_SAMPLE_LIMIT = 20
export const MIN_CUTOVER_AUDIT_SAMPLE_LIMIT = 1
export const MAX_CUTOVER_AUDIT_SAMPLE_LIMIT = 100

const SYSTEM_JOB_BLOCKING_STATUSES = [
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.PAUSING,
  JobStatus.PAUSED,
  JobStatus.CANCELLING
] as const

const TERMINAL_SYSTEM_JOB_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED] as const

const ARCHIVE_IMPORT_BLOCKING_STATUSES = [
  ArchiveImportStatus.PENDING,
  ArchiveImportStatus.RUNNING,
  ArchiveImportStatus.PAUSED,
  ArchiveImportStatus.CANCELLING
] as const

const PENDING_REPLACE_ITEM_BLOCKING_STATUSES = [
  PendingReplaceItemStatus.STAGING,
  PendingReplaceItemStatus.BACKING_UP,
  PendingReplaceItemStatus.SWAPPING,
  PendingReplaceItemStatus.COMMITTING,
  PendingReplaceItemStatus.ROLLING_BACK,
  PendingReplaceItemStatus.RESTORING,
  PendingReplaceItemStatus.RESTORE_SWAPPING
] as const

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface CutoverAuditCheck {
  key: string
  model: string
  field: string
  blockingValues: string[]
  count: number
  samples: Array<Record<string, JsonValue>>
}

export interface CutoverAuditReport {
  schemaVersion: number
  generatedAt: string
  passed: boolean
  totalBlockers: number
  checks: CutoverAuditCheck[]
}

export interface RawCutoverAuditCheck {
  key: string
  model: string
  field: string
  blockingValues: readonly string[]
  count: number
  samples: readonly unknown[]
}

export interface CutoverAuditReader {
  readChecks(sampleLimit: number): Promise<readonly RawCutoverAuditCheck[]>
}

export type CutoverAuditPrismaClient = Pick<PrismaClient, '$transaction'>

type CutoverAuditPrismaTransaction = Pick<
  Prisma.TransactionClient,
  | 'systemJob'
  | 'archiveImport'
  | 'archiveImportItem'
  | 'scanRun'
  | 'pendingReplaceBatch'
  | 'pendingReplaceItem'
  | 'mediaVideoMetadata'
  | 'mediaChapterPreview'
  | 'mediaVideoKeyframe'
  | 'mediaVideoKeyframeSet'
  | 'artwork'
>

interface ReadCheckInput {
  key: string
  model: string
  field: string
  blockingValues: readonly string[]
  count: () => Promise<number>
  samples: () => Promise<readonly unknown[]>
}

async function readCheck(input: ReadCheckInput): Promise<RawCutoverAuditCheck> {
  const [count, samples] = await Promise.all([input.count(), input.samples()])
  return {
    key: input.key,
    model: input.model,
    field: input.field,
    blockingValues: input.blockingValues,
    count,
    samples
  }
}

export function createPrismaCutoverAuditReader(client: CutoverAuditPrismaClient): CutoverAuditReader {
  return {
    readChecks: (sampleLimit) =>
      client.$transaction((transaction) => readChecksInSnapshot(transaction, sampleLimit), {
        isolationLevel: 'RepeatableRead'
      })
  }
}

async function readChecksInSnapshot(
  client: CutoverAuditPrismaTransaction,
  sampleLimit: number
): Promise<readonly RawCutoverAuditCheck[]> {
  const unsafeStagingSetWhere = {
    status: VideoKeyframeSetStatus.STAGING,
    OR: [
      { systemJobId: null },
      {
        systemJob: {
          is: {
            status: { notIn: [...TERMINAL_SYSTEM_JOB_STATUSES] }
          }
        }
      }
    ]
  }

  return Promise.all([
    readCheck({
      key: 'system-job-status',
      model: 'SystemJob',
      field: 'status',
      blockingValues: SYSTEM_JOB_BLOCKING_STATUSES,
      count: () => client.systemJob.count({ where: { status: { in: [...SYSTEM_JOB_BLOCKING_STATUSES] } } }),
      samples: () =>
        client.systemJob.findMany({
          where: { status: { in: [...SYSTEM_JOB_BLOCKING_STATUSES] } },
          select: {
            id: true,
            type: true,
            status: true,
            targetImageId: true,
            targetPath: true,
            createdAt: true,
            startedAt: true,
            heartbeatAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'archive-import-status',
      model: 'ArchiveImport',
      field: 'status',
      blockingValues: ARCHIVE_IMPORT_BLOCKING_STATUSES,
      count: () => client.archiveImport.count({ where: { status: { in: [...ARCHIVE_IMPORT_BLOCKING_STATUSES] } } }),
      samples: () =>
        client.archiveImport.findMany({
          where: { status: { in: [...ARCHIVE_IMPORT_BLOCKING_STATUSES] } },
          select: {
            id: true,
            systemJobId: true,
            status: true,
            stagingPath: true,
            providerKey: true,
            externalId: true,
            createdAt: true,
            startedAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'archive-import-item-status',
      model: 'ArchiveImportItem',
      field: 'status',
      blockingValues: [ArchiveImportItemStatus.DOWNLOADING],
      count: () => client.archiveImportItem.count({ where: { status: ArchiveImportItemStatus.DOWNLOADING } }),
      samples: () =>
        client.archiveImportItem.findMany({
          where: { status: ArchiveImportItemStatus.DOWNLOADING },
          select: {
            id: true,
            archiveImportId: true,
            pageIndex: true,
            status: true,
            stagedPath: true,
            expectedFilename: true,
            byteCount: true,
            startedAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'scan-run-status',
      model: 'ScanRun',
      field: 'status',
      blockingValues: [ScanRunStatus.RUNNING],
      count: () => client.scanRun.count({ where: { status: ScanRunStatus.RUNNING } }),
      samples: () =>
        client.scanRun.findMany({
          where: { status: ScanRunStatus.RUNNING },
          select: {
            id: true,
            systemJobId: true,
            type: true,
            mode: true,
            status: true,
            startedAt: true,
            logRef: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'pending-replace-batch-status',
      model: 'PendingReplaceBatch',
      field: 'status',
      blockingValues: [PendingReplaceBatchStatus.RUNNING, PendingReplaceBatchStatus.CANCELLING],
      count: () =>
        client.pendingReplaceBatch.count({
          where: { status: { in: [PendingReplaceBatchStatus.RUNNING, PendingReplaceBatchStatus.CANCELLING] } }
        }),
      samples: () =>
        client.pendingReplaceBatch.findMany({
          where: { status: { in: [PendingReplaceBatchStatus.RUNNING, PendingReplaceBatchStatus.CANCELLING] } },
          select: {
            id: true,
            systemJobId: true,
            status: true,
            sourceRoot: true,
            backupBytes: true,
            startedAt: true,
            createdAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'pending-replace-item-status',
      model: 'PendingReplaceItem',
      field: 'status',
      blockingValues: PENDING_REPLACE_ITEM_BLOCKING_STATUSES,
      count: () =>
        client.pendingReplaceItem.count({
          where: { status: { in: [...PENDING_REPLACE_ITEM_BLOCKING_STATUSES] } }
        }),
      samples: () =>
        client.pendingReplaceItem.findMany({
          where: { status: { in: [...PENDING_REPLACE_ITEM_BLOCKING_STATUSES] } },
          select: {
            id: true,
            batchId: true,
            artworkId: true,
            status: true,
            sourceDirectory: true,
            targetDirectory: true,
            backupDirectory: true,
            startedAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'media-video-probe-status',
      model: 'MediaVideoMetadata',
      field: 'probeStatus',
      blockingValues: [MediaProbeStatus.PROBING],
      count: () => client.mediaVideoMetadata.count({ where: { probeStatus: MediaProbeStatus.PROBING } }),
      samples: () =>
        client.mediaVideoMetadata.findMany({
          where: { probeStatus: MediaProbeStatus.PROBING },
          select: {
            imageId: true,
            probeStatus: true,
            probeUpdatedAt: true,
            image: { select: { path: true, artworkId: true } }
          },
          orderBy: { imageId: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'media-video-poster-status',
      model: 'MediaVideoMetadata',
      field: 'posterStatus',
      blockingValues: [VideoPosterStatus.GENERATING],
      count: () => client.mediaVideoMetadata.count({ where: { posterStatus: VideoPosterStatus.GENERATING } }),
      samples: () =>
        client.mediaVideoMetadata.findMany({
          where: { posterStatus: VideoPosterStatus.GENERATING },
          select: {
            imageId: true,
            posterStatus: true,
            posterPath: true,
            posterUpdatedAt: true,
            image: { select: { path: true, artworkId: true } }
          },
          orderBy: { imageId: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'media-chapter-preview-status',
      model: 'MediaChapterPreview',
      field: 'status',
      blockingValues: [ChapterPreviewStatus.GENERATING],
      count: () => client.mediaChapterPreview.count({ where: { status: ChapterPreviewStatus.GENERATING } }),
      samples: () =>
        client.mediaChapterPreview.findMany({
          where: { status: ChapterPreviewStatus.GENERATING },
          select: {
            id: true,
            imageId: true,
            chapterOrder: true,
            status: true,
            previewPath: true,
            previewUpdatedAt: true,
            image: { select: { path: true, artworkId: true } }
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'media-video-keyframe-status',
      model: 'MediaVideoKeyframe',
      field: 'status',
      blockingValues: [VideoKeyframeStatus.GENERATING],
      count: () => client.mediaVideoKeyframe.count({ where: { status: VideoKeyframeStatus.GENERATING } }),
      samples: () =>
        client.mediaVideoKeyframe.findMany({
          where: { status: VideoKeyframeStatus.GENERATING },
          select: {
            id: true,
            setId: true,
            candidateIndex: true,
            status: true,
            path: true,
            updatedAt: true,
            set: { select: { systemJobId: true, image: { select: { path: true, artworkId: true } } } }
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'media-video-keyframe-set-staging',
      model: 'MediaVideoKeyframeSet',
      field: 'status/systemJob.status',
      blockingValues: ['STAGING_WITHOUT_TERMINAL_SYSTEM_JOB'],
      count: () => client.mediaVideoKeyframeSet.count({ where: unsafeStagingSetWhere }),
      samples: () =>
        client.mediaVideoKeyframeSet.findMany({
          where: unsafeStagingSetWhere,
          select: {
            id: true,
            imageId: true,
            systemJobId: true,
            status: true,
            sourceSize: true,
            sourceMtimeMs: true,
            updatedAt: true,
            systemJob: { select: { id: true, type: true, status: true } },
            image: { select: { path: true, artworkId: true } }
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    }),
    readCheck({
      key: 'artwork-archive-lifecycle-state',
      model: 'Artwork',
      field: 'archiveLifecycleState',
      blockingValues: [ArchiveLifecycleState.TRASHING, ArchiveLifecycleState.RESTORING],
      count: () =>
        client.artwork.count({
          where: {
            archiveLifecycleState: { in: [ArchiveLifecycleState.TRASHING, ArchiveLifecycleState.RESTORING] }
          }
        }),
      samples: () =>
        client.artwork.findMany({
          where: {
            archiveLifecycleState: { in: [ArchiveLifecycleState.TRASHING, ArchiveLifecycleState.RESTORING] }
          },
          select: {
            id: true,
            externalId: true,
            archiveLifecycleState: true,
            storagePath: true,
            metaSource: true,
            updatedAt: true
          },
          orderBy: { id: 'asc' },
          take: sampleLimit
        })
    })
  ])
}

function toJsonValue(value: unknown, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
    if (ancestors.has(value)) return '[Circular]'

    ancestors.add(value)
    const normalized = Array.isArray(value)
      ? value.map((item) => toJsonValue(item, ancestors))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item, ancestors)]))
    ancestors.delete(value)
    return normalized
  }
  return String(value)
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  const normalized = toJsonValue(value)
  return normalized !== null && !Array.isArray(normalized) && typeof normalized === 'object'
    ? normalized
    : { value: normalized }
}

export function validateCutoverAuditSampleLimit(sampleLimit: number): number {
  if (
    !Number.isSafeInteger(sampleLimit) ||
    sampleLimit < MIN_CUTOVER_AUDIT_SAMPLE_LIMIT ||
    sampleLimit > MAX_CUTOVER_AUDIT_SAMPLE_LIMIT
  ) {
    throw new Error(
      `Sample limit must be an integer between ${MIN_CUTOVER_AUDIT_SAMPLE_LIMIT} and ${MAX_CUTOVER_AUDIT_SAMPLE_LIMIT}.`
    )
  }
  return sampleLimit
}

export function parseCutoverAuditArguments(args: readonly string[]): { sampleLimit: number } {
  if (args.length === 0) return { sampleLimit: DEFAULT_CUTOVER_AUDIT_SAMPLE_LIMIT }
  if (args.length !== 2 || args[0] !== '--sample-limit') {
    throw new Error('Usage: background-task:cutover-audit [--sample-limit N]')
  }
  if (!/^\d+$/.test(args[1] ?? '')) {
    throw new Error('The --sample-limit value must be an integer between 1 and 100.')
  }
  return { sampleLimit: validateCutoverAuditSampleLimit(Number(args[1])) }
}

export async function runCutoverAudit(
  reader: CutoverAuditReader,
  options: { sampleLimit?: number; now?: () => Date } = {}
): Promise<CutoverAuditReport> {
  const sampleLimit = validateCutoverAuditSampleLimit(options.sampleLimit ?? DEFAULT_CUTOVER_AUDIT_SAMPLE_LIMIT)
  const rawChecks = await reader.readChecks(sampleLimit)
  const checks = rawChecks.map<CutoverAuditCheck>((check) => ({
    key: check.key,
    model: check.model,
    field: check.field,
    blockingValues: [...check.blockingValues],
    count: check.count,
    samples: check.samples.slice(0, sampleLimit).map(toJsonRecord)
  }))
  const totalBlockers = checks.reduce((total, check) => total + check.count, 0)

  return {
    schemaVersion: CUTOVER_AUDIT_SCHEMA_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    passed: totalBlockers === 0,
    totalBlockers,
    checks
  }
}

export function getCutoverAuditExitCode(report: Pick<CutoverAuditReport, 'passed'>): 0 | 2 {
  return report.passed ? 0 : 2
}

export function serializeCutoverAuditReport(report: CutoverAuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
