'use client'

import type { JobDto, JobStatus } from '@pixishelf/job-contracts'
import { Activity, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { formatBackgroundJobStatus, formatBackgroundJobType } from './background-task-format'
import type { BackgroundBatchView } from './background-task-console'

function formatBatchStatus(status: JobStatus) {
  if (status === 'RUNNING') return '批次执行中'
  if (status === 'PENDING') return '批次排队中'
  if (status === 'RETRY_WAIT') return '批次等待重试'
  if (status === 'PAUSING') return '批次暂停中'
  if (status === 'PAUSED') return '批次已暂停'
  if (status === 'CANCELLING') return '批次取消中'
  return formatBackgroundJobStatus(status)
}

export function BackgroundExecutionRow({
  job,
  batch,
  queuedCount,
  onSelectJob
}: {
  job: JobDto | null
  batch: BackgroundBatchView | null
  queuedCount: number
  onSelectJob: (jobId: string) => void
}) {
  const visibleJob = batch?.parentJob ?? job
  const detailJob = batch?.currentJob ?? visibleJob
  const progress = batch?.progress ?? visibleJob?.progress ?? 0

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b bg-muted/10 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {visibleJob ? (
          <Activity className="size-4" aria-hidden="true" />
        ) : (
          <Clock3 className="size-4" aria-hidden="true" />
        )}
        <span>{batch ? '补全批次' : '唯一执行槽'}</span>
        <AdminStatusBadge status={batch?.status ?? visibleJob?.status ?? 'IDLE'}>
          {batch ? formatBatchStatus(batch.status) : visibleJob ? formatBackgroundJobStatus(visibleJob.status) : '空闲'}
        </AdminStatusBadge>
        <span className="ml-auto tabular-nums">{queuedCount} 项等待</span>
      </div>
      {visibleJob ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 break-words text-sm font-medium">
              {formatBackgroundJobType(visibleJob.type, visibleJob.payload)}
            </p>
            {detailJob ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => onSelectJob(detailJob.id)}
              >
                {batch?.currentJob ? '查看当前子任务' : '查看当前任务'}
              </Button>
            ) : null}
          </div>
          <p className="select-text break-all font-mono text-[11px] text-muted-foreground">{visibleJob.id}</p>
          <div className="flex items-center gap-3">
            <Progress value={progress} className="h-2 flex-1" aria-label={`任务进度 ${progress}%`} />
            <span className="text-xs font-semibold tabular-nums">{progress}%</span>
          </div>
          {batch ? (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>
                已处理 {batch.completedCount}/{batch.totalCount}，剩余 {batch.remainingCount}
                {batch.failedCount > 0 ? `，其中失败 ${batch.failedCount}` : ''}
              </p>
              <p className="select-text break-words">
                {batch.currentJob?.message ? (
                  <>
                    当前：<PrivacySensitiveText>{batch.currentJob.message}</PrivacySensitiveText>
                  </>
                ) : (
                  '等待 Worker 继续处理'
                )}
              </p>
            </div>
          ) : visibleJob.message ? (
            <PrivacySensitiveText as="p" className="select-text break-words text-xs text-muted-foreground">
              {visibleJob.message}
            </PrivacySensitiveText>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
