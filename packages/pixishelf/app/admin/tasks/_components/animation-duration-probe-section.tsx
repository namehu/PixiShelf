'use client'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlay, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { JobStatus, TaskSection, type JobView, type ScheduledTaskView } from './task-ui'
import { ACTIVE_TASK_STATUSES, formatTaskStatus } from './task-status'

export function AnimationDurationProbeSection({
  task,
  triggerPending,
  triggeringKey,
  onTrigger,
  scheduleSettings
}: {
  task: ScheduledTaskView | undefined
  triggerPending: boolean
  triggeringKey: string | null
  onTrigger(): void
  scheduleSettings: ReactNode
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const query = useQuery(trpc.job.getAnimationDurationProbeStatus.queryOptions(undefined, { refetchInterval: 3_000 }))
  const job = query.data as JobView | null | undefined
  const running = Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status))
  const progress = job?.progressData?.kind === 'animation-duration-probe' ? job.progressData : null
  const retry = useMutation(trpc.job.retryAnimationDurationFailures.mutationOptions({
    onSuccess: ({ retried }) => {
      toast.success(retried > 0 ? `已重新排队 ${retried} 个失败文件` : '没有可重试的失败文件')
      void query.refetch()
      void queryClient.invalidateQueries({ queryKey: trpc.job.listScheduledTasks.queryKey() })
    },
    onError: (error) => toast.error(`重试失败：${error.message}`)
  }))

  return (
    <TaskSection
      id="animation-duration-probe"
      category="可定时"
      icon={ImagePlay}
      title={task?.name ?? '动图时长探测'}
      description={task?.description ?? '只读取 WebP 容器时间块并持久保存单周期时长。'}
      summary={running ? `${formatTaskStatus(job?.status)} · ${job?.progress ?? 0}%` : job?.status === 'FAILED' ? '需要处理 · 上次执行失败' : null}
      tone={running ? 'active' : job?.status === 'FAILED' ? 'error' : 'idle'}
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={onTrigger} disabled={!task || running || triggerPending}>
            {triggeringKey === task?.key
              ? <Spinner data-icon="inline-start" aria-hidden="true" />
              : <PlayCircle data-icon="inline-start" aria-hidden="true" />}
            {running ? formatTaskStatus(job?.status) : '立即执行'}
          </Button>
          <Button variant="outline" disabled={running || retry.isPending} onClick={() => retry.mutate({})}>
            重试失败项
          </Button>
        </div>
      }
    >
      <JobStatus
        job={job}
        isRunning={running}
        progressContent={progress ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>成功 {progress.succeededItems}</span>
            <span>静态 {progress.staticItems}</span>
            <span>失败 {progress.failedItems}</span>
            <span>剩余 {progress.remainingItems}</span>
            <span>等待重试 {progress.retryPendingItems}</span>
            <span>等待源文件写入 {progress.writePendingItems}</span>
            <span>逻辑读取 {progress.logicalReadOperations} 次 / {progress.logicalReadBytes} 字节</span>
          </div>
        ) : null}
      />
      {scheduleSettings}
    </TaskSection>
  )
}
