import { setTimeout as delay } from 'node:timers/promises'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { ArchiveError, toArchiveError } from './errors'
import { archiveModule, ARCHIVE_IMPORT_JOB_TYPE, FAILED_STAGING_RETENTION_MS } from './archive-module'
import { publishArchiveImport, purgeExpiredArchiveTrash } from './publisher'
import {
  prepareStagingDirectory,
  removeArchivePath,
  storeRemoteMedia,
  validateStoredMedia,
  writeManifest
} from './storage'
import type { ResolvedMedia } from './types'
import { requireArchiveStorageRoot } from './config'

const ARCHIVE_QUEUE_ADVISORY_LOCK_ID = 7_341_902_118
const HEARTBEAT_INTERVAL_MS = 30_000
const CONTROL_POLL_INTERVAL_MS = 2_000
const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const MEDIA_CONCURRENCY = 2
const MAX_MEDIA_ATTEMPTS = 3

let lastMaintenanceAt = 0

export async function runArchiveWorkerLoop(options: { signal?: AbortSignal; pollIntervalMs?: number } = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  await recoverStaleArchiveImports()
  while (!options.signal?.aborted) {
    const processed = await processNextArchiveImport()
    if (!processed) await delay(pollIntervalMs, undefined, { signal: options.signal }).catch(() => undefined)
  }
}

export async function processNextArchiveImport(): Promise<boolean> {
  await maintainArchiveQueue()
  const claimed = await claimNextArchiveImport()
  if (!claimed) return false
  await processClaimedArchiveImport(claimed.id, claimed.systemJob.attempt)
  return true
}

export async function processClaimedArchiveImport(importId: string, leaseAttempt: number): Promise<void> {
  const archiveImport = await prisma.archiveImport.findUnique({
    where: { id: importId },
    include: { items: { orderBy: { pageIndex: 'asc' } }, systemJob: true }
  })
  if (!archiveImport || archiveImport.systemJob.attempt !== leaseAttempt || archiveImport.status !== 'RUNNING') {
    throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
  }
  const scanRoot = await requireArchiveStorageRoot()
  const stagingDirectory = await prepareStagingDirectory(scanRoot, archiveImport.stagingPath)
  const provider = archiveModule.getProvider(archiveImport.providerKey)
  const controller = new AbortController()
  const heartbeat = setInterval(() => {
    void touchLease(archiveImport.systemJobId, leaseAttempt).catch((error) => {
      logger.warn('Archive worker heartbeat failed', { error, importId })
      controller.abort()
    })
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  const controlPoll = setInterval(() => {
    void prisma.systemJob
      .findUnique({ where: { id: archiveImport.systemJobId }, select: { status: true, attempt: true } })
      .then((job) => {
        if (!job || job.attempt !== leaseAttempt || ['CANCELLING', 'PAUSED'].includes(job.status)) controller.abort()
      })
      .catch(() => controller.abort())
  }, CONTROL_POLL_INTERVAL_MS)
  controlPoll.unref()

  try {
    await touchLease(archiveImport.systemJobId, leaseAttempt)
    const pendingItems = archiveImport.items.filter((item) => item.status !== 'COMPLETED')
    let cursor = 0
    const workers = Array.from({ length: Math.min(MEDIA_CONCURRENCY, pendingItems.length) }, async () => {
      try {
        while (cursor < pendingItems.length) {
          const item = pendingItems[cursor++]
          if (!item) return
          await assertRunningLease(archiveImport.systemJobId, leaseAttempt)
          await downloadItemWithRetry({
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
        }
      } catch (error) {
        controller.abort()
        throw error
      }
    })
    const workerResults = await Promise.allSettled(workers)
    const rejectedWorker = workerResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejectedWorker) throw rejectedWorker.reason
    await assertRunningLease(archiveImport.systemJobId, leaseAttempt)

    const completed = await prisma.archiveImportItem.findMany({
      where: { archiveImportId: importId },
      orderBy: { pageIndex: 'asc' }
    })
    if (completed.length !== archiveImport.totalItems || completed.some((item) => item.status !== 'COMPLETED')) {
      throw new ArchiveError('MEDIA_INVALID', '归档媒体检查点不完整', { recoverable: true })
    }
    await validateStoredMedia(stagingDirectory, completed)
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
    await publishArchiveImport(importId, scanRoot)
  } catch (error) {
    controller.abort()
    await finalizeFailure(importId, archiveImport.systemJobId, leaseAttempt, error)
  } finally {
    clearInterval(heartbeat)
    clearInterval(controlPoll)
  }
}

async function downloadItemWithRetry(input: {
  importId: string
  jobId: string
  leaseAttempt: number
  item: {
    id: string
    pageIndex: number
    sourcePageUrl: string
    locator: unknown
    expectedFilename: string
    attempts: number
  }
  provider: ReturnType<typeof archiveModule.getProvider>
  selectedQuality: 'ORIGINAL' | 'DISPLAY'
  stagingDirectory: string
  signal: AbortSignal
  totalItems: number
}) {
  let attempt = input.item.attempts
  while (attempt < MAX_MEDIA_ATTEMPTS) {
    attempt += 1
    await prisma.archiveImportItem.update({
      where: { id: input.item.id },
      data: {
        status: 'DOWNLOADING',
        attempts: { increment: 1 },
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        errorMessage: null
      }
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
        signal: input.signal
      })
      const [, task] = await prisma.$transaction([
        prisma.archiveImportItem.update({
          where: { id: input.item.id },
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
            finishedAt: new Date()
          }
        }),
        prisma.archiveImport.update({
          where: { id: input.importId },
          data: { completedItems: { increment: 1 } },
          select: { completedItems: true }
        })
      ])
      const progress = Math.max(1, Math.min(95, Math.round((task.completedItems / input.totalItems) * 90) + 5))
      await updateLeaseProgress(input.jobId, input.leaseAttempt, progress, `已下载 ${task.completedItems}/${input.totalItems}`)
      return
    } catch (error) {
      const classified = toArchiveError(error)
      await prisma.archiveImportItem.update({
        where: { id: input.item.id },
        data: {
          status: 'FAILED',
          errorCode: classified.code,
          errorMessage: classified.message,
          finishedAt: new Date()
        }
      })
      if (classified.pause || !classified.recoverable || attempt >= MAX_MEDIA_ATTEMPTS || input.signal.aborted) {
        throw classified
      }
      const waitMs = classified.retryAfterMs ?? backoffWithJitter(attempt)
      await delay(waitMs, undefined, { signal: input.signal }).catch(() => undefined)
      if (input.signal.aborted) throw classified
    }
  }
}

async function claimNextArchiveImport() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_QUEUE_ADVISORY_LOCK_ID)
    const active = await tx.systemJob.findFirst({
      where: { type: ARCHIVE_IMPORT_JOB_TYPE, status: { in: ['RUNNING', 'CANCELLING'] } },
      select: { id: true }
    })
    if (active) return null
    const next = await tx.archiveImport.findFirst({
      where: { status: 'PENDING', systemJob: { status: 'PENDING', type: ARCHIVE_IMPORT_JOB_TYPE } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { systemJob: true }
    })
    if (!next) return null
    const now = new Date()
    const job = await tx.systemJob.update({
      where: { id: next.systemJobId },
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
    await tx.archiveImport.update({
      where: { id: next.id },
      data: { status: 'RUNNING', startedAt: next.startedAt ?? now, finishedAt: null, retainUntil: null }
    })
    return { ...next, systemJob: job }
  })
}

async function finalizeFailure(importId: string, jobId: string, leaseAttempt: number, error: unknown) {
  const current = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  if (!current || current.attempt !== leaseAttempt || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) return
  const classified = toArchiveError(error)
  const now = new Date()
  if (current.status === 'CANCELLING' || classified.code === 'CANCELLED') {
    await setFinalState({ importId, jobId, status: 'CANCELLED', message: '任务已取消', error: classified, now })
    return
  }
  if (current.status === 'PAUSED') return
  if (classified.pause) {
    await prisma.$transaction([
      prisma.archiveImport.update({
        where: { id: importId },
        data: {
          status: 'PAUSED',
          decisionCode: classified.decisionCode,
          errorCode: classified.code,
          errorMessage: classified.message,
          failedItems: { increment: 1 }
        }
      }),
      prisma.systemJob.update({
        where: { id: jobId },
        data: { status: 'PAUSED', message: classified.message, error: classified.message, heartbeatAt: now }
      })
    ])
    return
  }
  await setFinalState({ importId, jobId, status: 'FAILED', message: classified.message, error: classified, now })
}

async function setFinalState(input: {
  importId: string
  jobId: string
  status: 'FAILED' | 'CANCELLED'
  message: string
  error: ArchiveError
  now: Date
}) {
  const { importId, jobId, status, message, error, now } = input
  await prisma.$transaction([
    prisma.archiveImport.update({
      where: { id: importId },
      data: {
        status,
        errorCode: error.code,
        errorMessage: error.message,
        failedItems: status === 'FAILED' ? { increment: 1 } : undefined,
        finishedAt: now,
        retainUntil: new Date(now.getTime() + FAILED_STAGING_RETENTION_MS)
      }
    }),
    prisma.systemJob.update({
      where: { id: jobId },
      data: { status, message, error: error.message, finishedAt: now, heartbeatAt: now }
    })
  ])
}

async function recoverStaleArchiveImports() {
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
        await tx.systemJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLED', message: '中断恢复：取消完成', finishedAt: new Date() }
        })
        await tx.archiveImport.update({
          where: { id: job.archiveImport.id },
          data: {
            status: 'CANCELLED',
            finishedAt: new Date(),
            retainUntil: new Date(Date.now() + FAILED_STAGING_RETENTION_MS)
          }
        })
      } else {
        await tx.archiveImportItem.updateMany({
          where: { archiveImportId: job.archiveImport.id, status: 'DOWNLOADING' },
          data: { status: 'PENDING', startedAt: null }
        })
        await tx.systemJob.update({
          where: { id: job.id },
          data: { status: 'PENDING', message: '中断恢复：等待续传', heartbeatAt: null }
        })
        await tx.archiveImport.update({
          where: { id: job.archiveImport.id },
          data: { status: 'PENDING' }
        })
      }
    }
  })
}

async function maintainArchiveQueue() {
  const now = Date.now()
  if (now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return
  await recoverStaleArchiveImports()
  const scanRoot = await requireArchiveStorageRoot()
  const expired = await prisma.archiveImport.findMany({
    where: { status: { in: ['FAILED', 'CANCELLED'] }, retainUntil: { lte: new Date() } },
    select: { id: true, stagingPath: true }
  })
  for (const task of expired) {
    await removeArchivePath(scanRoot, task.stagingPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    await prisma.archiveImport.update({ where: { id: task.id }, data: { retainUntil: null } })
  }
  await prisma.archivePreviewSession.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  await purgeExpiredArchiveTrash(scanRoot)
  lastMaintenanceAt = now
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

function backoffWithJitter(attempt: number) {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1))
  return base + Math.floor(Math.random() * Math.max(250, Math.floor(base * 0.25)))
}

function relationshipValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const relationships = (value as Record<string, unknown>).relationships
  return Array.isArray(relationships) ? relationships : []
}
