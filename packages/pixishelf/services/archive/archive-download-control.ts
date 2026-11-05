import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  ARCHIVE_COVERAGE_DEFINITION_VERSION,
  ARCHIVE_ORIGINAL_UPGRADE_DEFINITION_VERSION,
  type ArchiveDownloadPreparation
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { writeJobEvents, type JobEventWriteInput } from '@/services/background-task/job-event-service'
import {
  archiveRequestFingerprint,
  getArchiveBulkOperation,
  type ArchiveBulkTargetResult
} from './archive-bulk-operation'
import { archiveImportDefaultTagIdsForRetry } from './archive-job-payload'
import { canUseArchiveDisplayQuality } from './archive-task-action-policy'
import { ArchiveError } from './errors'

export interface ArchiveDownloadControlInput {
  idempotencyKey: string
  taskIds: string[]
  action: 'RETRY' | 'RESUME'
  requestedByUserId: string
  retryItemId?: string
  useDisplayQuality?: boolean
  expectedSystemJobId?: string
}

const targetSelect = {
  id: true,
  phase: true,
  status: true,
  systemJobId: true,
  cleanupRequestedAt: true,
  providerKey: true,
  externalId: true,
  origin: true,
  sourceTotalItems: true,
  completionBaseRevisionId: true,
  upgradeBaseRevisionId: true,
  selectedQuality: true,
  sealedManifestSha256: true,
  completedItems: true,
  totalItems: true,
  failedItems: true,
  errorCode: true,
  systemJob: {
    select: {
      id: true,
      type: true,
      status: true,
      definitionVersion: true,
      payload: true,
      queuePriority: true,
      triggerSource: true,
      maxAttempts: true,
      attempt: true
    }
  }
} satisfies Prisma.ArchiveImportSelect

/** DOWNLOAD control commits only queue state; the fenced Worker prepares media on start. */
export async function controlArchiveDownloads(
  input: ArchiveDownloadControlInput,
  dependencies: { database?: PrismaClient; now?: () => Date; uuid?: () => string } = {}
) {
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  const timestamp = dependencies.now?.() ?? new Date()
  const uuid = dependencies.uuid ?? randomUUID
  const taskIds = [...new Set(input.taskIds)].sort()
  const preparation: ArchiveDownloadPreparation = input.retryItemId
    ? { scope: 'ITEM', itemId: input.retryItemId }
    : { scope: 'ALL_INCOMPLETE' }
  const requestHash = archiveRequestFingerprint({
    commandType: input.action,
    targetType: 'ARCHIVE_IMPORT',
    targetIds: taskIds,
    requestOptions: {
      scope: 'DOWNLOAD',
      ...(input.retryItemId ? { retryItemId: input.retryItemId } : {}),
      ...(input.useDisplayQuality ? { useDisplayQuality: true } : {}),
      ...(input.expectedSystemJobId ? { expectedSystemJobId: input.expectedSystemJobId } : {})
    }
  })

  const operationId = await database.$transaction(async (transaction) => {
    // The unique key serializes creation. Lock the persisted header before checking or replaying it.
    await transaction.archiveBulkOperation.createMany({
      data: [
        {
          id: uuid(),
          idempotencyKey: input.idempotencyKey,
          requestHash,
          commandType: input.action,
          requestedByUserId: input.requestedByUserId,
          requestedCount: taskIds.length
        }
      ],
      skipDuplicates: true
    })
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM archive_bulk_operations
      WHERE "idempotencyKey" = ${input.idempotencyKey} FOR UPDATE
    `)
    const operation = await transaction.archiveBulkOperation.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey }
    })
    if (
      operation.requestHash !== requestHash ||
      operation.commandType !== input.action ||
      operation.requestedCount !== taskIds.length ||
      operation.requestedByUserId !== input.requestedByUserId
    ) {
      throw new ArchiveError('STATE_CONFLICT', '该幂等键已绑定到不同的批量归档命令')
    }
    if (operation.completedAt) return operation.id

    const snapshots = await transaction.archiveImport.findMany({ where: { id: { in: taskIds } }, select: targetSelect })
    const snapshotsById = new Map(snapshots.map((task) => [task.id, task]))
    const results = new Map<string, ArchiveBulkTargetResult>()
    const candidateJobIds = snapshots
      .filter((task) => task.phase === 'DOWNLOAD')
      .map((task) => task.systemJobId)
      .sort()
    if (candidateJobIds.length) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM system_jobs WHERE id IN (${Prisma.join(candidateJobIds)}) ORDER BY id FOR UPDATE
      `)
    }
    const tasks = await transaction.archiveImport.findMany({ where: { id: { in: taskIds } }, select: targetSelect })
    const tasksById = new Map(tasks.map((task) => [task.id, task]))
    const candidates: { task: (typeof tasks)[number]; nextJobId: string; defaultTagIds: number[] }[] = []
    const retryItem = input.retryItemId
      ? await transaction.archiveImportItem.findFirst({
          where: { id: input.retryItemId, archiveImportId: { in: taskIds } },
          select: { id: true, archiveImportId: true, status: true }
        })
      : null

    for (const taskId of taskIds) {
      const task = tasksById.get(taskId)
      const snapshot = snapshotsById.get(taskId)
      let invalid: ArchiveBulkTargetResult | null = null
      if (!task) invalid = { result: 'SKIPPED', code: 'NOT_FOUND', message: '归档任务不存在' }
      else if (task.phase !== 'DOWNLOAD') invalid = conflict('PHASE_CONFLICT', '该任务不属于下载阶段，请刷新后重试')
      else if (
        snapshot?.phase !== 'DOWNLOAD' ||
        task.systemJobId !== snapshot.systemJobId ||
        task.status !== snapshot.status ||
        task.systemJob.status !== snapshot.systemJob.status ||
        (input.expectedSystemJobId && task.systemJobId !== input.expectedSystemJobId)
      ) {
        invalid = conflict('STATE_CONFLICT', '归档任务绑定或状态已改变，请刷新后重试')
      } else if (task.cleanupRequestedAt) invalid = conflict('CLEANUP_IN_PROGRESS', '归档任务正在清理暂存文件')
      else if (input.useDisplayQuality && (task.completionBaseRevisionId || task.upgradeBaseRevisionId)) {
        invalid = conflict('STATE_CONFLICT', '补全必须沿用原归档画质；需要更换画质时请通过完整更新重新确认。')
      } else if (input.useDisplayQuality && !canUseArchiveDisplayQuality(task)) {
        invalid = conflict('STATE_CONFLICT', '当前下载任务不能改用展示图，请刷新后重试')
      } else if (
        input.action === 'RESUME'
          ? !(task.systemJob.status === 'PAUSED' && ['PAUSED', 'RUNNING'].includes(task.status))
          : !(
              ['FAILED', 'CANCELLED'].includes(task.systemJob.status) &&
              (['FAILED', 'CANCELLED'].includes(task.status) ||
                (task.status === 'PAUSED' && task.systemJob.status === 'FAILED'))
            )
      ) {
        invalid = { result: 'SKIPPED', code: 'INVALID_STATE', message: `当前状态不允许执行 ${input.action}` }
      } else if (
        input.retryItemId &&
        (task.status !== 'FAILED' ||
          task.errorCode !== 'PARTIAL_FAILURE' ||
          task.failedItems <= 0 ||
          retryItem?.archiveImportId !== task.id ||
          retryItem.status !== 'FAILED')
      ) {
        invalid = conflict('STATE_CONFLICT', '只有部分失败任务中仍处于失败状态的图片可以单张重试')
      }
      if (invalid || !task) {
        results.set(taskId, invalid!)
        continue
      }
      let defaultTagIds: number[] = []
      if (input.action === 'RETRY') {
        try {
          defaultTagIds = archiveImportDefaultTagIdsForRetry(task.systemJob, task.id)
        } catch (error) {
          if (!(error instanceof ArchiveError)) throw error
          results.set(task.id, conflict(error.code, error.message))
          continue
        }
      }
      candidates.push({ task, nextJobId: input.action === 'RETRY' ? uuid() : task.systemJobId, defaultTagIds })
    }

    const active = candidates.length
      ? await transaction.archiveImport.findMany({
          where: {
            status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] },
            OR: candidates.map(({ task }) => ({ providerKey: task.providerKey, externalId: task.externalId }))
          },
          select: { id: true, providerKey: true, externalId: true }
        })
      : []
    const sourceOwners = new Map(active.map((task) => [JSON.stringify([task.providerKey, task.externalId]), task.id]))
    const eligible = candidates.filter(({ task }) => {
      const identity = JSON.stringify([task.providerKey, task.externalId])
      const owner = sourceOwners.get(identity)
      if (owner && owner !== task.id) {
        results.set(task.id, conflict('ACTIVE_SOURCE_CONFLICT', '同一来源已有活动归档任务'))
        return false
      }
      sourceOwners.set(identity, task.id)
      return true
    })
    // This CAS is also the import row lock: never lock imports before the old jobs.
    const changed = eligible.length
      ? await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE archive_imports AS target SET status = 'PENDING', "decisionCode" = NULL,
        "errorCode" = NULL, "errorMessage" = NULL, "finishedAt" = NULL, "retainUntil" = NULL,
        "selectedQuality" = CASE WHEN ${Boolean(input.useDisplayQuality)} THEN 'DISPLAY'::"ArchiveQuality"
          ELSE target."selectedQuality" END, "updatedAt" = ${timestamp}
      FROM (VALUES ${Prisma.join(
        eligible.map(({ task }) => Prisma.sql`(${task.id}, ${task.systemJobId}, ${task.status}::"ArchiveImportStatus")`)
      )}) AS old(id, job_id, status)
      WHERE target.id = old.id AND target."systemJobId" = old.job_id AND target.status = old.status
        AND target.phase = 'DOWNLOAD' AND target."cleanupRequestedAt" IS NULL
      RETURNING target.id
    `)
      : []
    const changedIds = new Set(changed.map((task) => task.id))
    const winners = eligible.filter(({ task }) => {
      if (changedIds.has(task.id)) return true
      results.set(task.id, conflict('STATE_CONFLICT', '归档任务状态已改变，请刷新后重试'))
      return false
    })

    if (winners.length) {
      if (input.action === 'RETRY') {
        await transaction.systemJob.createMany({
          data: winners.map(({ task, nextJobId, defaultTagIds }) => {
            const priority = task.origin === 'AUTO' ? 900 : task.origin === 'MANUAL' ? 10 : task.systemJob.queuePriority
            return {
              id: nextJobId,
              type: 'ARCHIVE_DOWNLOAD',
              executionLane: 'ARCHIVE_DOWNLOAD',
              definitionVersion: task.upgradeBaseRevisionId
                ? ARCHIVE_ORIGINAL_UPGRADE_DEFINITION_VERSION
                : task.sourceTotalItems == null
                  ? 1
                  : ARCHIVE_COVERAGE_DEFINITION_VERSION,
              status: 'PENDING',
              triggerSource:
                task.origin === 'AUTO' ? 'SYSTEM' : task.origin === 'MANUAL' ? 'MANUAL' : task.systemJob.triggerSource,
              requestedByUserId: input.requestedByUserId,
              parentJobId: task.systemJobId,
              payload: { archiveImportId: task.id, defaultTagIds },
              queuePriority: priority,
              effectivePriority: priority,
              availableAt: timestamp,
              maxAttempts: task.systemJob.maxAttempts,
              progress: Math.max(
                1,
                Math.min(95, Math.round((task.completedItems / Math.max(task.totalItems, 1)) * 90) + 5)
              ),
              message: '归档下载重试已入队'
            }
          })
        })
        await transaction.archiveImportExecution.createMany({
          data: winners.map(({ task, nextJobId }) => ({
            jobId: nextJobId,
            archiveImportId: task.id,
            phase: 'DOWNLOAD',
            pendingDownloadPreparation: preparation
          }))
        })
        await transaction.$executeRaw(Prisma.sql`
          UPDATE archive_imports AS target SET "systemJobId" = next.job_id, "updatedAt" = ${timestamp}
          FROM (VALUES ${Prisma.join(winners.map(({ task, nextJobId }) => Prisma.sql`(${task.id}, ${nextJobId})`))})
            AS next(id, job_id) WHERE target.id = next.id
        `)
        await transaction.systemJobFailureAcknowledgement.createMany({
          data: winners
            .filter(({ task }) => task.systemJob.status === 'FAILED')
            .map(({ task }) => ({
              jobId: task.systemJobId,
              acknowledgedAt: timestamp,
              acknowledgedByUserId: input.requestedByUserId,
              source: 'RETRY'
            })),
          skipDuplicates: true
        })
      } else {
        await transaction.systemJob.updateMany({
          where: { id: { in: winners.map(({ task }) => task.systemJobId) }, status: 'PAUSED' },
          data: {
            status: 'PENDING',
            pauseRequestedAt: null,
            availableAt: timestamp,
            errorCode: null,
            error: null,
            workerId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            message: '归档下载继续执行已入队'
          }
        })
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO archive_import_executions ("jobId", "archiveImportId", phase, "pendingDownloadPreparation")
          VALUES ${Prisma.join(winners.map(({ task }) => Prisma.sql`(${task.systemJobId}, ${task.id}, 'DOWNLOAD'::"ArchiveImportPhase", ${JSON.stringify(preparation)}::jsonb)`))}
          ON CONFLICT ("jobId") DO UPDATE SET "pendingDownloadPreparation" = EXCLUDED."pendingDownloadPreparation"
        `)
      }
      await transaction.$executeRaw(Prisma.sql`
        UPDATE archive_uploader_catalog_items AS catalog SET "lastArchiveImportId" = target.id,
          "lastOutcome" = 'SUBMITTED', "lastOutcomeAt" = ${timestamp}, "lastErrorCode" = NULL,
          "lastErrorMessage" = NULL, "updatedAt" = ${timestamp}
        FROM (VALUES ${Prisma.join(winners.map(({ task }) => Prisma.sql`(${task.id}, ${task.providerKey}, ${task.externalId})`))})
          AS target(id, provider, external_id)
        WHERE catalog."lastArchiveImportId" = target.id OR
          (catalog."providerKey" = target.provider AND catalog."externalId" = target.external_id)
      `)
      const events: JobEventWriteInput[] = winners.flatMap(({ task, nextJobId }) => [
        ...(input.action === 'RETRY'
          ? [
              {
                jobId: task.systemJobId,
                type: 'job.retry_scheduled' as const,
                attempt: task.systemJob.attempt,
                message: '归档下载重试已入队',
                data: { retryJobId: nextJobId }
              }
            ]
          : []),
        {
          jobId: nextJobId,
          type: 'job.queued' as const,
          attempt: input.action === 'RETRY' ? 0 : task.systemJob.attempt,
          message: input.action === 'RETRY' ? '归档下载重试已入队' : '归档下载继续执行已入队',
          data: {
            archiveImportId: task.id,
            preparation,
            ...(input.action === 'RETRY' ? { retryOfJobId: task.systemJobId } : { reason: 'RESUME' })
          }
        }
      ])
      await writeJobEvents(transaction, events)
      for (const { task, nextJobId } of winners) results.set(task.id, { result: 'APPLIED', relatedId: nextJobId })
    }
    await transaction.archiveBulkOperationItem.createMany({
      data: taskIds.map((taskId) => ({
        operationId: operation.id,
        targetType: 'ARCHIVE_IMPORT',
        targetId: taskId,
        ...results.get(taskId)!
      }))
    })
    const values = [...results.values()]
    await transaction.archiveBulkOperation.update({
      where: { id: operation.id },
      data: {
        appliedCount: winners.length,
        skippedCount: values.filter((result) => result.result === 'SKIPPED').length,
        conflictCount: values.filter((result) => result.result === 'CONFLICT').length,
        completedAt: dependencies.now?.() ?? new Date()
      }
    })
    return operation.id
  })
  return getArchiveBulkOperation(operationId, database)
}

function conflict(code: string, message: string): ArchiveBulkTargetResult {
  return { result: 'CONFLICT', code, message }
}
