import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const ARCHIVE_INTAKE_RETENTION_DAYS = 30
export const ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE = 200

const TERMINAL_INTAKE_STATUSES = ['FAILED', 'ENQUEUED', 'CANCELLED', 'DUPLICATE'] as const

export interface ArchiveIntakeRetentionCleanupResult {
  deletedBulkOperations: number
  deletedIntakeItems: number
  deletedSubmissions: number
  deletedPreviewSessions: number
  retentionDays: number
  cutoff: string
}

/**
 * Deletes only disposable intake/audit history. Archive imports, queue jobs,
 * published entities, revisions, and media are deliberately outside this
 * operation's query surface and cannot be selected for deletion here.
 */
export async function cleanupArchiveIntakeHistory(
  input: MaintenanceOperationInput & { retentionDays?: number; now?: Date }
): Promise<ArchiveIntakeRetentionCleanupResult> {
  const retentionDays = input.retentionDays ?? ARCHIVE_INTAKE_RETENTION_DAYS
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('Archive intake retention days must be a positive integer')
  }

  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000)
  let deletedBulkOperations = 0
  let deletedIntakeItems = 0
  let deletedSubmissions = 0
  let deletedPreviewSessions = 0

  await input.progress({
    percentage: 2,
    stage: 'BULK_OPERATIONS',
    message: '正在清理已完成的归档批量操作历史...'
  })
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.archiveBulkOperation.findMany({
      where: { completedAt: { lt: cutoff } },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      take: ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break

    // 每批先读 ID 列表，再在事务内重放同样条件删除，避免候选在窗口内被更新/复活后误删。
    const deleted = await input.mutate((transaction) =>
      transaction.archiveBulkOperation.deleteMany({
        where: {
          id: { in: batch.map(({ id }) => id) },
          completedAt: { lt: cutoff }
        }
      })
    )
    deletedBulkOperations += deleted.count
    await reportProgress(input, 25, 'BULK_OPERATIONS', '已清理归档批量操作历史', {
      deletedBulkOperations,
      deletedIntakeItems,
      deletedSubmissions,
      deletedPreviewSessions
    })
  }

  await input.progress({
    percentage: 30,
    stage: 'INTAKE_ITEMS',
    message: '正在清理终态归档收件记录...'
  })
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.archiveIntakeItem.findMany({
      where: {
        status: { in: [...TERMINAL_INTAKE_STATUSES] },
        finishedAt: { lt: cutoff }
      },
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      take: ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break

    // 同一批的 id 快照只用于限定范围，真实删除仍以截止时间与终态谓词再次确认。
    const deleted = await input.mutate((transaction) =>
      transaction.archiveIntakeItem.deleteMany({
        where: {
          id: { in: batch.map(({ id }) => id) },
          status: { in: [...TERMINAL_INTAKE_STATUSES] },
          finishedAt: { lt: cutoff }
        }
      })
    )
    deletedIntakeItems += deleted.count
    await reportProgress(input, 55, 'INTAKE_ITEMS', '已清理终态归档收件记录', {
      deletedBulkOperations,
      deletedIntakeItems,
      deletedSubmissions,
      deletedPreviewSessions
    })
  }

  await input.progress({
    percentage: 60,
    stage: 'SUBMISSIONS',
    message: '正在清理空的归档收件批次...'
  })
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.archiveIntakeSubmission.findMany({
      where: { createdAt: { lt: cutoff }, items: { none: {} } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break

    // 同名的“先选后删”模型用于分页，但事务内复核能避免与并发写入形成错删。
    const deleted = await input.mutate((transaction) =>
      transaction.archiveIntakeSubmission.deleteMany({
        where: {
          id: { in: batch.map(({ id }) => id) },
          createdAt: { lt: cutoff },
          items: { none: {} }
        }
      })
    )
    deletedSubmissions += deleted.count
    await reportProgress(input, 80, 'SUBMISSIONS', '已清理空的归档收件批次', {
      deletedBulkOperations,
      deletedIntakeItems,
      deletedSubmissions,
      deletedPreviewSessions
    })
  }

  await input.progress({
    percentage: 85,
    stage: 'PREVIEW_SESSIONS',
    message: '正在清理过期的归档预览会话...'
  })
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.archivePreviewSession.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break

    // 每批会话清理同样通过“批次 id + 截止条件”双重校验，确保长期运行时仍只删过期历史。
    const deleted = await input.mutate((transaction) =>
      transaction.archivePreviewSession.deleteMany({
        where: {
          id: { in: batch.map(({ id }) => id) },
          expiresAt: { lte: now }
        }
      })
    )
    deletedPreviewSessions += deleted.count
    await reportProgress(input, 99, 'PREVIEW_SESSIONS', '已清理过期的归档预览会话', {
      deletedBulkOperations,
      deletedIntakeItems,
      deletedSubmissions,
      deletedPreviewSessions
    })
  }

  throwIfMaintenanceAborted(input.signal)
  const result = {
    deletedBulkOperations,
    deletedIntakeItems,
    deletedSubmissions,
    deletedPreviewSessions,
    retentionDays,
    cutoff: cutoff.toISOString()
  }
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: '归档收件历史清理完成',
    data: result
  })
  return result
}

function reportProgress(
  input: MaintenanceOperationInput,
  percentage: number,
  stage: string,
  message: string,
  data: Pick<
    ArchiveIntakeRetentionCleanupResult,
    'deletedBulkOperations' | 'deletedIntakeItems' | 'deletedSubmissions' | 'deletedPreviewSessions'
  >
) {
  return input.progress({ percentage, stage, message, data })
}
