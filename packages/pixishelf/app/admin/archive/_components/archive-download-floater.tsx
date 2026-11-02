'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useTRPC } from '@/lib/trpc'
import { ActiveArchiveDownloadPanel } from './archive-active-download-panel'
import { archiveSourceLabel } from './archive-source-label'
import { archiveTaskPhaseLabel } from './archive-task-view-state'
import type { ArchiveTaskOutput, ArchiveTaskView } from './archive-task-list'
import type { LatestArchiveJobEvent } from './archive-live-events'

export function ArchiveDownloadFloater({
  task,
  unfinishedCount,
  dashboardError = false,
  refreshedAt = 0,
  realtimeConnected = true,
  liveJobById,
  bottomOffset = 0,
  pausePending,
  cancelPending,
  onViewItems,
  onViewTask,
  onPause,
  onCancel
}: {
  task: ArchiveTaskView | null
  unfinishedCount?: number
  dashboardError?: boolean
  refreshedAt?: number
  realtimeConnected?: boolean
  liveJobById?: ReadonlyMap<string, LatestArchiveJobEvent>
  bottomOffset?: number
  pausePending: boolean
  cancelPending: boolean
  onViewItems: () => void
  onViewTask: (task: ArchiveTaskOutput) => void
  onPause: () => void
  onCancel: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('current')
  const completed = task?.liveTransfer?.completedItems ?? task?.completedItems ?? 0
  const total = task?.liveTransfer?.totalItems ?? task?.totalItems ?? 0
  const progress = total > 0 ? Math.round((completed / total) * 100) : (task?.progress ?? 0)
  const currentLabel = task
    ? `当前下载 ${progress}%`
    : dashboardError
      ? '下载状态暂不可用'
      : unfinishedCount === undefined
        ? '下载状态加载中'
        : '当前无下载'
  const displayedCount = dashboardError && unfinishedCount === 0 ? undefined : unfinishedCount
  const countLabel = `待完成 ${displayedCount ?? '—'} 项`
  if (!open && !task && unfinishedCount === 0 && !dashboardError) return null

  const viewTask = (selected: ArchiveTaskOutput) => {
    setOpen(false)
    onViewTask(selected)
  }
  return (
    <div
      className="fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+var(--archive-download-bottom-offset)+1rem)] z-30 lg:right-6 lg:bottom-[calc(var(--archive-download-bottom-offset)+1.5rem)]"
      style={{ '--archive-download-bottom-offset': `${bottomOffset}px` } as CSSProperties}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setTab(task ? 'current' : 'all')
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            className="h-auto min-h-14 flex-col items-start gap-0.5 rounded-2xl px-4 py-2 shadow-floating"
            aria-label={`${currentLabel}，${countLabel}，点击${open ? '收起' : '展开'}`}
          >
            <span className="flex items-center gap-1.5 text-xs">
              <Download aria-hidden="true" />
              {currentLabel}
            </span>
            <span className="text-xs tabular-nums">{countLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={16}
          aria-label="归档下载与待完成任务"
          className="flex max-h-[min(38rem,var(--radix-popover-content-available-height))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
        >
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="flex shrink-0 items-center gap-1 border-b p-2">
              <TabsList className="min-w-0 flex-1" aria-label="下载任务视图">
                <TabsTrigger value="current">当前下载</TabsTrigger>
                <TabsTrigger value="all">全部待完成 ({displayedCount ?? '—'})</TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="收起下载任务"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <TabsContent value="current" className="flex min-h-0 flex-1 flex-col">
              {task ? (
                <ActiveArchiveDownloadPanel
                  task={task}
                  realtimeConnected={realtimeConnected}
                  pausePending={pausePending}
                  cancelPending={cancelPending}
                  onPause={onPause}
                  onCancel={onCancel}
                  onViewItems={() => {
                    setOpen(false)
                    onViewItems()
                  }}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  {dashboardError
                    ? '下载状态暂不可用'
                    : displayedCount === 0
                      ? '暂无待完成任务'
                      : displayedCount === undefined
                        ? '下载状态加载中'
                        : '当前无下载'}
                </p>
              )}
            </TabsContent>
            <TabsContent value="all" className="min-h-0 overflow-y-auto overscroll-contain p-3">
              {unfinishedCount === 0 && !task && !dashboardError ? (
                <p className="p-3 text-sm text-muted-foreground">暂无待完成任务</p>
              ) : (
                <UnfinishedArchiveTasks
                  current={task}
                  refreshedAt={refreshedAt}
                  liveJobById={realtimeConnected ? liveJobById : undefined}
                  onViewTask={viewTask}
                />
              )}
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function UnfinishedArchiveTasks({
  current,
  refreshedAt,
  liveJobById,
  onViewTask
}: {
  current: ArchiveTaskView | null
  refreshedAt: number
  liveJobById?: ReadonlyMap<string, LatestArchiveJobEvent>
  onViewTask: (task: ArchiveTaskOutput) => void
}) {
  const trpc = useTRPC()
  const query = useInfiniteQuery(
    trpc.archive.listTasks.infiniteQueryOptions(
      { statuses: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'], limit: 50 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined, staleTime: 0 }
    )
  )
  const lastRefresh = useRef(refreshedAt)
  useEffect(() => {
    if (lastRefresh.current === refreshedAt) return
    lastRefresh.current = refreshedAt
    void query.refetch()
  }, [refreshedAt, query.refetch])
  const byId = new Map<string, ArchiveTaskView>()
  if (current) byId.set(current.id, current)
  for (const page of query.data?.pages ?? []) {
    for (const task of page.items) if (!byId.has(task.id)) byId.set(task.id, task)
  }
  return (
    <div className="flex flex-col gap-2">
      {query.isPending && (
        <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Spinner />
          正在加载待完成任务
        </p>
      )}
      {query.isError && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm">
          <span>待完成任务加载失败</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      )}
      {[...byId.values()].map((task) => {
        const live = liveJobById?.get(task.systemJobId)?.item.job
        const currentTask = task.id === current?.id
        const progress =
          task.liveTransfer && task.liveTransfer.totalItems > 0
            ? Math.round((task.liveTransfer.completedItems / task.liveTransfer.totalItems) * 100)
            : (live?.progress ?? task.progress)
        const row = live ? { ...task, stage: live.stage, systemJobStatus: live.status } : task
        return (
          <Tooltip key={task.id}>
            <TooltipTrigger asChild>
              <Button
                variant={currentTask ? 'secondary' : 'ghost'}
                className="h-auto min-h-11 w-full justify-start whitespace-normal px-3 py-2 text-left"
                onClick={() => onViewTask(task)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <PrivacySensitiveText className="line-clamp-2 break-words">
                    {task.title || archiveSourceLabel(task.providerKey, task.externalId)}
                  </PrivacySensitiveText>
                  <span className="text-xs text-muted-foreground">
                    {archiveTaskPhaseLabel(row)}
                    {currentTask || ['RUNNING', 'CANCELLING', 'PAUSED'].includes(task.status) ? ` · ${progress}%` : ''}
                  </span>
                </span>
                {currentTask && <Badge variant="info">当前</Badge>}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-normal break-words">
              <PrivacySensitiveText>
                {task.title || archiveSourceLabel(task.providerKey, task.externalId)}
              </PrivacySensitiveText>
            </TooltipContent>
          </Tooltip>
        )
      })}
      {query.isSuccess && byId.size === 0 && <p className="p-3 text-sm text-muted-foreground">暂无待完成任务</p>}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Spinner />}加载更多
        </Button>
      )}
    </div>
  )
}
