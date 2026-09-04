import type { ScheduledTaskView } from './task-ui'
import { formatTaskStatus } from './task-status'

export function StandaloneTaskFeedback({ task }: { task: ScheduledTaskView }) {
  if (!task.lastJobId) return null
  const result = task.lastJobResult
  const status = formatTaskStatus(task.lastJobStatus)
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      <span>
        模式：
        <strong className="font-medium text-foreground">
          {task.lastJobMode === 'PREVIEW' ? '预览（只读）' : '正式执行'}
        </strong>
      </span>
      <span>
        状态：<strong className="font-medium text-foreground">{status}</strong>
      </span>
      {result && task.key === 'trigger_log_retention_cleanup' && (
        <span>
          删除日志：<strong className="font-medium text-foreground">{result.deletedLogs ?? 0}</strong>
        </span>
      )}
      {result && task.key === 'scan_run_retention_cleanup' && (
        <span>
          删除扫描记录：<strong className="font-medium text-foreground">{result.deletedRuns ?? 0}</strong>
        </span>
      )}
      {result && task.key === 'job_event_retention_cleanup' && (
        <>
          <span>
            进度候选：<strong className="font-medium text-foreground">{result.progressCandidates ?? 0}</strong>
          </span>
          <span>
            审计候选：<strong className="font-medium text-foreground">{result.lifecycleCandidates ?? 0}</strong>
          </span>
          <span>
            已删除：
            <strong className="font-medium text-foreground">
              {(result.deletedProgressEvents ?? 0) + (result.deletedLifecycleEvents ?? 0)}
            </strong>
          </span>
        </>
      )}
      {result && task.key === 'archive_intake_retention_cleanup' && (
        <>
          <span>
            删除批量操作：
            <strong className="font-medium text-foreground">{result.deletedBulkOperations ?? 0}</strong>
          </span>
          <span>
            删除收件记录：<strong className="font-medium text-foreground">{result.deletedIntakeItems ?? 0}</strong>
          </span>
          <span>
            删除收件批次：<strong className="font-medium text-foreground">{result.deletedSubmissions ?? 0}</strong>
          </span>
          <span>
            删除过期预览：
            <strong className="font-medium text-foreground">{result.deletedPreviewSessions ?? 0}</strong>
          </span>
        </>
      )}
      {result && task.type === 'DERIVED_MEDIA_GC' && (
        <>
          <span>
            选中：<strong className="font-medium text-foreground">{result.selected ?? 0}</strong>
          </span>
          <span>
            删除：<strong className="font-medium text-foreground">{result.deleted ?? 0}</strong>
          </span>
          <span>
            缺失：<strong className="font-medium text-foreground">{result.missing ?? 0}</strong>
          </span>
          <span>
            仍被引用：<strong className="font-medium text-foreground">{result.referenced ?? 0}</strong>
          </span>
          <span>
            失败：<strong className="font-medium text-destructive">{result.failed ?? 0}</strong>
          </span>
          <span>
            核对扫描：<strong className="font-medium text-foreground">{result.reconciliationScanned ?? 0}</strong>
          </span>
          <span>
            未登记候选：<strong className="font-medium text-foreground">{result.untrackedCandidates ?? 0}</strong>
          </span>
        </>
      )}
    </div>
  )
}
