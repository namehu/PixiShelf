import type { Prisma } from '@pixishelf/db'
import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const JOB_PROGRESS_EVENT_RETENTION_DAYS = 7
export const JOB_LIFECYCLE_EVENT_RETENTION_DAYS = 90
export const JOB_EVENT_RETENTION_BATCH_SIZE = 5_000

export interface JobEventRetentionCleanupResult {
  dryRun: boolean
  progressCandidates: number
  lifecycleCandidates: number
  deletedProgressEvents: number
  deletedLifecycleEvents: number
}

export async function cleanupJobEvents(
  input: MaintenanceOperationInput & { dryRun: boolean; now?: Date }
): Promise<JobEventRetentionCleanupResult> {
  const now = input.now ?? new Date()
  const progressCutoff = daysBefore(now, JOB_PROGRESS_EVENT_RETENTION_DAYS)
  const lifecycleCutoff = daysBefore(now, JOB_LIFECYCLE_EVENT_RETENTION_DAYS)
  const progressWhere: Prisma.SystemJobEventWhereInput = {
    type: 'job.progress',
    level: 'INFO',
    createdAt: { lt: progressCutoff }
  }
  const lifecycleWhere: Prisma.SystemJobEventWhereInput = {
    OR: [{ type: { not: 'job.progress' } }, { level: { in: ['WARN', 'ERROR'] } }],
    createdAt: { lt: lifecycleCutoff }
  }
  const [progressCandidates, lifecycleCandidates] = await Promise.all([
    input.database.systemJobEvent.count({ where: progressWhere }),
    input.database.systemJobEvent.count({ where: lifecycleWhere })
  ])

  await input.progress({
    percentage: input.dryRun ? 100 : 5,
    stage: input.dryRun ? 'DRY_RUN_COMPLETED' : 'DELETING_PROGRESS_EVENTS',
    message: input.dryRun
      ? `事件清理预检完成：进度事件 ${progressCandidates} 条，生命周期事件 ${lifecycleCandidates} 条`
      : `准备分批清理 ${progressCandidates + lifecycleCandidates} 条过期任务事件`,
    data: { dryRun: input.dryRun, progressCandidates, lifecycleCandidates },
    forcePersistence: true
  })
  if (input.dryRun) {
    return {
      dryRun: true,
      progressCandidates,
      lifecycleCandidates,
      deletedProgressEvents: 0,
      deletedLifecycleEvents: 0
    }
  }

  const total = progressCandidates + lifecycleCandidates
  let deletedProgressEvents = 0
  let deletedLifecycleEvents = 0
  deletedProgressEvents = await deleteInBatches(input, progressWhere, async (deleted) => {
    await input.progress({
      percentage: progressPercent(deleted, 0, total),
      stage: 'DELETING_PROGRESS_EVENTS',
      message: `已清理 ${deleted} 条过期进度事件`,
      data: { deletedProgressEvents: deleted, deletedLifecycleEvents: 0 }
    })
  })
  deletedLifecycleEvents = await deleteInBatches(input, lifecycleWhere, async (deleted) => {
    await input.progress({
      percentage: progressPercent(deletedProgressEvents, deleted, total),
      stage: 'DELETING_LIFECYCLE_EVENTS',
      message: `已清理 ${deletedProgressEvents + deleted} 条过期任务事件`,
      data: { deletedProgressEvents, deletedLifecycleEvents: deleted }
    })
  })
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `任务事件清理完成：删除 ${deletedProgressEvents + deletedLifecycleEvents} 条`,
    data: { deletedProgressEvents, deletedLifecycleEvents },
    forcePersistence: true
  })
  return {
    dryRun: false,
    progressCandidates,
    lifecycleCandidates,
    deletedProgressEvents,
    deletedLifecycleEvents
  }
}

async function deleteInBatches(
  input: MaintenanceOperationInput,
  where: Prisma.SystemJobEventWhereInput,
  onBatch: (deleted: number) => Promise<void>
): Promise<number> {
  let deleted = 0
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const rows = await input.database.systemJobEvent.findMany({
      where,
      orderBy: { id: 'asc' },
      take: JOB_EVENT_RETENTION_BATCH_SIZE,
      select: { id: true }
    })
    if (rows.length === 0) return deleted
    const result = await input.mutate((transaction) =>
      transaction.systemJobEvent.deleteMany({ where: { id: { in: rows.map(({ id }) => id) } } })
    )
    deleted += result.count
    await onBatch(deleted)
    if (rows.length < JOB_EVENT_RETENTION_BATCH_SIZE) return deleted
  }
}

function progressPercent(progressDeleted: number, lifecycleDeleted: number, total: number) {
  return total === 0 ? 99 : Math.min(99, 5 + Math.floor(((progressDeleted + lifecycleDeleted) / total) * 94))
}

function daysBefore(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000)
}
