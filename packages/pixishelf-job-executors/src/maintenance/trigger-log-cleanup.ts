import type { MaintenanceOperationInput } from './types.js'
import { throwIfMaintenanceAborted } from './types.js'

export const TRIGGER_LOG_RETENTION_DAYS = 30
export const TRIGGER_LOG_DELETE_BATCH_SIZE = 500

export interface TriggerLogCleanupResult {
  deletedLogs: number
  retentionDays: number
  cutoff: string
}

export async function cleanupTriggerLogs(
  input: MaintenanceOperationInput & { retentionDays?: number; now?: Date }
): Promise<TriggerLogCleanupResult> {
  const retentionDays = input.retentionDays ?? TRIGGER_LOG_RETENTION_DAYS
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('Trigger log retention days must be a positive integer')
  }

  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000)
  const total = await input.database.triggerLog.count({ where: { created_at: { lt: cutoff } } })
  let deletedLogs = 0
  await input.progress({
    percentage: total === 0 ? 100 : 5,
    stage: 'DISCOVERING',
    message: total === 0 ? '没有需要清理的触发器日志' : `发现 ${total} 条过期触发器日志`,
    data: { total, deleted: 0 }
  })

  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.triggerLog.findMany({
      where: { created_at: { lt: cutoff } },
      orderBy: { id: 'asc' },
      take: TRIGGER_LOG_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break
    const result = await input.mutate((transaction) =>
      transaction.triggerLog.deleteMany({
        where: { id: { in: batch.map(({ id }) => id) }, created_at: { lt: cutoff } }
      })
    )
    deletedLogs += result.count
    await input.progress({
      percentage: Math.min(99, 5 + Math.floor((deletedLogs / Math.max(1, total)) * 94)),
      stage: 'DELETING',
      message: `已清理 ${deletedLogs}/${total} 条触发器日志`,
      data: { total, deleted: deletedLogs }
    })
  }

  throwIfMaintenanceAborted(input.signal)
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `触发器日志清理完成，共删除 ${deletedLogs} 条`,
    data: { total, deleted: deletedLogs }
  })
  return { deletedLogs, retentionDays, cutoff: cutoff.toISOString() }
}
