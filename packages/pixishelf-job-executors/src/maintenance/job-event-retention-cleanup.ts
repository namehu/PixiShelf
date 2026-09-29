import type { Prisma } from '@pixishelf/db'
import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const JOB_PROGRESS_EVENT_RETENTION_DAYS = 7
export const JOB_LIFECYCLE_EVENT_RETENTION_DAYS = 90
export const JOB_EVENT_RETENTION_BATCH_SIZE = 5_000

export interface JobEventRetentionCleanupResult {
  diagnosticReportCandidates: number
  diagnosticItemCandidates: number
  expiredDiagnosticReports: number
  deletedDiagnosticItems: number
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
  throwIfMaintenanceAborted(input.signal)
  const diagnostics = await cleanupDiagnosticReports(input, now)
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
      ? `事件清理预检完成：进度事件 ${progressCandidates} 条，生命周期事件 ${lifecycleCandidates} 条，诊断报告 ${diagnostics.diagnosticReportCandidates} 份、明细 ${diagnostics.diagnosticItemCandidates} 条`
      : `准备分批清理 ${progressCandidates + lifecycleCandidates} 条过期任务事件`,
    data: { dryRun: input.dryRun, progressCandidates, lifecycleCandidates, ...diagnostics },
    forcePersistence: true
  })
  if (input.dryRun) {
    return {
      ...diagnostics,
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
    message: `任务事件清理完成：删除 ${deletedProgressEvents + deletedLifecycleEvents} 条事件、${diagnostics.deletedDiagnosticItems} 条诊断明细`,
    data: { deletedProgressEvents, deletedLifecycleEvents, ...diagnostics },
    forcePersistence: true
  })
  return {
    ...diagnostics,
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
  // Select IDs before deleting so each transaction stays bounded. Dry-run
  // returns before this helper; the global monotonic cursor lets reconnects
  // continue from newer IDs without requiring a retained cursor row.
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

// Keep report counts after expiry, but delete evidence in bounded item batches. An
// interrupted cleanup resumes from remaining rows without reopening closed reports.
async function cleanupDiagnosticReports(input: MaintenanceOperationInput & { dryRun: boolean }, now: Date) {
  const result = {
    diagnosticReportCandidates: 0,
    diagnosticItemCandidates: 0,
    expiredDiagnosticReports: 0,
    deletedDiagnosticItems: 0
  }
  const reports = input.database.systemJobDiagnosticReport
  const items = input.database.systemJobDiagnosticItem
  if (!reports || !items) return result
  const where: Prisma.SystemJobDiagnosticReportWhereInput = {
    status: 'CLOSED',
    expiresAt: { lte: now },
    expiredAt: null
  }
  result.diagnosticReportCandidates = await reports.count({ where })
  result.diagnosticItemCandidates = await items.count({ where: { report: where } })
  if (input.dryRun) return result
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await reports.findMany({ where, orderBy: { id: 'asc' }, take: 100, select: { id: true } })
    if (batch.length === 0) break
    for (const report of batch) {
      while (true) {
        throwIfMaintenanceAborted(input.signal)
        const deleted = await input.mutate(async (transaction) => {
          // Revalidate eligibility in the fenced transaction before touching evidence.
          const eligible = await transaction.systemJobDiagnosticReport.findFirst({
            where: { ...where, id: report.id },
            select: { id: true }
          })
          if (!eligible) return { done: true, count: 0, expired: 0 }
          const rows = await transaction.systemJobDiagnosticItem.findMany({
            where: { reportId: report.id },
            orderBy: { id: 'asc' },
            take: JOB_EVENT_RETENTION_BATCH_SIZE,
            select: { id: true }
          })
          const count =
            rows.length === 0
              ? 0
              : (
                  await transaction.systemJobDiagnosticItem.deleteMany({
                    where: { reportId: report.id, id: { in: rows.map((row) => row.id) } }
                  })
                ).count
          const done = rows.length < JOB_EVENT_RETENTION_BATCH_SIZE
          const expired = done
            ? (
                await transaction.systemJobDiagnosticReport.updateMany({
                  where: { ...where, id: report.id },
                  data: { expiredAt: now }
                })
              ).count
            : 0
          return { done, count, expired }
        })
        result.deletedDiagnosticItems += deleted.count
        result.expiredDiagnosticReports += deleted.expired
        await input.progress({
          percentage: 1,
          stage: 'DELETING_DIAGNOSTICS',
          message: '正在分批清理过期任务诊断',
          data: { ...result }
        })
        if (deleted.done) break
      }
    }
  }
  return result
}
