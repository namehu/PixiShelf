'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useTRPC } from '@/lib/trpc'
import type { ScheduledTaskView } from './task-ui'

export function ScheduledTaskToggle({
  taskKey,
  task,
  loading,
  error,
  onRetry
}: {
  taskKey: string
  task?: ScheduledTaskView
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(
    trpc.job.updateScheduledTask.mutationOptions({
      onSuccess: async (_result, variables) => {
        queryClient.setQueryData(trpc.job.listScheduledTasks.queryKey(), (current) =>
          current?.map((item) => (item.key === variables.key ? { ...item, enabled: variables.enabled! } : item))
        )
        await queryClient.invalidateQueries({ queryKey: trpc.job.listScheduledTasks.queryKey() })
      },
      onError: (failure) => toast.error(`自动计划未保存：${failure.message}`)
    })
  )
  if (!task) {
    return (
      <div
        className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground"
        aria-label={`${taskKey} 自动计划状态`}
      >
        {loading ? (
          <>
            <span>自动计划：读取中</span>
            <Skeleton className="h-5 w-9 rounded-full" />
          </>
        ) : (
          <>
            <span>自动计划：暂不可用</span>
            <Button variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>
              重试
            </Button>
          </>
        )}
      </div>
    )
  }
  const enabled = mutation.isPending ? mutation.variables!.enabled! : task.enabled
  const id = `schedule-${task.key}-enabled`
  return (
    <div className="flex min-h-11 items-center gap-2">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer flex-col justify-center text-xs font-medium">
        <span>自动计划：{enabled ? '已开启' : '已关闭'}</span>
        {task.key === 'derived_media_gc_reconciliation' && (
          <span className="text-[11px] text-muted-foreground">每周一</span>
        )}
      </label>
      <Switch
        id={id}
        aria-label={`${task.name}自动计划`}
        checked={enabled}
        disabled={mutation.isPending}
        className="relative after:absolute after:-inset-x-2 after:-inset-y-3.5"
        onCheckedChange={(value) => mutation.mutate({ key: task.key, enabled: value })}
      />
      {mutation.isPending && (
        <span role="status" className="text-xs text-muted-foreground">
          保存中…
        </span>
      )}
      {error && <span className="text-xs text-muted-foreground">同步失败</span>}
    </div>
  )
}

export function ScheduledTaskOverview({
  tasks,
  loading,
  error,
  onRetry
}: {
  tasks?: Array<{ enabled: boolean }>
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-4 py-3" aria-label="自动计划概览">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          自动计划：
          {tasks
            ? `已开启 ${tasks.filter((task) => task.enabled).length} / 共 ${tasks.length} 项`
            : loading
              ? '读取中…'
              : '状态暂不可用'}
        </p>
        {error && (
          <Button variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
            重试读取计划
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        上海时间 00:00–08:00 按优先级依次执行；关闭仅阻止后续自动入队，不影响已有排队或运行任务。
      </p>
    </section>
  )
}
