import 'server-only'
import fs from 'fs/promises'
import path from 'path'
import { PendingReplaceBatchStatus, PendingReplaceItemStatus, Prisma } from '@prisma/client'
import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '@/lib/safe-path'
import {
  PENDING_REPLACE_BACKUP_DIRECTORY,
  PENDING_REPLACE_COMPLETED_DIRECTORY,
  PENDING_REPLACE_DIRECTORY,
  PENDING_REPLACE_HEARTBEAT_INTERVAL_MS,
  PENDING_REPLACE_MANIFEST_FILE,
  PENDING_REPLACE_WORK_DIRECTORY,
  type PendingReplaceBatchResult,
  pendingReplaceExternalIdSchema
} from '@/schemas/pending-replace.dto'
import { scanLocalArtworkMediaDirectory } from '@/services/artwork-service/local-media-scanner'
import { updateArtworkImagesWithTransactionClient } from '@/services/artwork-service/image-manager'
import * as JobService from '@/services/job-service'
import { createManifestFingerprint, scanPendingReplaceDirectory } from './discovery'
import { archiveSuccessfulReplacement } from './executor-archive'
import {
  assertDirectoryAbsent,
  assertDirectoryEmptyOrAbsent,
  assertFileAbsent,
  moveIfExists,
  pathExists,
  removeEmptyDirectory
} from './executor-file-utils'
import {
  asManifest,
  asMediaSnapshot,
  asTargetFileSnapshot,
  assertArtworkDatabaseSnapshot,
  assertArtworkMediaFilesSnapshot,
  assertBackupDirectoryFileSubsetSnapshot,
  assertBackupDirectoryFilesSnapshot,
  assertTargetDirectoryFilesSnapshot,
  buildInstalledNewMediaSnapshot,
  normalizeStoredPath,
  stripLeadingSlash,
  toStoredPath
} from './executor-snapshot'
import {
  assertPendingReplaceLease,
  assertPendingReplaceTransactionLease,
  PendingReplaceCommitOutcomeUnknownError,
  PendingReplaceLeaseLostError,
  touchPendingReplaceLease,
  updatePendingReplaceItemsWithLease,
  updatePendingReplaceItemWithLease,
  withPendingReplaceMutationLease
} from './executor-lease'
import { rollbackFailedItem } from './executor-rollback'
import { readMovedSourceManifest } from './executor-source-manifest'

export {
  PendingReplaceCommitOutcomeUnknownError,
  PendingReplaceLeaseLostError
} from './executor-lease'

const restorableItemStatuses = new Set<PendingReplaceItemStatus>([
  PendingReplaceItemStatus.SUCCESS,
  PendingReplaceItemStatus.RESTORING,
  PendingReplaceItemStatus.RESTORE_SWAPPING
])
const replacementRollbackStatuses = new Set<PendingReplaceItemStatus>([
  PendingReplaceItemStatus.STAGING,
  PendingReplaceItemStatus.BACKING_UP,
  PendingReplaceItemStatus.SWAPPING,
  PendingReplaceItemStatus.COMMITTING,
  PendingReplaceItemStatus.ROLLING_BACK
])
const restoreRollbackStatuses = new Set<PendingReplaceItemStatus>([
  PendingReplaceItemStatus.RESTORING,
  PendingReplaceItemStatus.RESTORE_SWAPPING
])

interface PersistedPendingReplaceItemForRecovery {
  id: string
  batchId: string
  artworkId: number | null
  externalId: string | null
  sourceDirectoryName: string
  targetDirectory: string | null
  status: PendingReplaceItemStatus
  sourceManifest: Prisma.JsonValue
  oldMediaSnapshot: Prisma.JsonValue
  newMediaSnapshot: Prisma.JsonValue
  targetFileSnapshot: Prisma.JsonValue
  backupDirectory: string | null
  completedDirectory: string | null
}

export async function runPendingReplaceBatch(input: {
  scanPath: string
  batchId: string
  jobId: string
  leaseAttempt: number
}): Promise<PendingReplaceBatchResult> {
  const startedAt = Date.now()
  const batch = await prisma.pendingReplaceBatch.findUnique({
    where: { id: input.batchId },
    include: { items: { orderBy: { createdAt: 'asc' } } }
  })
  if (!batch) throw new Error('Pending replacement batch not found')

  const runnableItems = batch.items.filter((item) => item.included && item.status === PendingReplaceItemStatus.READY)
  let cancelled = false

  for (let index = 0; index < runnableItems.length; index += 1) {
    await assertPendingReplaceLease({ jobId: input.jobId, leaseAttempt: input.leaseAttempt })
    const currentJob = await JobService.getJob(input.jobId)
    if (currentJob?.status === 'CANCELLING') {
      cancelled = true
      break
    }

    const item = runnableItems[index]!
    await JobService.updateProgress(
      input.jobId,
      Math.round(5 + (index / Math.max(runnableItems.length, 1)) * 90),
      `正在替换 ${item.artworkTitle ?? item.externalId ?? item.sourceDirectoryName}`
    )
    try {
      await runPendingReplaceItem({
        scanPath: input.scanPath,
        itemId: item.id,
        jobId: input.jobId,
        leaseAttempt: input.leaseAttempt
      })
    } catch (error) {
      if (
        error instanceof PendingReplaceLeaseLostError ||
        error instanceof PendingReplaceCommitOutcomeUnknownError
      ) {
        throw error
      }
      await updatePendingReplaceItemsWithLease(input, {
        where: {
          id: item.id,
          status: {
            notIn: [
              PendingReplaceItemStatus.SUCCESS,
              PendingReplaceItemStatus.RESTORED,
              PendingReplaceItemStatus.BACKUP_CLEANED
            ]
          }
        },
        data: {
          status: PendingReplaceItemStatus.FAILED,
          error: error instanceof Error ? error.message : '未知错误',
          finishedAt: new Date()
        }
      })
    }
    await syncPendingReplaceBatchCounters(input.batchId)
  }

  await assertPendingReplaceLease({ jobId: input.jobId, leaseAttempt: input.leaseAttempt })
  const counters = await syncPendingReplaceBatchCounters(input.batchId)
  const finalStatus = cancelled
    ? PendingReplaceBatchStatus.CANCELLED
    : counters.failedItems > 0
      ? PendingReplaceBatchStatus.PARTIAL_FAILED
      : PendingReplaceBatchStatus.COMPLETED

  await prisma.$transaction(async (tx) => {
    await assertPendingReplaceTransactionLease(tx, input)
    await tx.pendingReplaceBatch.update({
      where: { id: input.batchId },
      data: { status: finalStatus, finishedAt: new Date() }
    })
  })

  return {
    batchId: input.batchId,
    total: counters.totalItems,
    succeeded: counters.succeededItems,
    failed: counters.failedItems,
    excluded: counters.excludedItems,
    cancelled,
    backupBytes: Number(counters.backupBytes),
    processingTime: Date.now() - startedAt
  }
}

export async function runPendingReplaceItem(input: {
  scanPath: string
  itemId: string
  jobId?: string
  leaseAttempt?: number
}) {
  const item = await prisma.pendingReplaceItem.findUnique({ where: { id: input.itemId } })
  if (!item || !item.externalId || !item.artworkId || !item.targetDirectory || !item.fingerprint) {
    throw new Error('Pending replacement item is incomplete')
  }

  const pendingRoot = path.resolve(input.scanPath, PENDING_REPLACE_DIRECTORY)
  const sourceAbsolute = await resolveExistingPathWithinRoot(pendingRoot, item.sourceDirectoryName)
  const rescanned = await scanPendingReplaceDirectory({
    scanPath: input.scanPath,
    pendingRoot,
    sourceDirectoryName: item.sourceDirectoryName,
    externalId: item.externalId
  })
  if (createManifestFingerprint(rescanned.manifest) !== item.fingerprint) {
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.FAILED,
      error: '源目录在预检后发生变化，请重新扫描',
      finishedAt: new Date()
    })
    return
  }

  const manifest = asManifest(item.sourceManifest)
  const oldMedia = asMediaSnapshot(item.oldMediaSnapshot)
  const newMedia = asMediaSnapshot(item.newMediaSnapshot).sort((a, b) => a.order - b.order)
  const targetFiles = asTargetFileSnapshot(item.targetFileSnapshot)
  const externalId = pendingReplaceExternalIdSchema.parse(item.externalId)
  try {
    await assertArtworkMediaFilesSnapshot(input.scanPath, oldMedia)
  } catch (error) {
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.FAILED,
      error: error instanceof Error ? error.message : '作品媒体文件快照校验失败',
      finishedAt: new Date()
    })
    return
  }
  const workRelative = path.posix.join(PENDING_REPLACE_WORK_DIRECTORY, item.batchId, item.id)
  const workAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, workRelative)
  const workSourceAbsolute = path.join(workAbsolute, 'source')
  const normalizedAbsolute = path.join(workAbsolute, 'normalized')
  const backupRelative = path.posix.join(PENDING_REPLACE_BACKUP_DIRECTORY, item.batchId, externalId)
  const backupAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, backupRelative)
  const completedRelative = path.posix.join(
    PENDING_REPLACE_COMPLETED_DIRECTORY,
    item.batchId,
    `${item.sourceDirectoryName}--${item.id}`
  )
  const completedAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, completedRelative)
  const targetAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, stripLeadingSlash(item.targetDirectory))
  let sourceMovedToWork = false
  let databaseCommitted = false
  let newFilesMayBeInTarget = false
  let backupBytes = 0
  const archiveCommittedSource = async () => {
    try {
      await withPendingReplaceMutationLease(input, () =>
        archiveSuccessfulReplacement({
          item,
          manifest,
          workAbsolute,
          workSourceAbsolute,
          normalizedAbsolute,
          completedAbsolute
        })
      )
    } catch (error) {
      if (error instanceof PendingReplaceLeaseLostError) return
      const message = `替换成功，但归档清单失败: ${error instanceof Error ? error.message : '未知错误'}`
      await updatePendingReplaceItemsWithLease(input, {
        where: { id: item.id, status: PendingReplaceItemStatus.SUCCESS },
        data: { error: message }
      }).catch((writeError) => {
        logger.error('Failed to persist pending replacement archive warning', {
          error: writeError,
          itemId: item.id,
          message
        })
      })
    }
  }

  await updatePendingReplaceItemWithLease(input, item.id, {
    status: PendingReplaceItemStatus.STAGING,
    error: null,
    startedAt: new Date(),
    finishedAt: null
  })

  try {
    await assertPendingReplaceLease(input)
    await assertTargetDirectoryFilesSnapshot(targetAbsolute, targetFiles)
    await assertPendingReplaceLease(input)
    await assertDirectoryAbsent(workAbsolute, '发现未清理的替换工作目录')
    await assertDirectoryEmptyOrAbsent(backupAbsolute, '发现未清理的旧媒体备份')
    await withPendingReplaceMutationLease(input, async () => {
      await fs.mkdir(workAbsolute, { recursive: true })
      await fs.rename(sourceAbsolute, workSourceAbsolute)
    })
    sourceMovedToWork = true
    await assertPendingReplaceLease(input)
    if (createManifestFingerprint(await readMovedSourceManifest(workSourceAbsolute, manifest)) !== item.fingerprint) {
      throw new Error('源目录在进入工作区时发生变化，请重新扫描')
    }
    await assertPendingReplaceLease(input)
    await withPendingReplaceMutationLease(input, () => fs.mkdir(normalizedAbsolute, { recursive: true }))

    const manifestByName = new Map(manifest.map((file) => [file.name, file]))
    for (const media of newMedia) {
      await assertPendingReplaceLease(input)
      const sourceFile = manifestByName.get(media.sourceName)
      if (!sourceFile || sourceFile.kind !== 'media') throw new Error(`预检媒体不存在: ${media.sourceName}`)
      await withPendingReplaceMutationLease(input, () =>
        fs.rename(path.join(workSourceAbsolute, media.sourceName), path.join(normalizedAbsolute, media.targetName))
      )
    }
    for (const chapter of manifest.filter((file) => file.kind === 'chapter')) {
      await assertPendingReplaceLease(input)
      if (!chapter.targetName) throw new Error(`章节文件缺少目标名称: ${chapter.name}`)
      await withPendingReplaceMutationLease(input, () =>
        fs.rename(path.join(workSourceAbsolute, chapter.name), path.join(normalizedAbsolute, chapter.targetName!))
      )
    }
    await assertPendingReplaceLease(input)

    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.BACKING_UP
    })
    await withPendingReplaceMutationLease(input, async () => {
      await fs.mkdir(targetAbsolute, { recursive: true })
      await fs.mkdir(backupAbsolute, { recursive: true })
    })
    for (const targetFile of targetFiles) {
      await assertPendingReplaceLease(input)
      const sourcePath = path.join(targetAbsolute, targetFile.name)
      backupBytes += targetFile.size
      await withPendingReplaceMutationLease(input, () =>
        fs.rename(sourcePath, path.join(backupAbsolute, targetFile.name))
      )
    }
    await assertPendingReplaceLease(input)

    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.SWAPPING,
      backupDirectory: toStoredPath(backupRelative)
    })
    newFilesMayBeInTarget = true
    const normalizedEntries = await fs.readdir(normalizedAbsolute)
    for (const entry of normalizedEntries) {
      await assertPendingReplaceLease(input)
      const destination = path.join(targetAbsolute, entry)
      await withPendingReplaceMutationLease(input, async () => {
        await assertFileAbsent(destination, `目标目录存在同名非媒体文件: ${entry}`)
        await fs.rename(path.join(normalizedAbsolute, entry), destination)
      })
    }
    await assertPendingReplaceLease(input)

    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.COMMITTING
    })
    const scannedMedia = await scanLocalArtworkMediaDirectory({
      scanPath: input.scanPath,
      targetDirectoryRelativePath: item.targetDirectory
    })
    if (scannedMedia.filesMeta.length !== newMedia.length) {
      throw new Error(`目标媒体数校验失败：预期 ${newMedia.length}，实际 ${scannedMedia.filesMeta.length}`)
    }
    await assertPendingReplaceLease(input)

    await prisma.$transaction(async (tx) => {
      await assertPendingReplaceTransactionLease(tx, input)
      await assertArtworkDatabaseSnapshot(tx, item.artworkId!, oldMedia)
      await updateArtworkImagesWithTransactionClient(
        tx,
        item.artworkId!,
        scannedMedia.filesMeta,
        scannedMedia.chaptersMeta
      )
      await tx.pendingReplaceItem.update({
        where: { id: item.id },
        data: {
          status: PendingReplaceItemStatus.SUCCESS,
          backupDirectory: toStoredPath(backupRelative),
          completedDirectory: toStoredPath(completedRelative),
          error: scannedMedia.warnings.length > 0 ? scannedMedia.warnings.join('\n') : null,
          finishedAt: new Date()
        }
      })
      await tx.pendingReplaceBatch.update({
        where: { id: item.batchId },
        data: { backupBytes: { increment: backupBytes } }
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    databaseCommitted = true

    try {
      await assertPendingReplaceLease(input)
    } catch (error) {
      if (error instanceof PendingReplaceLeaseLostError) return
      throw error
    }

    await archiveCommittedSource()
  } catch (error) {
    if (
      error instanceof PendingReplaceLeaseLostError ||
      error instanceof PendingReplaceCommitOutcomeUnknownError
    ) {
      throw error
    }
    if (databaseCommitted) {
      logger.error('Pending replacement failed after its database transaction committed', { error, itemId: item.id })
      return
    }
    let persistedStatus: PendingReplaceItemStatus
    try {
      await assertPendingReplaceLease(input)
      const persisted = await prisma.pendingReplaceItem.findUnique({
        where: { id: item.id },
        select: { status: true }
      })
      if (!persisted) throw new Error('替换项目不存在')
      persistedStatus = persisted.status
      await assertPendingReplaceLease(input)
    } catch (readError) {
      if (readError instanceof PendingReplaceLeaseLostError) throw readError
      throw new PendingReplaceCommitOutcomeUnknownError('replace')
    }
    if (persistedStatus === PendingReplaceItemStatus.SUCCESS) {
      databaseCommitted = true
      logger.warn('Replacement commit succeeded although its transaction response failed', {
        error,
        itemId: item.id
      })
      await archiveCommittedSource()
      return
    }
    if (!replacementRollbackStatuses.has(persistedStatus)) {
      throw new PendingReplaceCommitOutcomeUnknownError('replace')
    }
    const stateWriteErrors: string[] = []
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.ROLLING_BACK
    })
      .catch((writeError) => {
        if (writeError instanceof PendingReplaceLeaseLostError) throw writeError
        stateWriteErrors.push(
          `记录回滚状态失败: ${writeError instanceof Error ? writeError.message : '未知错误'}`
        )
      })
    const rollbackErrors = await rollbackFailedItem({
      pendingRoot,
      sourceDirectoryName: item.sourceDirectoryName,
      workAbsolute,
      workSourceAbsolute,
      normalizedAbsolute,
      targetAbsolute,
      backupAbsolute,
      manifest,
      newMedia,
      targetFiles,
      sourceMovedToWork,
      newFilesMayBeInTarget,
      assertLease: () => assertPendingReplaceLease(input),
      mutate: (mutation) => withPendingReplaceMutationLease(input, mutation)
    })
    const message = error instanceof Error ? error.message : '未知错误'
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.FAILED,
      error: [message, ...stateWriteErrors, ...rollbackErrors].join('\n'),
      backupDirectory: rollbackErrors.length === 0 ? null : toStoredPath(backupRelative),
      finishedAt: new Date()
    })
      .catch((writeError) => {
        if (writeError instanceof PendingReplaceLeaseLostError) throw writeError
        logger.error('Failed to persist pending replacement rollback result', {
          error: writeError,
          itemId: item.id,
          originalError: message,
          rollbackErrors
        })
      })
  }
}

export async function recoverInterruptedPendingReplaceBatch(input: {
  scanPath: string
  batchId: string
  staleBefore: Date
  takeoverGraceMs?: number
}) {
  const initialBatch = await prisma.pendingReplaceBatch.findUnique({
    where: { id: input.batchId },
    include: { items: true, systemJob: true }
  })
  if (!initialBatch?.systemJob) throw new Error('没有可恢复的批量替换任务')
  if (initialBatch.status === PendingReplaceBatchStatus.PREVIEWED) throw new Error('该批次尚未开始执行')
  const claimed = await JobService.claimStalePendingReplaceJob(initialBatch.systemJob.id, input.staleBefore)
  if (!claimed) throw new Error('任务仍有心跳，不能执行中断恢复')
  await new Promise((resolve) => setTimeout(resolve, input.takeoverGraceMs ?? 2_000))
  const heartbeat = setInterval(() => {
    void touchPendingReplaceLease(claimed.id, claimed.attempt).catch((error) => {
      logger.warn('Failed to update pending replacement recovery heartbeat', {
        error,
        batchId: input.batchId,
        jobId: claimed.id
      })
    })
  }, PENDING_REPLACE_HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  try {
  await touchPendingReplaceLease(claimed.id, claimed.attempt)
  const batch = await prisma.pendingReplaceBatch.findUnique({
    where: { id: input.batchId },
    include: { items: true, systemJob: true }
  })
  if (
    !batch?.systemJob ||
    batch.systemJob.id !== claimed.id ||
    batch.systemJob.attempt !== claimed.attempt
  ) {
    throw new PendingReplaceLeaseLostError()
  }

  if (batch.systemJob.mode === 'CLEANUP') {
    await cleanupPendingReplaceBackups({
      scanPath: input.scanPath,
      batchId: batch.id,
      jobId: claimed.id,
      leaseAttempt: claimed.attempt
    })
    const counters = await syncPendingReplaceBatchCounters(batch.id)
    const finalized = await JobService.finalizePendingReplaceJob(
      claimed.id,
      claimed.attempt,
      { status: 'COMPLETED', result: { batchId: batch.id, recoveredAction: 'CLEANUP' } },
      async (tx) => {
        await tx.pendingReplaceBatch.update({
          where: { id: batch.id },
          data: {
            status:
              counters.failedItems > 0
                ? PendingReplaceBatchStatus.PARTIAL_FAILED
                : PendingReplaceBatchStatus.COMPLETED,
            finishedAt: new Date()
          }
        })
      }
    )
    if (!finalized) throw new PendingReplaceLeaseLostError()
    return { success: true, recoveredItems: 0 }
  }

  const activeStatuses: PendingReplaceItemStatus[] = [
    PendingReplaceItemStatus.STAGING,
    PendingReplaceItemStatus.BACKING_UP,
    PendingReplaceItemStatus.SWAPPING,
    PendingReplaceItemStatus.COMMITTING,
    PendingReplaceItemStatus.ROLLING_BACK
  ]
  const restoreStatuses: PendingReplaceItemStatus[] = [
    PendingReplaceItemStatus.RESTORING,
    PendingReplaceItemStatus.RESTORE_SWAPPING
  ]
  const activeItems = batch.items.filter((item) =>
    batch.systemJob!.mode === 'RESTORE'
      ? restoreStatuses.includes(item.status)
      : activeStatuses.includes(item.status)
  )
  const pendingRoot = path.resolve(input.scanPath, PENDING_REPLACE_DIRECTORY)
  await withPendingReplaceMutationLease(
    { jobId: claimed.id, leaseAttempt: claimed.attempt },
    () => fs.mkdir(pendingRoot, { recursive: true })
  )

  for (const item of activeItems) {
    await touchPendingReplaceLease(claimed.id, claimed.attempt)
    if (restoreStatuses.includes(item.status)) {
      await recoverInterruptedRestoreItem(input.scanPath, item, {
        jobId: claimed.id,
        leaseAttempt: claimed.attempt
      })
      continue
    }
    if (!item.externalId || !item.targetDirectory) {
      await updatePendingReplaceItemWithLease(
        { jobId: claimed.id, leaseAttempt: claimed.attempt },
        item.id,
        {
          status: PendingReplaceItemStatus.FAILED,
          error: '服务中断，且项目缺少恢复所需路径，请人工检查',
          finishedAt: new Date()
        }
      )
      continue
    }
    const externalId = pendingReplaceExternalIdSchema.parse(item.externalId)
    const workRelative = path.posix.join(PENDING_REPLACE_WORK_DIRECTORY, item.batchId, item.id)
    const workAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, workRelative)
    const workSourceAbsolute = path.join(workAbsolute, 'source')
    const normalizedAbsolute = path.join(workAbsolute, 'normalized')
    const backupRelative = path.posix.join(PENDING_REPLACE_BACKUP_DIRECTORY, item.batchId, externalId)
    const backupAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, backupRelative)
    const targetAbsolute = await resolveCreatablePathWithinRoot(
      input.scanPath,
      stripLeadingSlash(item.targetDirectory)
    )
    await updatePendingReplaceItemWithLease(
      { jobId: claimed.id, leaseAttempt: claimed.attempt },
      item.id,
      { status: PendingReplaceItemStatus.ROLLING_BACK }
    )
    const rollbackErrors = await rollbackFailedItem({
      pendingRoot,
      sourceDirectoryName: item.sourceDirectoryName,
      workAbsolute,
      workSourceAbsolute,
      normalizedAbsolute,
      targetAbsolute,
      backupAbsolute,
      manifest: asManifest(item.sourceManifest),
      newMedia: asMediaSnapshot(item.newMediaSnapshot),
      targetFiles: asTargetFileSnapshot(item.targetFileSnapshot),
      sourceMovedToWork: await pathExists(workSourceAbsolute),
      newFilesMayBeInTarget:
        item.status === PendingReplaceItemStatus.SWAPPING ||
        item.status === PendingReplaceItemStatus.COMMITTING ||
        (item.status === PendingReplaceItemStatus.ROLLING_BACK && Boolean(item.backupDirectory)),
      assertLease: () => assertPendingReplaceLease({ jobId: claimed.id, leaseAttempt: claimed.attempt }),
      mutate: (mutation) =>
        withPendingReplaceMutationLease(
          { jobId: claimed.id, leaseAttempt: claimed.attempt },
          mutation
        )
    })
    const backupRemains = await pathExists(backupAbsolute)
    await updatePendingReplaceItemWithLease(
      { jobId: claimed.id, leaseAttempt: claimed.attempt },
      item.id,
      {
        status: PendingReplaceItemStatus.FAILED,
        error: ['服务中断，未完成的文件操作已回滚', ...rollbackErrors].join('\n'),
        backupDirectory:
          rollbackErrors.length > 0 && backupRemains ? toStoredPath(backupRelative) : null,
        finishedAt: new Date()
      }
    )
  }

  let archiveRepairFailed = false
  if (batch.systemJob.mode !== 'RESTORE') {
    for (const item of batch.items.filter((candidate) => candidate.status === PendingReplaceItemStatus.SUCCESS)) {
      await assertPendingReplaceLease({ jobId: claimed.id, leaseAttempt: claimed.attempt })
      if (
        !(await repairSuccessfulReplacementArchive(input.scanPath, item, {
          jobId: claimed.id,
          leaseAttempt: claimed.attempt
        }))
      ) {
        archiveRepairFailed = true
      }
    }
  }

  const counters = await syncPendingReplaceBatchCounters(batch.id)
  const interrupted = counters.failedItems > 0 || counters.readyItems > 0 || archiveRepairFailed
  const restoreTarget =
    batch.systemJob.mode === 'RESTORE'
      ? batch.items.find((item) => item.id === batch.systemJob?.targetPath)
      : null
  const recoveryFailed =
    batch.systemJob.mode === 'RESTORE'
      ? restoreTarget?.status !== PendingReplaceItemStatus.RESTORED
      : interrupted
  const finalized = await JobService.finalizePendingReplaceJob(
    claimed.id,
    claimed.attempt,
    recoveryFailed
      ? { status: 'FAILED', error: '服务中断，未完成的文件操作已恢复到安全状态' }
      : { status: 'COMPLETED', result: { batchId: batch.id, recovered: true } },
    async (tx) => {
      await tx.pendingReplaceBatch.update({
        where: { id: batch.id },
        data: {
          status: interrupted
            ? PendingReplaceBatchStatus.PARTIAL_FAILED
            : PendingReplaceBatchStatus.COMPLETED,
          finishedAt: new Date()
        }
      })
    }
  )
  if (!finalized) throw new PendingReplaceLeaseLostError()
  return { success: true, recoveredItems: activeItems.length }
  } finally {
    clearInterval(heartbeat)
  }
}

async function repairSuccessfulReplacementArchive(
  scanPath: string,
  item: PersistedPendingReplaceItemForRecovery,
  lease: { jobId: string; leaseAttempt: number }
) {
  if (!item.completedDirectory) return false
  const workRelative = path.posix.join(PENDING_REPLACE_WORK_DIRECTORY, item.batchId, item.id)
  const workAbsolute = await resolveCreatablePathWithinRoot(scanPath, workRelative)
  const workSourceAbsolute = path.join(workAbsolute, 'source')
  const normalizedAbsolute = path.join(workAbsolute, 'normalized')
  const completedAbsolute = await resolveCreatablePathWithinRoot(
    scanPath,
    stripLeadingSlash(item.completedDirectory)
  )
  try {
    await withPendingReplaceMutationLease(lease, () =>
      archiveSuccessfulReplacement({
        item,
        manifest: asManifest(item.sourceManifest),
        workAbsolute,
        workSourceAbsolute,
        normalizedAbsolute,
        completedAbsolute
      })
    )
    return true
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    await updatePendingReplaceItemWithLease(lease, item.id, {
        error: `服务中断后修复完成归档失败: ${error instanceof Error ? error.message : '未知错误'}`
    })
    return false
  }
}

async function recoverInterruptedRestoreItem(
  scanPath: string,
  item: PersistedPendingReplaceItemForRecovery,
  lease: { jobId: string; leaseAttempt: number }
) {
  if (!item.targetDirectory || !item.backupDirectory) {
    await updatePendingReplaceItemWithLease(lease, item.id, {
        status: PendingReplaceItemStatus.FAILED,
        error: '服务中断，恢复项目缺少目标或备份路径',
        finishedAt: new Date()
    })
    return
  }
  const pendingRoot = path.resolve(scanPath, PENDING_REPLACE_DIRECTORY)
  const pendingAbsolute = await resolveCreatablePathWithinRoot(pendingRoot, item.sourceDirectoryName)
  const targetAbsolute = await resolveCreatablePathWithinRoot(
    scanPath,
    stripLeadingSlash(item.targetDirectory)
  )
  const backupAbsolute = await resolveExpectedBackupDirectory(scanPath, item)
  const completedAbsolute = item.completedDirectory
    ? await resolveCreatablePathWithinRoot(scanPath, stripLeadingSlash(item.completedDirectory))
    : null
  const manifest = asManifest(item.sourceManifest)
  const newMedia = asMediaSnapshot(item.newMediaSnapshot)
  const targetFiles = asTargetFileSnapshot(item.targetFileSnapshot)
  const errors: string[] = []
  const mutate = <T>(mutation: () => Promise<T>) => withPendingReplaceMutationLease(lease, mutation)

  try {
    if (item.status === PendingReplaceItemStatus.RESTORE_SWAPPING) {
      await mutate(() => fs.mkdir(backupAbsolute, { recursive: true }))
      for (const targetFile of targetFiles) {
        await assertPendingReplaceLease(lease)
        await mutate(() =>
          moveIfExists(
            path.join(targetAbsolute, targetFile.name),
            path.join(backupAbsolute, targetFile.name)
          )
        )
      }
    }
    for (const media of newMedia) {
      await assertPendingReplaceLease(lease)
      await mutate(() =>
        moveIfExists(path.join(pendingAbsolute, media.sourceName), path.join(targetAbsolute, media.targetName))
      )
    }
    for (const chapter of manifest.filter((file) => file.kind === 'chapter' && file.targetName)) {
      await assertPendingReplaceLease(lease)
      await mutate(() =>
        moveIfExists(path.join(pendingAbsolute, chapter.name), path.join(targetAbsolute, chapter.targetName!))
      )
    }
    if (completedAbsolute && (await pathExists(pendingAbsolute))) {
      await assertPendingReplaceLease(lease)
      if (await pathExists(completedAbsolute)) throw new Error('完成归档目录与待处理目录同时存在')
      await mutate(async () => {
        await fs.writeFile(
          path.join(pendingAbsolute, PENDING_REPLACE_MANIFEST_FILE),
          JSON.stringify({ batchId: item.batchId, itemId: item.id, externalId: item.externalId }, null, 2),
          'utf8'
        )
        await fs.mkdir(path.dirname(completedAbsolute), { recursive: true })
        await fs.rename(pendingAbsolute, completedAbsolute)
      })
    } else {
      await mutate(() => removeEmptyDirectory(pendingAbsolute))
    }
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    errors.push(error instanceof Error ? error.message : '未知错误')
  }

  await updatePendingReplaceItemWithLease(lease, item.id, {
      status: errors.length > 0 ? PendingReplaceItemStatus.FAILED : PendingReplaceItemStatus.SUCCESS,
      error: errors.length > 0 ? `服务中断恢复回滚失败: ${errors.join('\n')}` : null,
      finishedAt: new Date()
  })
}

async function resolveExpectedBackupDirectory(
  scanPath: string,
  item: { batchId: string; externalId: string | null; backupDirectory: string | null }
) {
  if (!item.externalId || !item.backupDirectory) throw new Error('替换项目缺少备份路径')
  const externalId = pendingReplaceExternalIdSchema.parse(item.externalId)
  const expectedRelative = path.posix.join(PENDING_REPLACE_BACKUP_DIRECTORY, item.batchId, externalId)
  if (normalizeStoredPath(item.backupDirectory) !== normalizeStoredPath(expectedRelative)) {
    throw new Error('备份路径与替换项目不一致，拒绝恢复')
  }
  return resolveExistingPathWithinRoot(scanPath, expectedRelative)
}

export async function restorePendingReplaceItem(input: {
  scanPath: string
  itemId: string
  jobId?: string
  leaseAttempt?: number
}) {
  const item = await prisma.pendingReplaceItem.findUnique({
    where: { id: input.itemId },
    include: { batch: true }
  })
  if (
    !item ||
    !restorableItemStatuses.has(item.status) ||
    !item.backupDirectory ||
    !item.targetDirectory
  ) {
    throw new Error('该作品没有可恢复的旧媒体备份')
  }

  const pendingRoot = path.resolve(input.scanPath, PENDING_REPLACE_DIRECTORY)
  await withPendingReplaceMutationLease(input, () => fs.mkdir(pendingRoot, { recursive: true }))
  const pendingAbsolute = await resolveCreatablePathWithinRoot(pendingRoot, item.sourceDirectoryName)
  await assertDirectoryAbsent(pendingAbsolute, '待处理目录已存在同名资源，无法恢复')
  const targetAbsolute = await resolveExistingPathWithinRoot(input.scanPath, stripLeadingSlash(item.targetDirectory))
  const backupAbsolute = await resolveExpectedBackupDirectory(input.scanPath, item)
  const completedAbsolute = item.completedDirectory
    ? await resolveCreatablePathWithinRoot(input.scanPath, stripLeadingSlash(item.completedDirectory))
    : null
  const manifest = asManifest(item.sourceManifest)
  const newMedia = asMediaSnapshot(item.newMediaSnapshot)
  const targetFiles = asTargetFileSnapshot(item.targetFileSnapshot)
  const installedNewMedia = buildInstalledNewMediaSnapshot(item.targetDirectory, manifest, newMedia)
  const mutate = <T>(mutation: () => Promise<T>) => withPendingReplaceMutationLease(input, mutation)
  try {
    await assertArtworkMediaFilesSnapshot(input.scanPath, installedNewMedia)
  } catch (error) {
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.SUCCESS,
      error: error instanceof Error ? error.message : '当前媒体文件快照校验失败',
      finishedAt: new Date()
    })
    throw error
  }
  await assertBackupDirectoryFilesSnapshot(backupAbsolute, targetFiles)
  await assertPendingReplaceLease(input)
  const backupBytes = targetFiles.reduce((sum, file) => sum + file.size, 0)
  const completedOriginallyExisted = Boolean(completedAbsolute && (await pathExists(completedAbsolute)))
  let databaseCommitted = false
  let oldRestoreStarted = item.status === PendingReplaceItemStatus.RESTORE_SWAPPING
  const cleanupCommittedRestoreBackup = async () => {
    try {
      await mutate(() => fs.rm(backupAbsolute, { recursive: true, force: true }))
    } catch (error) {
      if (error instanceof PendingReplaceLeaseLostError) return
      await updatePendingReplaceItemsWithLease(input, {
        where: { id: item.id, status: PendingReplaceItemStatus.RESTORED },
        data: {
          error: `旧媒体已恢复，但清理空备份目录失败: ${error instanceof Error ? error.message : '未知错误'}`
        }
      }).catch((writeError) => {
        logger.error('Failed to persist pending replacement restore cleanup warning', {
          error: writeError,
          itemId: item.id
        })
      })
    }
  }

  await updatePendingReplaceItemWithLease(input, item.id, {
    status: PendingReplaceItemStatus.RESTORING,
    error: null,
    finishedAt: null
  })

  try {
    if (completedAbsolute && completedOriginallyExisted) {
      await mutate(async () => {
        await fs.rename(completedAbsolute, pendingAbsolute)
        await fs.rm(path.join(pendingAbsolute, PENDING_REPLACE_MANIFEST_FILE), { force: true })
      })
    } else {
      await mutate(() => fs.mkdir(pendingAbsolute, { recursive: true }))
    }
    for (const media of newMedia) {
      await assertPendingReplaceLease(input)
      await mutate(() =>
        moveIfExists(path.join(targetAbsolute, media.targetName), path.join(pendingAbsolute, media.sourceName))
      )
    }
    for (const chapter of manifest.filter((file) => file.kind === 'chapter' && file.targetName)) {
      await assertPendingReplaceLease(input)
      await mutate(() =>
        moveIfExists(path.join(targetAbsolute, chapter.targetName!), path.join(pendingAbsolute, chapter.name))
      )
    }
    await updatePendingReplaceItemWithLease(input, item.id, {
      status: PendingReplaceItemStatus.RESTORE_SWAPPING
    })
    oldRestoreStarted = true
    for (const targetFile of targetFiles) {
      await assertPendingReplaceLease(input)
      await mutate(async () => {
        const destination = path.join(targetAbsolute, targetFile.name)
        await assertFileAbsent(destination, `恢复目标已存在同名文件: ${targetFile.name}`)
        await fs.rename(path.join(backupAbsolute, targetFile.name), destination)
      })
    }
    await assertPendingReplaceLease(input)

    const scannedMedia = await scanLocalArtworkMediaDirectory({
      scanPath: input.scanPath,
      targetDirectoryRelativePath: item.targetDirectory
    })
    const oldMedia = asMediaSnapshot(item.oldMediaSnapshot)
    const oldOrder = new Map(oldMedia.map((media) => [normalizeStoredPath(media.path), media.order]))
    const restoredFiles = scannedMedia.filesMeta
      .filter((media) => oldOrder.has(normalizeStoredPath(media.path)))
      .sort(
        (a, b) =>
          (oldOrder.get(normalizeStoredPath(a.path)) ?? Number.MAX_SAFE_INTEGER) -
          (oldOrder.get(normalizeStoredPath(b.path)) ?? Number.MAX_SAFE_INTEGER)
      )
    if (restoredFiles.length !== oldMedia.length) {
      throw new Error(`恢复后的数据库媒体数校验失败：预期 ${oldMedia.length}，实际 ${restoredFiles.length}`)
    }
    restoredFiles.forEach((media, order) => {
      media.order = order
    })
    const restoredFileNames = new Set(restoredFiles.map((media) => media.fileName))
    const restoredChapters = scannedMedia.chaptersMeta.filter((chapter) =>
      restoredFileNames.has(chapter.videoFileName)
    )

    await prisma.$transaction(async (tx) => {
      await assertPendingReplaceTransactionLease(tx, input)
      await assertArtworkDatabaseSnapshot(tx, item.artworkId!, installedNewMedia)
      await updateArtworkImagesWithTransactionClient(
        tx,
        item.artworkId!,
        restoredFiles,
        restoredChapters
      )
      await tx.pendingReplaceItem.update({
        where: { id: item.id },
        data: {
          status: PendingReplaceItemStatus.RESTORED,
          backupDirectory: null,
          completedDirectory: null,
          finishedAt: new Date()
        }
      })
      await tx.pendingReplaceBatch.update({
        where: { id: item.batchId },
        data: { backupBytes: { decrement: backupBytes }, restoredItems: { increment: 1 } }
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    databaseCommitted = true
    await cleanupCommittedRestoreBackup()
    return { success: true }
  } catch (error) {
    if (
      error instanceof PendingReplaceLeaseLostError ||
      error instanceof PendingReplaceCommitOutcomeUnknownError
    ) {
      throw error
    }
    if (databaseCommitted) {
      logger.error('Pending replacement restore failed after its database transaction committed', {
        error,
        itemId: item.id
      })
      return { success: true }
    }
    let persistedStatus: PendingReplaceItemStatus
    try {
      await assertPendingReplaceLease(input)
      const persisted = await prisma.pendingReplaceItem.findUnique({
        where: { id: item.id },
        select: { status: true }
      })
      if (!persisted) throw new Error('替换项目不存在')
      persistedStatus = persisted.status
      await assertPendingReplaceLease(input)
    } catch (readError) {
      if (readError instanceof PendingReplaceLeaseLostError) throw readError
      throw new PendingReplaceCommitOutcomeUnknownError('restore')
    }
    if (persistedStatus === PendingReplaceItemStatus.RESTORED) {
      databaseCommitted = true
      logger.warn('Restore commit succeeded although its transaction response failed', {
        error,
        itemId: item.id
      })
      await cleanupCommittedRestoreBackup()
      return { success: true }
    }
    if (!restoreRollbackStatuses.has(persistedStatus)) {
      throw new PendingReplaceCommitOutcomeUnknownError('restore')
    }

    const rollbackErrors: string[] = []
    try {
      if (oldRestoreStarted) {
        await mutate(() => fs.mkdir(backupAbsolute, { recursive: true }))
        for (const targetFile of targetFiles) {
          await assertPendingReplaceLease(input)
          await mutate(() =>
            moveIfExists(
              path.join(targetAbsolute, targetFile.name),
              path.join(backupAbsolute, targetFile.name)
            )
          )
        }
      }
      for (const media of newMedia) {
        await assertPendingReplaceLease(input)
        await mutate(() =>
          moveIfExists(path.join(pendingAbsolute, media.sourceName), path.join(targetAbsolute, media.targetName))
        )
      }
      for (const chapter of manifest.filter((file) => file.kind === 'chapter' && file.targetName)) {
        await assertPendingReplaceLease(input)
        await mutate(() =>
          moveIfExists(path.join(pendingAbsolute, chapter.name), path.join(targetAbsolute, chapter.targetName!))
        )
      }
      if (completedAbsolute && completedOriginallyExisted) {
        await mutate(async () => {
          await fs.writeFile(
            path.join(pendingAbsolute, PENDING_REPLACE_MANIFEST_FILE),
            JSON.stringify({ batchId: item.batchId, itemId: item.id, externalId: item.externalId }, null, 2),
            'utf8'
          )
          await fs.mkdir(path.dirname(completedAbsolute), { recursive: true })
          await fs.rename(pendingAbsolute, completedAbsolute)
        })
      } else {
        await mutate(() => removeEmptyDirectory(pendingAbsolute))
      }
    } catch (rollbackError) {
      if (rollbackError instanceof PendingReplaceLeaseLostError) throw rollbackError
      rollbackErrors.push(`恢复操作回滚失败: ${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`)
    }
    await updatePendingReplaceItemWithLease(input, item.id, {
      status:
        rollbackErrors.length > 0
          ? PendingReplaceItemStatus.FAILED
          : PendingReplaceItemStatus.SUCCESS,
      error: rollbackErrors.length > 0 ? rollbackErrors.join('\n') : null,
      finishedAt: new Date()
    })
    throw new Error(`恢复旧媒体失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

export async function settleFailedPendingReplaceRestore(input: {
  itemId: string
  message: string
  jobId: string
  leaseAttempt: number
}) {
  await prisma.$transaction(async (tx) => {
    await assertPendingReplaceTransactionLease(tx, input)
    await tx.pendingReplaceItem.updateMany({
      where: { id: input.itemId, status: PendingReplaceItemStatus.RESTORING },
      data: { status: PendingReplaceItemStatus.SUCCESS, error: input.message, finishedAt: new Date() }
    })
    await tx.pendingReplaceItem.updateMany({
      where: { id: input.itemId, status: PendingReplaceItemStatus.RESTORE_SWAPPING },
      data: { status: PendingReplaceItemStatus.FAILED, error: input.message, finishedAt: new Date() }
    })
  })
}

export async function cleanupPendingReplaceBackups(input: {
  scanPath: string
  batchId: string
  jobId?: string
  leaseAttempt?: number
}) {
  const batch = await prisma.pendingReplaceBatch.findUnique({ where: { id: input.batchId } })
  if (!batch) throw new Error('Pending replacement batch not found')

  const cleanupItems = await prisma.pendingReplaceItem.findMany({
    where: {
      batchId: input.batchId,
      status: PendingReplaceItemStatus.SUCCESS,
      backupDirectory: { not: null }
    },
    select: { id: true, externalId: true, backupDirectory: true, targetFileSnapshot: true }
  })
  await assertPendingReplaceLease(input)
  for (const item of cleanupItems) {
    await assertPendingReplaceLease(input)
    if (!item.externalId || !item.backupDirectory) throw new Error('成功项目缺少备份路径，拒绝清理')
    const externalId = pendingReplaceExternalIdSchema.parse(item.externalId)
    const expectedRelative = path.posix.join(PENDING_REPLACE_BACKUP_DIRECTORY, input.batchId, externalId)
    if (normalizeStoredPath(item.backupDirectory) !== normalizeStoredPath(expectedRelative)) {
      throw new Error(`备份路径与项目不一致，拒绝清理: ${item.id}`)
    }
    const backupAbsolute = await resolveCreatablePathWithinRoot(input.scanPath, expectedRelative)
    if (!(await pathExists(backupAbsolute))) continue
    const targetFiles = asTargetFileSnapshot(item.targetFileSnapshot)
    await assertBackupDirectoryFileSubsetSnapshot(backupAbsolute, targetFiles)
    for (const targetFile of targetFiles) {
      const backupFile = path.join(backupAbsolute, targetFile.name)
      if (!(await pathExists(backupFile))) continue
      await withPendingReplaceMutationLease(input, () => fs.unlink(backupFile))
    }
    await withPendingReplaceMutationLease(input, () => removeEmptyDirectory(backupAbsolute))
    if (await pathExists(backupAbsolute)) {
      throw new Error(`备份目录仍有未识别文件，拒绝清理: ${item.id}`)
    }
  }
  await assertPendingReplaceLease(input)
  await prisma.$transaction(async (tx) => {
    await assertPendingReplaceTransactionLease(tx, input)
    await tx.pendingReplaceItem.updateMany({
      where: {
        id: { in: cleanupItems.map((item) => item.id) },
        batchId: input.batchId,
        status: PendingReplaceItemStatus.SUCCESS
      },
      data: { status: PendingReplaceItemStatus.BACKUP_CLEANED, backupDirectory: null }
    })
    await tx.pendingReplaceBatch.update({ where: { id: input.batchId }, data: { backupBytes: 0 } })
  })
  return { success: true }
}

export async function syncPendingReplaceBatchCounters(batchId: string) {
  const [batch, grouped] = await Promise.all([
    prisma.pendingReplaceBatch.findUniqueOrThrow({ where: { id: batchId } }),
    prisma.pendingReplaceItem.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } })
  ])
  const count = (statuses: PendingReplaceItemStatus[]) =>
    grouped.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0)
  const counters = {
    totalItems: grouped.reduce((sum, row) => sum + row._count._all, 0),
    readyItems: count([PendingReplaceItemStatus.READY]),
    invalidItems: count([PendingReplaceItemStatus.INVALID]),
    excludedItems: count([PendingReplaceItemStatus.EXCLUDED]),
    succeededItems: count([PendingReplaceItemStatus.SUCCESS, PendingReplaceItemStatus.BACKUP_CLEANED]),
    failedItems: count([PendingReplaceItemStatus.FAILED]),
    restoredItems: count([PendingReplaceItemStatus.RESTORED]),
    backupBytes: batch.backupBytes
  }
  await prisma.pendingReplaceBatch.update({ where: { id: batchId }, data: counters })
  return counters
}
