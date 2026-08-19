import {
  archiveResolveItemPayloadSchema,
  JOB_DEFINITION_VERSION,
  type ArchiveResolveItemPayload,
  type JobErrorCode
} from '@pixishelf/job-contracts'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { toArchiveExecutorError } from './errors.ts'
import { hashResolvedMetadata } from './providers/e-hentai.ts'
import type { ArchiveProviderRegistry, ResolvedArchive } from './types.ts'

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_RETRY_DELAY_MS = 30_000

type ResolveContext = ExecutionContext<ArchiveResolveItemPayload, EnqueuedChildJob>
type ResolveTransaction = Prisma.TransactionClient & QueueSqlExecutor
type ResolveScope = FencedExecutionTransaction<ResolveTransaction>

export interface ArchiveResolverExecutorDependencies {
  database: PrismaClient
  providers: ArchiveProviderRegistry
  now?: () => Date
  random?: () => number
}

export function createArchiveResolverExecutorRegistrations(
  dependencies: ArchiveResolverExecutorDependencies
): ExecutorDefinition<ArchiveResolveItemPayload>[] {
  return [
    {
      jobType: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => archiveResolveItemPayloadSchema.parse(payload),
      execute: (context) => executeArchiveResolveItem(context, dependencies)
    }
  ]
}

export async function executeArchiveResolveItem(
  context: ResolveContext,
  dependencies: ArchiveResolverExecutorDependencies
): Promise<JobExecutionOutcome> {
  const now = dependencies.now ?? (() => new Date())
  const startedAt = now()
  const item = await context.mutateInTransaction<ResolveTransaction, { submittedUrl: string } | null>(
    async (transaction) => {
      const claimed = await transaction.archiveIntakeItem.updateMany({
        where: {
          id: context.payload.intakeItemId,
          currentSystemJobId: context.job.id,
          status: { in: ['QUEUED', 'RETRY_WAIT', 'RESOLVING'] },
          cancelRequestedAt: null
        },
        data: {
          status: 'RESOLVING',
          attempts: context.job.attempt,
          startedAt,
          finishedAt: null,
          availableAt: startedAt,
          errorCode: null,
          errorMessage: null,
          errorStage: null,
          retryable: null
        }
      })
      if (claimed.count !== 1) return null
      return transaction.archiveIntakeItem.findUniqueOrThrow({
        where: { id: context.payload.intakeItemId },
        select: { submittedUrl: true }
      })
    }
  )

  if (!item) {
    return context.finalizeInTransaction<ResolveTransaction>(async (scope) => {
      if (scope.controlStatus === 'CANCEL_REQUESTED') {
        const cancelled = await scope.transaction.archiveIntakeItem.updateMany({
          where: {
            id: context.payload.intakeItemId,
            currentSystemJobId: context.job.id,
            status: { in: ['QUEUED', 'RESOLVING', 'RETRY_WAIT'] }
          },
          data: { status: 'CANCELLED', finishedAt: now(), retryable: false }
        })
        if (cancelled.count !== 1) throw new Error('Archive intake item changed before cancellation finalization')
        await scope.cancel('Archive resolution cancelled before provider execution')
        return
      }
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: 'Archive intake item is no longer resolvable' })
    })
  }

  try {
    // Provider calls stay outside the database transaction. Only the fenced
    // finalization below mutates queue-owned state, so slow remote I/O cannot
    // hold row locks or commit after a lease has been lost.
    const provider = dependencies.providers.getForUrl(item.submittedUrl)
    const resolved = await provider.resolve(item.submittedUrl, { signal: context.signal })
    const metadataHash = hashResolvedMetadata(resolved.normalizedMetadata)
    return context.finalizeInTransaction<ResolveTransaction>((scope) =>
      finalizeResolved(scope, context, resolved, metadataHash, now())
    )
  } catch (error) {
    const classified = toArchiveExecutorError(error)
    return context.finalizeInTransaction<ResolveTransaction>((scope) =>
      finalizeResolutionError(scope, context, classified, now(), dependencies.random ?? Math.random)
    )
  }
}

async function finalizeResolved(
  scope: ResolveScope,
  context: ResolveContext,
  resolved: ResolvedArchive,
  metadataHash: string,
  resolvedAt: Date
) {
  if (scope.controlStatus === 'CANCEL_REQUESTED') {
    await markCancelled(scope.transaction, context.payload.intakeItemId, context.job.id, resolvedAt)
    await scope.cancel('Archive resolution cancelled')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await moveToRetryTail(scope.transaction, context.payload.intakeItemId, context.job.id, resolvedAt, resolvedAt, {
      errorCode: 'PAUSED',
      errorMessage: 'Archive resolution paused',
      retryable: true
    })
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Archive resolution paused' })
    return
  }

  const [existingReference, activeImport, duplicateItem] = await Promise.all([
    scope.transaction.artworkExternalRef.findUnique({
      where: {
        providerKey_externalId: { providerKey: resolved.providerKey, externalId: resolved.externalId }
      },
      include: { archiveRevisions: { where: { isCurrent: true }, select: { metadataHash: true }, take: 1 } }
    }),
    scope.transaction.archiveImport.findFirst({
      where: {
        providerKey: resolved.providerKey,
        externalId: resolved.externalId,
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
      },
      select: { id: true }
    }),
    scope.transaction.archiveIntakeItem.findFirst({
      where: {
        id: { not: context.payload.intakeItemId },
        providerKey: resolved.providerKey,
        externalId: resolved.externalId,
        status: { in: ['RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] }
      },
      orderBy: { queueOrder: 'asc' },
      select: { id: true }
    })
  ])

  if (duplicateItem) {
    const changed = await scope.transaction.archiveIntakeItem.updateMany({
      where: {
        id: context.payload.intakeItemId,
        currentSystemJobId: context.job.id,
        status: 'RESOLVING'
      },
      data: {
        status: 'DUPLICATE',
        providerKey: resolved.providerKey,
        externalId: resolved.externalId,
        canonicalUrl: resolved.canonicalUrl,
        resolvedTitle: resolved.title,
        thumbnailUrl: resolved.thumbnailUrl,
        pageCount: resolved.media.length,
        resolutionKind: 'DUPLICATE_IDENTITY',
        duplicateOfItemId: duplicateItem.id,
        resolvedAt,
        finishedAt: resolvedAt,
        retryable: false
      }
    })
    if (changed.count !== 1) throw new Error('Archive intake item changed before duplicate finalization')
    await scope.complete({ result: { intakeItemId: context.payload.intakeItemId, status: 'DUPLICATE' } })
    return
  }

  const currentHash = existingReference?.archiveRevisions[0]?.metadataHash
  // The metadata hash makes classification stable across retries: unchanged
  // remote metadata stays UNCHANGED until an explicit enqueue decision is made.
  const resolutionKind = activeImport
    ? 'ACTIVE_TASK'
    : !existingReference
      ? 'NEW'
      : currentHash === metadataHash
        ? 'UNCHANGED'
        : 'UPDATE'
  const expiresAt = new Date(resolvedAt.getTime() + SNAPSHOT_TTL_MS)
  const changed = await scope.transaction.archiveIntakeItem.updateMany({
    where: {
      id: context.payload.intakeItemId,
      currentSystemJobId: context.job.id,
      status: 'RESOLVING',
      cancelRequestedAt: null
    },
    data: {
      status: 'READY',
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      canonicalUrl: resolved.canonicalUrl,
      resolvedTitle: resolved.title,
      thumbnailUrl: resolved.thumbnailUrl,
      pageCount: resolved.media.length,
      resolvedSnapshot: toJsonValue(resolved),
      metadataHash,
      resolutionKind,
      activeArchiveImportId: activeImport?.id ?? null,
      resolvedAt,
      expiresAt,
      finishedAt: resolvedAt,
      retryable: false,
      errorCode: null,
      errorMessage: null,
      errorStage: null
    }
  })
  if (changed.count !== 1) throw new Error('Archive intake item changed before resolution finalization')
  await scope.complete({
    result: { intakeItemId: context.payload.intakeItemId, resolutionKind },
    message: `Archive intake item resolved as ${resolutionKind}`
  })
}

async function finalizeResolutionError(
  scope: ResolveScope,
  context: ResolveContext,
  error: ReturnType<typeof toArchiveExecutorError>,
  failedAt: Date,
  random: () => number
) {
  if (scope.controlStatus === 'CANCEL_REQUESTED') {
    await markCancelled(scope.transaction, context.payload.intakeItemId, context.job.id, failedAt)
    await scope.cancel('Archive resolution cancelled')
    return
  }
  if (scope.controlStatus === 'PAUSE_REQUESTED') {
    await moveToRetryTail(scope.transaction, context.payload.intakeItemId, context.job.id, failedAt, failedAt, {
      errorCode: error.code,
      errorMessage: error.message,
      errorStage: error.stage,
      retryable: true
    })
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Archive resolution paused' })
    return
  }
  if (context.signal.aborted) {
    await moveToRetryTail(scope.transaction, context.payload.intakeItemId, context.job.id, failedAt, failedAt, {
      errorCode: 'WORKER_STOPPED',
      errorMessage: 'Worker stopped while resolving archive metadata',
      retryable: true
    })
    await scope.release('Worker stopped while resolving archive metadata')
    return
  }

  const schedulingYield = error.decisionCode === 'PROVIDER_DOWNLOAD_PRIORITY'
  const retryable = error.recoverable && (schedulingYield || context.job.attempt < context.job.maxAttempts)
  if (retryable) {
    const availableAt = new Date(failedAt.getTime() + retryDelayMs(context.job.attempt, error.retryAfterMs, random))
    await moveToRetryTail(scope.transaction, context.payload.intakeItemId, context.job.id, availableAt, failedAt, {
      errorCode: error.code,
      errorMessage: error.message,
      errorStage: error.stage,
      retryable: true
    })
    await scope.retry({
      availableAt,
      errorCode: mapJobErrorCode(error.code),
      error: error.message,
      message: 'Archive resolution retry scheduled',
      ...(schedulingYield ? { preserveAttempt: true } : {})
    })
    return
  }

  const changed = await scope.transaction.archiveIntakeItem.updateMany({
    where: {
      id: context.payload.intakeItemId,
      currentSystemJobId: context.job.id,
      status: 'RESOLVING'
    },
    data: {
      status: 'FAILED',
      finishedAt: failedAt,
      errorCode: error.code,
      errorMessage: error.message,
      errorStage: error.stage,
      retryable: error.recoverable
    }
  })
  if (changed.count !== 1) throw new Error('Archive intake item changed before failure finalization')
  await scope.fail({
    errorCode: mapJobErrorCode(error.code),
    error: error.message,
    message: 'Archive resolution failed'
  })
}

async function moveToRetryTail(
  transaction: ResolveTransaction,
  intakeItemId: string,
  systemJobId: string,
  availableAt: Date,
  updatedAt: Date,
  error: { errorCode: string; errorMessage: string; errorStage?: string | null; retryable: boolean }
) {
  const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "archive_intake_items"
     SET "status" = 'RETRY_WAIT',
         "queueOrder" = nextval(pg_get_serial_sequence('archive_intake_items', 'queueOrder')),
         "availableAt" = $3,
         "finishedAt" = NULL,
         "errorCode" = $5,
         "errorMessage" = $6,
         "errorStage" = $7,
         "retryable" = $8,
         "updatedAt" = $4
     WHERE "id" = $1
       AND "currentSystemJobId" = $2
       AND "status" IN ('QUEUED', 'RESOLVING')
     RETURNING "id"`,
    intakeItemId,
    systemJobId,
    availableAt,
    updatedAt,
    error.errorCode,
    error.errorMessage,
    error.errorStage ?? null,
    error.retryable
  )
  if (rows.length !== 1) throw new Error('Archive intake item changed before retry finalization')
}

async function markCancelled(
  transaction: ResolveTransaction,
  intakeItemId: string,
  systemJobId: string,
  cancelledAt: Date
) {
  const changed = await transaction.archiveIntakeItem.updateMany({
    where: { id: intakeItemId, currentSystemJobId: systemJobId, status: 'RESOLVING' },
    data: { status: 'CANCELLED', finishedAt: cancelledAt, retryable: false }
  })
  if (changed.count !== 1) throw new Error('Archive intake item changed before cancellation finalization')
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

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
