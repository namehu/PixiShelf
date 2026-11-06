import type { ArchiveBulkTargetResult } from './archive-bulk-operation'

export type ArchiveTaskBulkAction = 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY'

export function canUseArchiveDisplayQuality(task: {
  phase: string
  status: string
  selectedQuality: string
  completionBaseRevisionId: string | null
  upgradeBaseRevisionId: string | null
  sealedManifestSha256: string | null
  cleanupRequestedAt: Date | null
  systemJob: { status: string }
}): boolean {
  return (
    task.phase === 'DOWNLOAD' &&
    task.selectedQuality === 'ORIGINAL' &&
    !task.completionBaseRevisionId &&
    !task.upgradeBaseRevisionId &&
    !task.sealedManifestSha256 &&
    !task.cleanupRequestedAt &&
    ((task.status === 'PAUSED' && task.systemJob.status === 'PAUSED') ||
      (task.status === 'FAILED' && ['FAILED', 'CANCELLED'].includes(task.systemJob.status)))
  )
}

const allowedImportStatuses: Record<ArchiveTaskBulkAction, readonly string[]> = {
  PAUSE: ['PENDING', 'RUNNING'],
  RESUME: ['PAUSED'],
  CANCEL: ['PENDING', 'RUNNING', 'PAUSED'],
  RETRY: ['FAILED', 'CANCELLED']
}

// 新 operation 只接受白名单状态；同幂等键的重放由已持久化的 operation item 负责，不在这里放宽状态。
export function archiveTaskActionIneligibility(
  status: string,
  action: ArchiveTaskBulkAction
): ArchiveBulkTargetResult | null {
  return allowedImportStatuses[action].includes(status)
    ? null
    : { result: 'SKIPPED', code: 'INVALID_STATE', message: `状态 ${status} 不允许执行 ${action}` }
}

export function recoverAppliedArchiveTaskAction(
  task: { status: string; systemJobId: string },
  action: ArchiveTaskBulkAction
): ArchiveBulkTargetResult | null {
  const applied =
    (action === 'PAUSE' && task.status === 'PAUSED') ||
    (action === 'RESUME' && task.status === 'PENDING') ||
    (action === 'CANCEL' && ['CANCELLED', 'CANCELLING'].includes(task.status)) ||
    (action === 'RETRY' && task.status === 'PENDING')
  return applied ? { result: 'REUSED', relatedId: task.systemJobId, message: `并发命令已执行 ${action}` } : null
}
