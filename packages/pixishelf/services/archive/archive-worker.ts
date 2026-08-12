import { setTimeout as delay } from 'node:timers/promises'
import { rename, rm } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { ArchiveError, toArchiveError, withArchiveErrorContext } from './errors'
import {
  archiveModule,
  ARCHIVE_IMPORT_JOB_TYPE,
  FAILED_STAGING_RETENTION_MS,
  PARTIAL_FAILED_STAGING_RETENTION_MS
} from './archive-module'
import {
  ARCHIVE_PUBLISH_ADVISORY_LOCK_ID,
  publishArchiveImport,
  purgeExpiredArchiveTrash,
  reconcilePendingArchiveCleanups,
  reconcilePendingArchiveLifecycles,
  requestExpiredArchiveCleanups
} from './publisher'
import {
  prepareStagingDirectory,
  buildArchiveStoragePaths,
  pathExists,
  storeRemoteMedia,
  validateStoredMedia,
  writeManifest
} from './storage'
import type { ResolvedMedia } from './types'
import { requireArchiveStorageRoot } from './config'
import type { ArchiveTransactionClient } from './relationships'
import { classifyArchiveFailure, runConcurrentArchiveRound, selectPrimaryWorkerError } from './worker-control'

const ARCHIVE_QUEUE_ADVISORY_LOCK_ID = 7_341_902_118
const HEARTBEAT_INTERVAL_MS = 30_000
const CONTROL_POLL_INTERVAL_MS = 2_000
const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000
const STALE_RECOVERY_INTERVAL_MS = 30_000
const LIFECYCLE_RECONCILE_INTERVAL_MS = 30_000
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const MEDIA_CONCURRENCY = 2
const MAX_MEDIA_ATTEMPTS = 3

interface ArchiveWorkItem {
  id: string
  pageIndex: number
  sourcePageUrl: string
  locator: unknown
  expectedFilename: string
  attempts: number
}

type ArchiveItemAttemptResult =
  | { kind: 'COMPLETED' }
  | { kind: 'RETRY'; item: ArchiveWorkItem }
  | { kind: 'FAILED' }

let lastMaintenanceAt = 0
let lastStaleRecoveryAt = 0

export async function runArchiveWorkerLoop(options: { signal?: AbortSignal; pollIntervalMs?: number } = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  await recoverStaleArchiveImports()
  lastStaleRecoveryAt = Date.now()
  const scanRoot = await requireArchiveStorageRoot()
  await reconcileArchiveMaintenance(scanRoot)
  let activeReconciliation: Promise<void> | null = null
  const triggerReconciliation = () => {
    if (activeReconciliation) return
    activeReconciliation = reconcileArchiveMaintenance(scanRoot)
      .catch((error) => {
        logger.error('Archive lifecycle reconciliation failed', { error })
      })
      .finally(() => {
        activeReconciliation = null
      })
  }
  const reconciliationTimer = setInterval(triggerReconciliation, LIFECYCLE_RECONCILE_INTERVAL_MS)
  reconciliationTimer.unref()
  try {
    while (!options.signal?.aborted) {
      const processed = await processNextArchiveImport(options.signal)
      if (!processed) await delay(pollIntervalMs, undefined, { signal: options.signal }).catch(() => undefined)
    }
  } finally {
    clearInterval(reconciliationTimer)
    await activeReconciliation
  }
}

export async function processNextArchiveImport(signal?: AbortSignal): Promise<boolean> {
  await maybeRecoverStaleArchiveImports()
  await maintainArchiveQueue()
  if (signal?.aborted) return false
  const claimed = await claimNextArchiveImport()
  if (!claimed) return false
  await processClaimedArchiveImport(claimed.id, claimed.systemJob.attempt, signal)
  return true
}

export async function processClaimedArchiveImport(
  importId: string,
  leaseAttempt: number,
  shutdownSignal?: AbortSignal
): Promise<void> {
  const archiveImport = await prisma.archiveImport.findUnique({
    where: { id: importId },
    include: { items: { orderBy: { pageIndex: 'asc' } }, systemJob: true }
  })
  if (!archiveImport || archiveImport.systemJob.attempt !== leaseAttempt || archiveImport.status !== 'RUNNING') {
    throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
  }
  const controller = new AbortController()
  let rootError: ArchiveError | null = null
  const abortWith = (error: unknown) => {
    rootError ??= toArchiveError(error)
    if (!controller.signal.aborted) controller.abort(rootError)
  }
  const onShutdown = () => {
    abortWith(new ArchiveError('WORKER_STOPPED', '归档 Worker 正在停止，任务将自动续传', { recoverable: true }))
  }
  if (shutdownSignal?.aborted) onShutdown()
  else shutdownSignal?.addEventListener('abort', onShutdown, { once: true })
  const heartbeat = setInterval(() => {
    void touchLease(archiveImport.systemJobId, leaseAttempt).catch((error) => {
      logger.warn('Archive worker heartbeat failed', { error, importId })
      abortWith(error)
    })
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  const controlPoll = setInterval(() => {
    void prisma.systemJob
      .findUnique({ where: { id: archiveImport.systemJobId }, select: { status: true, attempt: true } })
      .then((job) => {
        if (!job || job.attempt !== leaseAttempt) {
          abortWith(new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效'))
        } else if (job.status === 'CANCELLING') {
          abortWith(new ArchiveError('CANCELLED', '任务正在取消', { recoverable: true }))
        } else if (job.status === 'PAUSED') {
          abortWith(new ArchiveError('PAUSED', '任务已暂停', { recoverable: true, pause: true }))
        }
      })
      .catch((error) => abortWith(error))
  }, CONTROL_POLL_INTERVAL_MS)
  controlPoll.unref()

  try {
    throwIfWorkerAborted(controller.signal, rootError)
    const scanRoot = await requireArchiveStorageRoot()
    const storagePaths = buildArchiveStoragePaths({
      scanRoot,
      importId,
      providerKey: archiveImport.providerKey,
      creatorBucket: archiveImport.creatorBucket,
      externalId: archiveImport.externalId
    })
    const stagingDirectory = (await pathExists(storagePaths.finalAbsolutePath))
      ? storagePaths.finalAbsolutePath
      : await prepareStagingDirectory(scanRoot, archiveImport.stagingPath)
    const provider = archiveModule.getProvider(archiveImport.providerKey)
    await touchLease(archiveImport.systemJobId, leaseAttempt)
    await syncArchiveItemCounts(importId, archiveImport.systemJobId, leaseAttempt)
    let roundItems: ArchiveWorkItem[] = archiveImport.items
      .filter((item) => item.status === 'PENDING')
      .map((item) => ({
        id: item.id,
        pageIndex: item.pageIndex,
        sourcePageUrl: item.sourcePageUrl,
        locator: item.locator,
        expectedFilename: item.expectedFilename,
        attempts: item.attempts
      }))
    let round = 1

    while (roundItems.length > 0 && round <= MAX_MEDIA_ATTEMPTS) {
      const retryItems: ArchiveWorkItem[] = []
      const roundResult = await runConcurrentArchiveRound(
        roundItems,
        MEDIA_CONCURRENCY,
        async (item) => {
          throwIfWorkerAborted(controller.signal, rootError)
          await assertRunningLease(archiveImport.systemJobId, leaseAttempt)
          return downloadItemAttempt({
            importId,
            jobId: archiveImport.systemJobId,
            leaseAttempt,
            item,
            provider,
            selectedQuality: archiveImport.selectedQuality,
            stagingDirectory,
            signal: controller.signal,
            totalItems: archiveImport.totalItems
          })
        },
        abortWith
      )
      for (const result of roundResult.results) {
        if (result.kind === 'RETRY') retryItems.push(result.item)
      }
      const primaryWorkerError = selectPrimaryWorkerError(rootError, roundResult.rejectedReasons)
      if (primaryWorkerError) throw primaryWorkerError

      const counts = await syncArchiveItemCounts(importId, archiveImport.systemJobId, leaseAttempt)
      const retryMessage = retryItems.length > 0 ? `，${retryItems.length} 张等待下一轮` : ''
      await updateLeaseProgress(
        archiveImport.systemJobId,
        leaseAttempt,
        archiveProgress(counts.completed, archiveImport.totalItems),
        `第 ${round}/${MAX_MEDIA_ATTEMPTS} 轮完成：已下载 ${counts.completed}/${archiveImport.totalItems}${retryMessage}`
      )

      if (retryItems.length === 0 || round >= MAX_MEDIA_ATTEMPTS) break
      await delay(backoffWithJitter(round), undefined, { signal: controller.signal }).catch(() => undefined)
      throwIfWorkerAborted(controller.signal, rootError)
      roundItems = retryItems.sort((left, right) => left.pageIndex - right.pageIndex)
      round += 1
    }

    await assertRunningLease(archiveImport.systemJobId, leaseAttempt)
    const finalCounts = await syncArchiveItemCounts(importId, archiveImport.systemJobId, leaseAttempt)
    if (finalCounts.failed > 0) {
      await finalizePartialFailure({
        importId,
        jobId: archiveImport.systemJobId,
        leaseAttempt,
        completed: finalCounts.completed,
        failed: finalCounts.failed,
        total: archiveImport.totalItems
      })
      return
    }
    if (finalCounts.pending > 0 || finalCounts.downloading > 0) {
      throw new ArchiveError('MEDIA_INVALID', '归档媒体检查点仍有未处理项目', { recoverable: true })
    }

    const completed = await prisma.archiveImportItem.findMany({
      where: { archiveImportId: importId },
      orderBy: { pageIndex: 'asc' }
    })
    if (completed.length !== archiveImport.totalItems || completed.some((item) => item.status !== 'COMPLETED')) {
      throw new ArchiveError('MEDIA_INVALID', '归档媒体检查点不完整', { recoverable: true })
    }
    await validateStoredMedia(stagingDirectory, completed)
    throwIfWorkerAborted(controller.signal, rootError)
    await writeManifest(stagingDirectory, {
      manifestVersion: 1,
      revisionId: importId,
      provider: {
        key: archiveImport.providerKey,
        externalId: archiveImport.externalId,
        canonicalUrl: archiveImport.canonicalUrl,
        locator: archiveImport.locator
      },
      creatorBucket: archiveImport.creatorBucket,
      requestedQuality: archiveImport.requestedQuality,
      selectedQuality: archiveImport.selectedQuality,
      sourceSnapshot: {
        metadataHash: archiveImport.metadataHash,
        normalized: archiveImport.normalizedMetadata,
        raw: archiveImport.rawMetadata
      },
      relationships: relationshipValues(archiveImport.normalizedMetadata),
      media: completed.map((item) => ({
        index: item.pageIndex,
        path: item.stagedPath,
        originalFilename: item.expectedFilename,
        sourcePageUrl: item.sourcePageUrl,
        sourcePageLocator: item.locator,
        quality: item.quality,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        bytes: item.byteCount?.toString() ?? null,
        sha256: item.sha256
      })),
      createdAt: new Date().toISOString()
    })
    throwIfWorkerAborted(controller.signal, rootError)
    await publishArchiveImport(importId, scanRoot, leaseAttempt)
  } catch (error) {
    abortWith(error)
    try {
      await finalizeFailure(importId, archiveImport.systemJobId, leaseAttempt, rootError ?? error)
    } catch (finalizeError) {
      const classified = toArchiveError(finalizeError)
      if (!['LEASE_LOST', 'STATE_CONFLICT'].includes(classified.code)) throw finalizeError
      logger.info('Archive failure finalization skipped because task ownership changed', {
        importId,
        code: classified.code
      })
    }
  } finally {
    clearInterval(heartbeat)
    clearInterval(controlPoll)
    shutdownSignal?.removeEventListener('abort', onShutdown)
  }
}

async function downloadItemAttempt(input: {
  importId: string
  jobId: string
  leaseAttempt: number
  item: ArchiveWorkItem
  provider: ReturnType<typeof archiveModule.getProvider>
  selectedQuality: 'ORIGINAL' | 'DISPLAY'
  stagingDirectory: string
  signal: AbortSignal
  totalItems: number
}): Promise<ArchiveItemAttemptResult> {
  if (input.signal.aborted) throw toArchiveError(input.signal.reason)
  const attempt = input.item.attempts + 1
  let itemCompleted = false
  await withRunningLeaseTransaction(input.jobId, input.importId, input.leaseAttempt, async (tx) => {
    const claimed = await tx.archiveImportItem.updateMany({
      where: {
        id: input.item.id,
        archiveImportId: input.importId,
        status: 'PENDING',
        attempts: input.item.attempts
      },
      data: {
        status: 'DOWNLOADING',
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        errorStage: null,
        remoteHost: null
      }
    })
    if (claimed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '图片下载状态已改变', { recoverable: true })
  })

  try {
    const remote = await input.provider.openMedia(
      {
        index: input.item.pageIndex,
        sourcePageUrl: input.item.sourcePageUrl,
        locator: input.item.locator as Record<string, unknown>,
        expectedFilename: input.item.expectedFilename
      } satisfies ResolvedMedia,
      { quality: input.selectedQuality, signal: input.signal }
    )
    const stored = await storeRemoteMedia({
      remote,
      stagingDirectory: input.stagingDirectory,
      index: input.item.pageIndex,
      expectedFilename: input.item.expectedFilename,
      signal: input.signal,
      partialKey: `lease-${input.leaseAttempt}`,
      commitFile: async ({ partial, target }) => {
        await withRunningLeaseTransaction(input.jobId, input.importId, input.leaseAttempt, async () => {
          try {
            await rm(target, { force: true })
            await rename(partial, target)
          } catch (error) {
            throw withArchiveErrorContext(error, { stage: 'STORAGE' })
          }
        })
      }
    })
    const task = await withRunningLeaseTransaction(
      input.jobId,
      input.importId,
      input.leaseAttempt,
      async (tx) => {
        const completed = await tx.archiveImportItem.updateMany({
          where: { id: input.item.id, archiveImportId: input.importId, status: 'DOWNLOADING', attempts: attempt },
          data: {
            status: 'COMPLETED',
            stagedPath: stored.relativePath,
            byteCount: stored.byteCount,
            mimeType: stored.mimeType,
            quality: remote.quality,
            width: stored.width,
            height: stored.height,
            sha256: stored.sha256,
            errorCode: null,
            errorMessage: null,
            errorStage: null,
            remoteHost: null,
            finishedAt: new Date()
          }
        })
        if (completed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '图片下载状态已改变', { recoverable: true })
        return tx.archiveImport.update({
          where: { id: input.importId },
          data: { completedItems: { increment: 1 } },
          select: { completedItems: true }
        })
      }
    )
    itemCompleted = true
    await updateLeaseProgress(
      input.jobId,
      input.leaseAttempt,
      archiveProgress(task.completedItems, input.totalItems),
      `已下载 ${task.completedItems}/${input.totalItems}`
    )
    return { kind: 'COMPLETED' }
  } catch (error) {
    const classified = toArchiveError(error)
    if (itemCompleted) throw classified
    const disposition = classifyArchiveFailure(classified)
    const retry = disposition === 'RETRY_ITEM' && attempt < MAX_MEDIA_ATTEMPTS && !input.signal.aborted
    const terminalItemFailure = disposition === 'FAIL_ITEM' || (disposition === 'RETRY_ITEM' && !retry)

    try {
      await withRunningLeaseTransaction(input.jobId, input.importId, input.leaseAttempt, async (tx) => {
        const failed = await tx.archiveImportItem.updateMany({
          where: { id: input.item.id, archiveImportId: input.importId, status: 'DOWNLOADING', attempts: attempt },
          data: {
            status: terminalItemFailure ? 'FAILED' : 'PENDING',
            errorCode: classified.code,
            errorMessage: classified.message,
            errorStage: classified.stage,
            remoteHost: classified.remoteHost,
            finishedAt: terminalItemFailure ? new Date() : null
          }
        })
        if (failed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '图片下载状态已改变', { recoverable: true })
        if (terminalItemFailure) {
          await tx.archiveImport.update({
            where: { id: input.importId },
            data: { failedItems: { increment: 1 } }
          })
        }
      })
    } catch (checkpointError) {
      if (!input.signal.aborted) throw checkpointError
    }

    if (disposition === 'PAUSE_TASK' || disposition === 'STOP_TASK' || input.signal.aborted) throw classified
    if (retry) return { kind: 'RETRY', item: { ...input.item, attempts: attempt } }
    return { kind: 'FAILED' }
  }
}

interface ArchiveItemCounts {
  completed: number
  failed: number
  pending: number
  downloading: number
}

async function syncArchiveItemCounts(
  importId: string,
  jobId: string,
  leaseAttempt: number
): Promise<ArchiveItemCounts> {
  return withRunningLeaseTransaction(jobId, importId, leaseAttempt, async (tx) => {
    const groups = await tx.archiveImportItem.groupBy({
      by: ['status'],
      where: { archiveImportId: importId },
      _count: { _all: true }
    })
    const counts = normalizeItemCounts(groups)
    await tx.archiveImport.update({
      where: { id: importId },
      data: { completedItems: counts.completed, failedItems: counts.failed }
    })
    return counts
  })
}

async function readArchiveItemCounts(importId: string): Promise<ArchiveItemCounts> {
  const groups = await prisma.archiveImportItem.groupBy({
    by: ['status'],
    where: { archiveImportId: importId },
    _count: { _all: true }
  })
  return normalizeItemCounts(groups)
}

function normalizeItemCounts(
  groups: Array<{ status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED'; _count: { _all: number } }>
): ArchiveItemCounts {
  const counts: ArchiveItemCounts = { completed: 0, failed: 0, pending: 0, downloading: 0 }
  for (const group of groups) {
    const count = group._count._all
    if (group.status === 'COMPLETED') counts.completed = count
    else if (group.status === 'FAILED') counts.failed = count
    else if (group.status === 'PENDING') counts.pending = count
    else counts.downloading = count
  }
  return counts
}

async function finalizePartialFailure(input: {
  importId: string
  jobId: string
  leaseAttempt: number
  completed: number
  failed: number
  total: number
}): Promise<void> {
  const now = new Date()
  const message = `部分失败：已下载 ${input.completed}/${input.total}，失败 ${input.failed} 张`
  await prisma.$transaction(async (tx) => {
    const job = await tx.systemJob.updateMany({
      where: { id: input.jobId, attempt: input.leaseAttempt, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        progress: 95,
        message,
        error: message,
        finishedAt: now,
        heartbeatAt: now
      }
    })
    if (job.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
    const task = await tx.archiveImport.updateMany({
      where: { id: input.importId, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        completedItems: input.completed,
        failedItems: input.failed,
        errorCode: 'PARTIAL_FAILURE',
        errorMessage: message,
        finishedAt: now,
        retainUntil: new Date(
          now.getTime() + (input.completed > 0 ? PARTIAL_FAILED_STAGING_RETENTION_MS : FAILED_STAGING_RETENTION_MS)
        )
      }
    })
    if (task.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变', { recoverable: true })
  })
}

function archiveProgress(completed: number, total: number): number {
  return Math.max(1, Math.min(95, Math.round((completed / Math.max(total, 1)) * 90) + 5))
}

async function claimNextArchiveImport() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_QUEUE_ADVISORY_LOCK_ID)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const active = await tx.systemJob.findFirst({
      where: { type: ARCHIVE_IMPORT_JOB_TYPE, status: { in: ['RUNNING', 'CANCELLING'] } },
      select: { id: true }
    })
    if (active) return null
    const next = await tx.archiveImport.findFirst({
      where: {
        status: 'PENDING',
        cleanupRequestedAt: null,
        systemJob: { status: 'PENDING', type: ARCHIVE_IMPORT_JOB_TYPE }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { systemJob: true }
    })
    if (!next) return null
    const now = new Date()
    const task = await tx.archiveImport.updateMany({
      where: { id: next.id, status: 'PENDING', cleanupRequestedAt: null },
      data: { status: 'RUNNING', startedAt: next.startedAt ?? now, finishedAt: null, retainUntil: null }
    })
    if (task.count !== 1) return null
    const jobUpdate = await tx.systemJob.updateMany({
      where: { id: next.systemJobId, status: 'PENDING', type: ARCHIVE_IMPORT_JOB_TYPE },
      data: {
        status: 'RUNNING',
        progress: Math.max(1, next.systemJob.progress),
        message: '正在归档媒体...',
        startedAt: next.systemJob.startedAt ?? now,
        heartbeatAt: now,
        finishedAt: null,
        error: null,
        attempt: { increment: 1 }
      }
    })
    if (jobUpdate.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务领取状态已改变', { recoverable: true })
    const job = await tx.systemJob.findUniqueOrThrow({ where: { id: next.systemJobId } })
    return { ...next, systemJob: job }
  })
}

async function finalizeFailure(importId: string, jobId: string, leaseAttempt: number, error: unknown) {
  const current = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  if (!current || current.attempt !== leaseAttempt || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) return
  const classified = toArchiveError(error)
  const now = new Date()
  const counts = await readArchiveItemCounts(importId)
  if (current.status === 'CANCELLING' || classified.code === 'CANCELLED') {
    await setFinalState({
      importId,
      jobId,
      leaseAttempt,
      status: 'CANCELLED',
      message: '任务已取消',
      error: classified,
      counts,
      now
    })
    return
  }
  if (current.status === 'PAUSED') return
  if (classified.code === 'WORKER_STOPPED') {
    await requeueOwnedLease(importId, jobId, leaseAttempt)
    return
  }
  if (classified.pause) {
    await prisma.$transaction(async (tx) => {
      const job = await tx.systemJob.updateMany({
        where: { id: jobId, attempt: leaseAttempt, status: 'RUNNING' },
        data: { status: 'PAUSED', message: classified.message, error: classified.message, heartbeatAt: now }
      })
      if (job.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
      const task = await tx.archiveImport.updateMany({
        where: { id: importId, status: 'RUNNING' },
        data: {
          status: 'PAUSED',
          decisionCode: classified.decisionCode,
          errorCode: classified.code,
          errorMessage: classified.message,
          completedItems: counts.completed,
          failedItems: counts.failed
        }
      })
      if (task.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变', { recoverable: true })
    })
    return
  }
  await setFinalState({
    importId,
    jobId,
    leaseAttempt,
    status: 'FAILED',
    message: classified.message,
    error: classified,
    counts,
    now
  })
}

async function setFinalState(input: {
  importId: string
  jobId: string
  leaseAttempt: number
  status: 'FAILED' | 'CANCELLED'
  message: string
  error: ArchiveError
  counts: ArchiveItemCounts
  now: Date
}) {
  const { importId, jobId, leaseAttempt, status, message, error, counts, now } = input
  await prisma.$transaction(async (tx) => {
    const job = await tx.systemJob.updateMany({
      where: { id: jobId, attempt: leaseAttempt, status: { in: ['RUNNING', 'CANCELLING'] } },
      data: { status, message, error: error.message, finishedAt: now, heartbeatAt: now }
    })
    if (job.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
    const task = await tx.archiveImport.updateMany({
      where: { id: importId, status: { in: ['RUNNING', 'CANCELLING'] } },
      data: {
        status,
        errorCode: error.code,
        errorMessage: error.message,
        completedItems: counts.completed,
        failedItems: counts.failed,
        finishedAt: now,
        retainUntil: new Date(
          now.getTime() +
            (status === 'FAILED' && counts.completed > 0
              ? PARTIAL_FAILED_STAGING_RETENTION_MS
              : FAILED_STAGING_RETENTION_MS)
        )
      }
    })
    if (task.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变', { recoverable: true })
  })
}

async function requeueOwnedLease(importId: string, jobId: string, leaseAttempt: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.systemJob.updateMany({
      where: { id: jobId, attempt: leaseAttempt, status: 'RUNNING' },
      data: { status: 'PENDING', message: 'Worker 已停止，等待续传', heartbeatAt: null }
    })
    if (job.count !== 1) return
    await tx.archiveImportItem.updateMany({
      where: { archiveImportId: importId, status: { not: 'COMPLETED' } },
      data: {
        status: 'PENDING', attempts: 0, startedAt: null, finishedAt: null,
        errorCode: null, errorMessage: null, errorStage: null, remoteHost: null
      }
    })
    const completedItems = await tx.archiveImportItem.count({ where: { archiveImportId: importId, status: 'COMPLETED' } })
    const task = await tx.archiveImport.updateMany({
      where: { id: importId, status: 'RUNNING' },
      data: { status: 'PENDING', completedItems, failedItems: 0 }
    })
    if (task.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变', { recoverable: true })
  })
}

export async function recoverStaleArchiveImports() {
  const staleBefore = new Date(Date.now() - STALE_JOB_THRESHOLD_MS)
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_QUEUE_ADVISORY_LOCK_ID)
    const stale = await tx.systemJob.findMany({
      where: {
        type: ARCHIVE_IMPORT_JOB_TYPE,
        status: { in: ['RUNNING', 'CANCELLING'] },
        OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
      },
      include: { archiveImport: true }
    })
    for (const job of stale) {
      if (!job.archiveImport) continue
      if (job.status === 'CANCELLING') {
        const counts = normalizeItemCounts(
          await tx.archiveImportItem.groupBy({
            by: ['status'],
            where: { archiveImportId: job.archiveImport.id },
            _count: { _all: true }
          })
        )
        await tx.systemJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLED', message: '中断恢复：取消完成', finishedAt: new Date() }
        })
        await tx.archiveImport.update({
          where: { id: job.archiveImport.id },
          data: {
            status: 'CANCELLED',
            completedItems: counts.completed,
            failedItems: counts.failed,
            finishedAt: new Date(),
            retainUntil: new Date(Date.now() + FAILED_STAGING_RETENTION_MS)
          }
        })
      } else {
        await tx.archiveImportItem.updateMany({
          where: { archiveImportId: job.archiveImport.id, status: { not: 'COMPLETED' } },
          data: {
            status: 'PENDING', attempts: 0, startedAt: null, finishedAt: null,
            errorCode: null, errorMessage: null, errorStage: null, remoteHost: null
          }
        })
        const completedItems = await tx.archiveImportItem.count({
          where: { archiveImportId: job.archiveImport.id, status: 'COMPLETED' }
        })
        await tx.systemJob.update({
          where: { id: job.id },
          data: { status: 'PENDING', message: '中断恢复：等待续传', heartbeatAt: null }
        })
        await tx.archiveImport.update({
          where: { id: job.archiveImport.id },
          data: { status: 'PENDING', completedItems, failedItems: 0 }
        })
      }
    }
  })
}

async function maintainArchiveQueue() {
  const now = Date.now()
  if (now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return
  const scanRoot = await requireArchiveStorageRoot()
  await requestExpiredArchiveCleanups()
  await prisma.archivePreviewSession.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await purgeExpiredArchiveTrash(scanRoot)
  lastMaintenanceAt = now
}

async function maybeRecoverStaleArchiveImports(): Promise<void> {
  const now = Date.now()
  if (now - lastStaleRecoveryAt < STALE_RECOVERY_INTERVAL_MS) return
  await recoverStaleArchiveImports()
  lastStaleRecoveryAt = now
}

async function reconcileArchiveMaintenance(scanRoot: string): Promise<void> {
  const lifecycleResult = await reconcilePendingArchiveLifecycles(scanRoot)
  for (const failure of lifecycleResult.failures) {
    logger.error('Failed to reconcile archive lifecycle', {
      artworkId: failure.artworkId,
      error: failure.error
    })
  }
  const cleanupResult = await reconcilePendingArchiveCleanups(scanRoot)
  for (const failure of cleanupResult.failures) {
    logger.error('Failed to reconcile archive staging cleanup', {
      importId: failure.importId,
      error: failure.error
    })
  }
}

async function assertRunningLease(jobId: string, leaseAttempt: number) {
  const job = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  if (!job || job.attempt !== leaseAttempt) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
  if (job.status === 'CANCELLING') throw new ArchiveError('CANCELLED', '任务正在取消', { recoverable: true })
  if (job.status === 'PAUSED') throw new ArchiveError('PAUSED', '任务已暂停', { recoverable: true, pause: true })
  if (job.status !== 'RUNNING') throw new ArchiveError('LEASE_LOST', '归档任务不再运行')
}

async function touchLease(jobId: string, leaseAttempt: number) {
  const result = await prisma.systemJob.updateMany({
    where: { id: jobId, attempt: leaseAttempt, status: { in: ['RUNNING', 'CANCELLING'] } },
    data: { heartbeatAt: new Date() }
  })
  if (result.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
}

async function updateLeaseProgress(jobId: string, leaseAttempt: number, progress: number, message: string) {
  const result = await prisma.systemJob.updateMany({
    where: { id: jobId, attempt: leaseAttempt, status: 'RUNNING' },
    data: { progress, message, heartbeatAt: new Date() }
  })
  if (result.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
}

async function withRunningLeaseTransaction<T>(
  jobId: string,
  importId: string,
  leaseAttempt: number,
  operation: (tx: ArchiveTransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const lease = await tx.systemJob.updateMany({
      where: { id: jobId, attempt: leaseAttempt, status: 'RUNNING' },
      data: { heartbeatAt: new Date() }
    })
    if (lease.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
    const task = await tx.archiveImport.findFirst({
      where: { id: importId, systemJobId: jobId, status: 'RUNNING' },
      select: { id: true }
    })
    if (!task) throw new ArchiveError('STATE_CONFLICT', '归档任务已不再允许运行', { recoverable: true })
    return operation(tx)
  })
}

function backoffWithJitter(attempt: number) {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1))
  return base + Math.floor(Math.random() * Math.max(250, Math.floor(base * 0.25)))
}

function throwIfWorkerAborted(signal: AbortSignal, rootError: ArchiveError | null): void {
  if (!signal.aborted) return
  throw rootError ?? toArchiveError(signal.reason)
}

function relationshipValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const relationships = (value as Record<string, unknown>).relationships
  return Array.isArray(relationships) ? relationships : []
}
