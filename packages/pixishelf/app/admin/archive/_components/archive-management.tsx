'use client'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { Archive, ChevronLeft, ChevronRight, CirclePause, CirclePlay, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/shared/global-confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useTRPC } from '@/lib/trpc'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { AppRouter } from '@/server'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { ArchiveDownloadFloater } from './archive-download-floater'
import { ArchivePageActions, WorkerLaneStrip } from './archive-page-header'
import { ArchiveTaskToolbar } from './archive-task-toolbar'
import {
  ArchiveTaskTable,
  ArchiveTaskCard,
  type ArchiveTaskOutput,
  type ArchiveTaskView,
  type SingleTaskAction
} from './archive-task-list'
import { ArchiveBulkResultDialog } from './archive-bulk-result-dialog'
import { ArchiveItemDrawer } from './archive-item-drawer'
import { hasTaskFilters, type TaskFilters } from './archive-task-filters'
import { useArchiveTaskFilters } from './use-archive-task-filters'
import { useArchiveLiveEvents } from './archive-live-events'
import { archiveSourceLabel } from './archive-source-label'
import {
  archiveTaskDeepLinkId,
  archiveTaskDisplayStatus,
  archiveTaskPageWithoutDetail,
  archiveTaskPollingInterval,
  currentPageSelectionState,
  eligibleArchiveTaskIds,
  goToNextArchiveTaskPage,
  goToPreviousArchiveTaskPage,
  getOrCreateArchiveTaskBulkKey,
  reconcileCurrentPageSelection,
  releaseArchiveTaskBulkKey,
  resetArchiveTaskBrowseState,
  toggleCurrentPageSelection,
  type ArchiveTaskBulkAction,
  type ArchiveTaskCursorState
} from './archive-task-view-state'
export { ArchiveImageCounts } from './archive-task-progress'
export { WorkerLaneStrip } from './archive-page-header'
export { ArchiveTaskTable, ArchiveTaskCard } from './archive-task-list'
const PAGE_SIZE = 50
const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING', 'RETRY_WAIT', 'CANCELLING'])
const LIVE_ARCHIVE_STATUSES = new Set(['RUNNING', 'PAUSING', 'CANCELLING'])
type RouterOutputs = inferRouterOutputs<AppRouter>
type ArchiveBulkOperation = NonNullable<RouterOutputs['archive']['actionMany']>

export function archiveImportIdFromPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const archiveImportId = (value as { archiveImportId?: unknown }).archiveImportId
  return typeof archiveImportId === 'string' && archiveImportId.length > 0 ? archiveImportId : null
}

export function selectActiveArchiveImportId(input: {
  dashboardLoaded: boolean
  dashboardArchiveImportId: string | null
  liveArchiveImportId: string | null
  realtimeConnected: boolean
}): string | null {
  if (input.dashboardLoaded) return input.dashboardArchiveImportId
  return input.realtimeConnected ? input.liveArchiveImportId : null
}

export function isActiveArchiveDownloadStatus(status: string): boolean {
  return LIVE_ARCHIVE_STATUSES.has(status)
}

export function ArchiveManagement() {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const trpc = useTRPC()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedTaskId = archiveTaskDeepLinkId(searchParams.get('taskId'))
  const {
    filters,
    filterKey,
    draftFilters,
    setDraftFilters,
    applyFilters: commitFilters,
    applyImmediateFilters,
    resetFilters
  } = useArchiveTaskFilters()
  const [browseFilterKey, setBrowseFilterKey] = useState(filterKey)
  const [cursorState, setCursorState] = useState<ArchiveTaskCursorState>(resetArchiveTaskBrowseState)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [bulkToolbarHeight, setBulkToolbarHeight] = useState(0)
  const [detailTask, setDetailTask] = useState<ArchiveTaskOutput | null>(null)
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0)
  const liveEvents = useArchiveLiveEvents(detailTask?.systemJobId)
  const { liveJobById, realtimeConnected } = liveEvents
  const [bulkOperation, setBulkOperation] = useState<ArchiveBulkOperation | null>(null)
  const [pendingSingleActions, setPendingSingleActions] = useState<Set<string>>(new Set())
  const bulkIdempotencyKeys = useRef(new Map<string, string>())

  // 浏览器前进/后退也会切换筛选，不能把旧游标或旧选择带入新的查询。
  if (browseFilterKey !== filterKey) {
    setBrowseFilterKey(filterKey)
    setCursorState(resetArchiveTaskBrowseState())
    setSelectedTaskIds(new Set())
  }

  const tasksQuery = useQuery(
    trpc.archive.listTasks.queryOptions(
      {
        limit: PAGE_SIZE,
        cursor: browseFilterKey === filterKey ? cursorState.cursor : undefined,
        statuses: filters.status === 'ALL' ? undefined : [filters.status],
        providerKey: filters.providerKey || undefined,
        kind: filters.kind === 'ALL' ? undefined : filters.kind,
        submissionId: filters.submissionId || undefined,
        search: filters.search || undefined,
        unboundOnly: filters.unboundOnly ?? false
      },
      {
        refetchInterval: (query) => archiveTaskPollingInterval(query.state.data?.items ?? [], realtimeConnected)
      }
    )
  )
  const deepLinkedTaskQuery = useQuery(
    trpc.archive.listTasks.queryOptions(
      { taskId: requestedTaskId, limit: 1 },
      {
        enabled: Boolean(requestedTaskId),
        retry: false,
        refetchInterval: (query) => {
          if (realtimeConnected) return false
          return detailTask?.id === requestedTaskId &&
            query.state.data?.items[0] &&
            ACTIVE_STATUSES.has(archiveTaskDisplayStatus(query.state.data.items[0]))
            ? 1_500
            : false
        }
      }
    )
  )
  const dashboardQuery = useQuery(
    trpc.job.backgroundDashboard.queryOptions(undefined, {
      refetchInterval: (query) => {
        const dashboard = query.state.data
        if (realtimeConnected) {
          return dashboard && (dashboard.activeCount > 0 || dashboard.queuedCount > 0) ? 30_000 : 60_000
        }
        return dashboard && (dashboard.activeCount > 0 || dashboard.queuedCount > 0) ? 1_500 : 8_000
      }
    })
  )
  const liveTransferEntry = useMemo(
    () => [...liveJobById.values()].find((value) => value.transfer !== null) ?? null,
    [liveJobById]
  )
  const writerRunningJob = dashboardQuery.data?.lanes.find(
    (lane) => lane.executionLane === 'BACKGROUND_WRITER'
  )?.runningJob
  const writerLiveStatus = writerRunningJob ? liveJobById.get(writerRunningJob.id)?.item.job.status : undefined
  const authoritativeWriterStatus = realtimeConnected
    ? (writerLiveStatus ?? writerRunningJob?.status)
    : writerRunningJob?.status
  const dashboardArchiveImportId =
    writerRunningJob?.type === 'ARCHIVE_IMPORT' &&
    authoritativeWriterStatus &&
    isActiveArchiveDownloadStatus(authoritativeWriterStatus)
      ? archiveImportIdFromPayload(writerRunningJob.payload)
      : null
  const activeArchiveImportId = selectActiveArchiveImportId({
    dashboardLoaded: dashboardQuery.data !== undefined,
    dashboardArchiveImportId,
    liveArchiveImportId: liveTransferEntry?.transfer?.archiveImportId ?? null,
    realtimeConnected
  })
  const activeTaskQuery = useQuery(
    trpc.archive.listTasks.queryOptions(
      { taskId: activeArchiveImportId ?? undefined, limit: 1 },
      {
        enabled: Boolean(activeArchiveImportId),
        refetchInterval: realtimeConnected ? false : 1_500
      }
    )
  )
  const tasks = useMemo<ArchiveTaskView[]>(
    () =>
      (tasksQuery.data?.items ?? []).map((task) => {
        const live = realtimeConnected ? liveJobById.get(task.systemJobId) : undefined
        const transfer = live?.transfer ?? null
        return {
          ...task,
          ...(live
            ? {
                progress: live.item.job.progress,
                message: live.item.job.message,
                systemJobStatus: live.item.job.status,
                attempt: live.item.job.attempt
              }
            : {}),
          ...(transfer
            ? {
                completedItems: transfer.completedItems,
                failedItems: transfer.failedItems,
                totalItems: transfer.totalItems
              }
            : {}),
          liveTransfer: transfer
        }
      }),
    [liveJobById, realtimeConnected, tasksQuery.data?.items]
  )
  const activeTask = useMemo<ArchiveTaskView | null>(() => {
    if (!activeArchiveImportId) return null
    const queriedTask = activeTaskQuery.data?.items[0]
    const task =
      (queriedTask?.id === activeArchiveImportId ? queriedTask : null) ??
      tasks.find((candidate) => candidate.id === activeArchiveImportId)
    if (!task) return null
    const cachedLive = liveJobById.get(task.systemJobId)
    const live = realtimeConnected ? cachedLive : undefined
    const authoritativeStatus = live?.item.job.status ?? task.systemJobStatus
    if (!isActiveArchiveDownloadStatus(authoritativeStatus)) return null
    const transfer =
      cachedLive?.transfer ??
      (task.id === liveTransferEntry?.transfer?.archiveImportId ? liveTransferEntry.transfer : null)
    return {
      ...task,
      ...(live
        ? {
            progress: live.item.job.progress,
            message: live.item.job.message,
            systemJobStatus: live.item.job.status,
            attempt: live.item.job.attempt
          }
        : {}),
      ...(transfer
        ? {
            completedItems: transfer.completedItems,
            failedItems: transfer.failedItems,
            totalItems: transfer.totalItems
          }
        : {}),
      liveTransfer: transfer
    }
  }, [activeArchiveImportId, activeTaskQuery.data?.items, liveJobById, liveTransferEntry, realtimeConnected, tasks])
  const currentPageIds = useMemo(() => tasks.map((task) => task.id), [tasks])
  const selectionState = currentPageSelectionState(selectedTaskIds, currentPageIds)

  useEffect(() => {
    setSelectedTaskIds((current) => {
      const next = reconcileCurrentPageSelection(current, currentPageIds)
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next
    })
  }, [currentPageIds])

  useEffect(() => {
    if (!detailTask) return
    const updated = tasks.find((task) => task.id === detailTask.id)
    if (updated) setDetailTask(updated)
  }, [detailTask?.id, tasks])

  useEffect(() => {
    const task = deepLinkedTaskQuery.data?.items[0]
    if (task) setDetailTask(task)
  }, [deepLinkedTaskQuery.data])

  const refreshPage = async () => {
    await Promise.all([tasksQuery.refetch(), dashboardQuery.refetch()])
  }
  useEffect(() => {
    if (liveEvents.lifecycleVersion > 0) void refreshPage()
  }, [liveEvents.lifecycleVersion])
  useEffect(() => {
    if (liveEvents.readyVersion > 0) {
      void Promise.all([refreshPage(), requestedTaskId ? deepLinkedTaskQuery.refetch() : null])
    }
  }, [liveEvents.readyVersion])
  const resetBrowseState = () => {
    setCursorState(resetArchiveTaskBrowseState())
    setSelectedTaskIds(new Set())
  }
  const applyFilters = (next: TaskFilters) => {
    commitFilters(next)
    resetBrowseState()
  }
  const clearFilters = () => {
    resetFilters()
    resetBrowseState()
  }

  const singleActionMutation = useMutation(
    trpc.archive.action.mutationOptions({
      onMutate: (variables) => {
        setPendingSingleActions((current) => new Set(current).add(singleActionKey(variables.taskId, variables.action)))
      },
      onSuccess: async () => {
        await refreshPage()
        setDetailRefreshVersion((value) => value + 1)
      },
      onError: () => toast.error('任务操作失败，请刷新后重试'),
      onSettled: (_data, _error, variables) => {
        setPendingSingleActions((current) => {
          const next = new Set(current)
          next.delete(singleActionKey(variables.taskId, variables.action))
          return next
        })
      }
    })
  )
  const bulkActionMutation = useMutation(
    trpc.archive.actionMany.mutationOptions({
      onSuccess: async (operation, variables) => {
        if (!operation) {
          toast.error('批量操作记录暂不可用，请刷新后重试')
          return
        }
        setBulkOperation(operation)
        releaseArchiveTaskBulkKey(bulkIdempotencyKeys.current, variables.action, variables.taskIds)
        const changed = operation.counts.applied + operation.counts.reused
        toast.success(`批量操作完成：已处理 ${changed} 项`)
        setSelectedTaskIds(new Set())
        await refreshPage()
      },
      onError: () => toast.error('批量操作失败，请刷新任务状态后重试')
    })
  )

  const runBulkAction = (action: ArchiveTaskBulkAction) => {
    const taskIds = eligibleArchiveTaskIds(tasks, selectedTaskIds, action)
    if (taskIds.length === 0) return
    const idempotencyKey = getOrCreateArchiveTaskBulkKey(bulkIdempotencyKeys.current, action, taskIds, () =>
      createIdempotencyKey(`archive-task-${action.toLowerCase()}`)
    )
    const execute = () =>
      bulkActionMutation.mutate({
        idempotencyKey,
        taskIds,
        action
      })
    if (action === 'CANCEL') {
      confirm({
        title: `取消 ${taskIds.length} 个归档任务？`,
        description: '运行中的任务会请求停止，已下载的暂存文件仍按保留策略处理。',
        confirmText: `确认取消 ${taskIds.length} 项`,
        variant: 'destructive',
        onConfirm: execute
      })
      return
    }
    execute()
  }

  return (
    <AdminWorkbench
      title="归档任务"
      eyebrow={null}
      className="[&>[data-slot=page-header]]:sm:items-start"
      contentClassName="flex flex-col gap-4"
      metadata={<WorkerLaneStrip dashboard={dashboardQuery.data} loading={dashboardQuery.isLoading} />}
      actions={
        <ArchivePageActions
          refreshing={tasksQuery.isFetching}
          onRefresh={() => void refreshPage()}
          onCreated={() => void dashboardQuery.refetch()}
        />
      }
    >
      {activeTask && (
        <ArchiveDownloadFloater
          key={activeTask.id}
          task={activeTask}
          bottomOffset={bulkToolbarHeight}
          pausePending={pendingSingleActions.has(singleActionKey(activeTask.id, 'PAUSE'))}
          cancelPending={pendingSingleActions.has(singleActionKey(activeTask.id, 'CANCEL'))}
          onViewItems={() => setDetailTask(activeTask)}
          onPause={() =>
            requestSingleTaskAction(activeTask, 'PAUSE', (action) =>
              singleActionMutation.mutate({ taskId: activeTask.id, action })
            )
          }
          onCancel={() =>
            requestSingleTaskAction(activeTask, 'CANCEL', (action) =>
              singleActionMutation.mutate({ taskId: activeTask.id, action })
            )
          }
        />
      )}

      {requestedTaskId &&
      (deepLinkedTaskQuery.isError ||
        (deepLinkedTaskQuery.isSuccess && deepLinkedTaskQuery.data.items.length === 0)) ? (
        <Alert variant="warning">
          <AlertTitle>指定的归档任务不可用</AlertTitle>
          <AlertDescription>任务可能已被清理；任务列表仍可继续使用。</AlertDescription>
        </Alert>
      ) : null}

      <ArchiveTaskToolbar
        value={draftFilters}
        appliedValue={filters}
        onChange={setDraftFilters}
        onImmediateChange={(patch) => {
          applyImmediateFilters(patch)
          resetBrowseState()
        }}
        onSubmit={() => applyFilters(draftFilters)}
        onReset={clearFilters}
      />
      <section aria-label="归档任务列表" className="flex min-w-0 flex-col gap-4">
        {tasksQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>无法读取归档任务</AlertTitle>
            <AlertDescription>请检查服务状态后重试，当前筛选条件已保留。</AlertDescription>
          </Alert>
        ) : tasksQuery.isLoading ? (
          <TaskListSkeleton />
        ) : tasks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Archive aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{hasTaskFilters(filters) ? '没有匹配的任务' : '还没有归档任务'}</EmptyTitle>
              <EmptyDescription>
                {hasTaskFilters(filters)
                  ? '调整筛选条件，或返回收件箱查看解析进度。'
                  : '添加作品链接后，可在收件箱中选择已解析项目入队。'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {hasTaskFilters(filters) ? (
                <Button variant="outline" onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link href="/admin/archive/inbox?tab=inbox">打开收件箱</Link>
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {/* 仅挂载当前断点的列表，CSS 隐藏仍会创建另一套菜单、订阅与事件处理器。 */}
            {isDesktop ? (
              <div className="overflow-hidden rounded-lg border">
                <ArchiveTaskTable
                  tasks={tasks}
                  selectedTaskIds={selectedTaskIds}
                  selectionState={selectionState.checked}
                  pendingActions={pendingSingleActions}
                  onToggleAll={(checked) =>
                    setSelectedTaskIds((current) => toggleCurrentPageSelection(current, currentPageIds, checked))
                  }
                  onToggleTask={(taskId, checked) =>
                    setSelectedTaskIds((current) => toggleTaskSelection(current, taskId, checked))
                  }
                  onViewItems={setDetailTask}
                  onAction={(task, action) =>
                    requestSingleTaskAction(task, action, (confirmedAction) =>
                      singleActionMutation.mutate({ taskId: task.id, action: confirmedAction })
                    )
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <Checkbox
                    checked={selectionState.checked}
                    onCheckedChange={(checked) =>
                      setSelectedTaskIds((current) =>
                        toggleCurrentPageSelection(current, currentPageIds, Boolean(checked))
                      )
                    }
                    aria-label="选择当前页全部任务"
                  />
                  <span className="text-sm">选择当前页全部 {currentPageIds.length} 项</span>
                </div>
                {tasks.map((task) => (
                  <ArchiveTaskCard
                    key={task.id}
                    task={task}
                    selected={selectedTaskIds.has(task.id)}
                    pendingActions={pendingSingleActions}
                    onToggle={(checked) =>
                      setSelectedTaskIds((current) => toggleTaskSelection(current, task.id, checked))
                    }
                    onViewItems={() => setDetailTask(task)}
                    onAction={(action) =>
                      requestSingleTaskAction(task, action, (confirmedAction) =>
                        singleActionMutation.mutate({ taskId: task.id, action: confirmedAction })
                      )
                    }
                  />
                ))}
              </div>
            )}
            {selectionState.selectedCount > 0 && (
              <BulkActionToolbar
                onHeightChange={setBulkToolbarHeight}
                selectedCount={selectionState.selectedCount}
                eligibleCounts={{
                  PAUSE: eligibleArchiveTaskIds(tasks, selectedTaskIds, 'PAUSE').length,
                  RESUME: eligibleArchiveTaskIds(tasks, selectedTaskIds, 'RESUME').length,
                  RETRY: eligibleArchiveTaskIds(tasks, selectedTaskIds, 'RETRY').length,
                  CANCEL: eligibleArchiveTaskIds(tasks, selectedTaskIds, 'CANCEL').length
                }}
                pending={bulkActionMutation.isPending}
                pendingAction={bulkActionMutation.variables?.action}
                onAction={runBulkAction}
                onClear={() => setSelectedTaskIds(new Set())}
              />
            )}
          </>
        )}

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            第 {cursorState.previousCursors.length + 1} 页 · 每页最多 {PAGE_SIZE} 项
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cursorState.previousCursors.length === 0 || tasksQuery.isFetching}
              onClick={() => {
                setCursorState((current) => goToPreviousArchiveTaskPage(current))
                setSelectedTaskIds(new Set())
              }}
            >
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!tasksQuery.data?.nextCursor || tasksQuery.isFetching}
              onClick={() => {
                setCursorState((current) => goToNextArchiveTaskPage(current, tasksQuery.data?.nextCursor ?? null))
                setSelectedTaskIds(new Set())
              }}
            >
              下一页
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      <ArchiveItemDrawer
        key={`${detailTask?.id ?? 'archive-item-drawer'}:${detailRefreshVersion}`}
        open={Boolean(detailTask)}
        task={detailTask}
        realtimeConnected={realtimeConnected}
        liveRefreshVersion={liveEvents.detailRefreshVersion}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTask(null)
            if (requestedTaskId) {
              router.replace(archiveTaskPageWithoutDetail(searchParams.toString()), { scroll: false })
            }
          }
        }}
        onTaskChanged={async () => {
          await Promise.all([tasksQuery.refetch(), requestedTaskId ? deepLinkedTaskQuery.refetch() : Promise.resolve()])
        }}
      />
      <ArchiveBulkResultDialog
        operation={bulkOperation}
        onOpenChange={(open) => {
          if (!open) setBulkOperation(null)
        }}
      />
    </AdminWorkbench>
  )
}

function BulkActionToolbar({
  onHeightChange,
  selectedCount,
  eligibleCounts,
  pending,
  pendingAction,
  onAction,
  onClear
}: {
  onHeightChange: (height: number) => void
  selectedCount: number
  eligibleCounts: Record<ArchiveTaskBulkAction, number>
  pending: boolean
  pendingAction: ArchiveTaskBulkAction | undefined
  onAction: (action: ArchiveTaskBulkAction) => void
  onClear: () => void
}) {
  const toolbarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const measure = () => onHeightChange(toolbar.getBoundingClientRect().height)
    measure()
    // 批量按钮在窄屏换行后，用实际高度为浮球让位。
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    return () => {
      observer.disconnect()
      onHeightChange(0)
    }
  }, [onHeightChange])
  const actionButton = (action: ArchiveTaskBulkAction, label: string, icon: React.ReactNode, destructive = false) => (
    <Button
      key={action}
      variant={destructive ? 'destructive' : 'outline'}
      size="sm"
      disabled={pending || eligibleCounts[action] === 0}
      onClick={() => onAction(action)}
    >
      {pending && pendingAction === action ? <Spinner data-icon="inline-start" /> : icon}
      {label} {eligibleCounts[action]} 项
    </Button>
  )
  return (
    <section
      ref={toolbarRef}
      className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] flex flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:flex-row sm:items-center sm:justify-between lg:bottom-4"
      aria-label="当前页批量操作"
    >
      <div className="flex items-center gap-2">
        <Badge>{selectedCount}</Badge>
        <span className="text-sm font-medium">已选择当前页任务</span>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onClear}>
          清除选择
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {actionButton('PAUSE', '暂停', <CirclePause data-icon="inline-start" aria-hidden="true" />)}
        {actionButton('RESUME', '继续', <CirclePlay data-icon="inline-start" aria-hidden="true" />)}
        {actionButton('RETRY', '重试', <RotateCcw data-icon="inline-start" aria-hidden="true" />)}
        {actionButton('CANCEL', '取消', <Square data-icon="inline-start" aria-hidden="true" />, true)}
      </div>
    </section>
  )
}

function TaskListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="正在加载归档任务">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-lg border p-4">
          <Skeleton className="size-4" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-2 w-32" />
        </div>
      ))}
    </div>
  )
}

function requestSingleTaskAction(
  task: ArchiveTaskOutput,
  action: SingleTaskAction,
  execute: (action: SingleTaskAction) => void
) {
  const confirmations: Partial<
    Record<SingleTaskAction, { title: ReactNode; description: string; confirmText: string }>
  > = {
    CANCEL: {
      title: task.title ? (
        <>
          取消“<PrivacySensitiveText>{task.title}</PrivacySensitiveText>”？
        </>
      ) : (
        `取消“${archiveSourceLabel(task.providerKey, task.externalId)}”？`
      ),
      description: '任务会停止处理，已下载的暂存文件会按保留策略处理。',
      confirmText: '确认取消'
    },
    DELETE_STAGING: {
      title: '清理这个任务的暂存文件？',
      description: '暂存文件将被永久删除，此操作不可撤销。',
      confirmText: '确认清理'
    },
    DELETE_ARCHIVE: {
      title: '将已归档作品移入回收站？',
      description: '作品会从前台隐藏，但之后仍可从这里恢复。',
      confirmText: '移入回收站'
    }
  }
  const content = confirmations[action]
  if (!content) return execute(action)
  confirm({ ...content, variant: 'destructive', onConfirm: () => execute(action) })
}

function toggleTaskSelection(current: ReadonlySet<string>, taskId: string, checked: boolean): Set<string> {
  const next = new Set(current)
  if (checked) next.add(taskId)
  else next.delete(taskId)
  return next
}

function singleActionKey(taskId: string, action: SingleTaskAction): string {
  return `${taskId}:${action}`
}

function createIdempotencyKey(prefix: string): string {
  return `${prefix}-${createBrowserUuid()}`
}
