'use client'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { ArchiveTransferTelemetry } from '@pixishelf/job-contracts'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Images,
  Inbox,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/shared/global-confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { ActiveArchiveDownloadPanel } from './archive-active-download-panel'
import { ArchiveAddDialog } from './archive-add-dialog'
import { ArchiveBulkResultDialog } from './archive-bulk-result-dialog'
import { ArchiveItemDrawer } from './archive-item-drawer'
import { ArchivePublishedMediaPreview } from './archive-published-media-preview'
import { ArchiveSubmissionBadge } from './archive-submission-badge'
import { TaskFiltersForm, hasTaskFilters, normalizeTaskFilters, type TaskFilters } from './archive-task-filters'
import { useArchiveLiveEvents } from './archive-live-events'
import { ArchiveImageCounts, TaskProgress } from './archive-task-progress'
import {
  archiveLaneStatusLabel,
  archiveMaintenanceRetryAction,
  archiveTaskDeepLinkId,
  archiveTaskDisplayStatus,
  archiveTaskPageWithoutDetail,
  archiveTaskPollingInterval,
  archiveTaskStatusLabel,
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
const PAGE_SIZE = 50
const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING', 'RETRY_WAIT', 'CANCELLING'])
const LIVE_ARCHIVE_STATUSES = new Set(['RUNNING', 'PAUSING', 'CANCELLING'])
const EMPTY_TASK_IDS = new Set<string>()
type RouterOutputs = inferRouterOutputs<AppRouter>
type ArchiveTaskOutput = RouterOutputs['archive']['listTasks']['items'][number]
type ArchiveTaskView = ArchiveTaskOutput & {
  liveTransfer?: ArchiveTransferTelemetry | null
}
type ArchiveBulkOperation = NonNullable<RouterOutputs['archive']['actionMany']>
type SingleTaskAction =
  | ArchiveTaskBulkAction
  | 'USE_DISPLAY_QUALITY'
  | 'DELETE_STAGING'
  | 'DELETE_ARCHIVE'
  | 'RESTORE_ARCHIVE'

interface ArchivePublishedMediaTaskLike {
  publishedArtwork?: {
    archiveLifecycleState?: string | null
    deletedAt?: unknown
  } | null
}
export function canExpandArchivePublishedMedia(task: ArchivePublishedMediaTaskLike) {
  return Boolean(
    task.publishedArtwork &&
      task.publishedArtwork.archiveLifecycleState === 'ACTIVE' &&
      task.publishedArtwork.deletedAt === null
  )
}

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

const EMPTY_FILTERS: TaskFilters = {
  status: 'ALL',
  providerKey: '',
  kind: 'ALL',
  submissionId: '',
  search: ''
}

export function ArchiveManagement() {
  const trpc = useTRPC()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDesktopLayout = useMediaQuery('(min-width: 768px)')
  const requestedTaskId = archiveTaskDeepLinkId(searchParams.get('taskId'))
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [cursorState, setCursorState] = useState<ArchiveTaskCursorState>(resetArchiveTaskBrowseState)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  const [detailTask, setDetailTask] = useState<ArchiveTaskOutput | null>(null)
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0)
  const liveEvents = useArchiveLiveEvents(detailTask?.systemJobId)
  const { liveJobById, liveNow, realtimeConnected } = liveEvents
  const [bulkOperation, setBulkOperation] = useState<ArchiveBulkOperation | null>(null)
  const [pendingSingleActions, setPendingSingleActions] = useState<Set<string>>(new Set())
  const bulkIdempotencyKeys = useRef(new Map<string, string>())

  const tasksQuery = useQuery(
    trpc.archive.listTasks.queryOptions(
      {
        limit: PAGE_SIZE,
        cursor: cursorState.cursor,
        statuses: filters.status === 'ALL' ? undefined : [filters.status],
        providerKey: filters.providerKey || undefined,
        kind: filters.kind === 'ALL' ? undefined : filters.kind,
        submissionId: filters.submissionId || undefined,
        search: filters.search || undefined
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
  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

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
    setFilters(next)
    setDraftFilters(next)
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
    <div className="mx-auto flex max-w-[92rem] flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          任务按创建时间倒序显示。解析收件与媒体写入分别占用独立通道，归档下载仍逐个执行。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/archive/inbox">
              <Inbox data-icon="inline-start" aria-hidden="true" />
              收件箱
            </Link>
          </Button>
          <ArchiveAddDialog
            trigger={
              <Button>
                <Archive data-icon="inline-start" aria-hidden="true" />
                添加链接
              </Button>
            }
            onCreated={() => void dashboardQuery.refetch()}
          />
        </div>
      </div>

      <WorkerLaneStrip dashboard={dashboardQuery.data} loading={dashboardQuery.isLoading} />

      {activeTask && (
        <ActiveArchiveDownloadPanel
          task={activeTask}
          now={liveNow}
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

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>归档任务</CardTitle>
              <CardDescription>
                支持当前页选择与状态安全的批量控制；回收站、恢复和暂存清理仍按单个任务操作。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshPage()} disabled={tasksQuery.isFetching}>
              {tasksQuery.isFetching ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
              )}
              刷新
            </Button>
          </div>
          <TaskFiltersForm
            value={draftFilters}
            appliedValue={filters}
            onChange={setDraftFilters}
            onImmediateChange={(patch) => {
              setDraftFilters((current) => ({ ...current, ...patch }))
              setFilters((current) => ({ ...current, ...patch }))
              resetBrowseState()
            }}
            onSubmit={() => applyFilters(normalizeTaskFilters(draftFilters))}
            onReset={() => applyFilters(EMPTY_FILTERS)}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
                  <Button variant="outline" onClick={() => applyFilters(EMPTY_FILTERS)}>
                    清除筛选
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link href="/admin/archive/inbox">打开收件箱</Link>
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-lg border md:block">
                <ArchiveTaskTable
                  tasks={tasks}
                  selectedTaskIds={selectedTaskIds}
                  expandedTaskIds={isDesktopLayout ? expandedTaskIds : EMPTY_TASK_IDS}
                  selectionState={selectionState.checked}
                  pendingActions={pendingSingleActions}
                  onToggleAll={(checked) =>
                    setSelectedTaskIds((current) => toggleCurrentPageSelection(current, currentPageIds, checked))
                  }
                  onToggleTask={(taskId, checked) =>
                    setSelectedTaskIds((current) => toggleTaskSelection(current, taskId, checked))
                  }
                  onToggleExpanded={toggleTaskExpanded}
                  onViewItems={setDetailTask}
                  onAction={(task, action) =>
                    requestSingleTaskAction(task, action, (confirmedAction) =>
                      singleActionMutation.mutate({ taskId: task.id, action: confirmedAction })
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-3 md:hidden">
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
                    expanded={!isDesktopLayout && expandedTaskIds.has(task.id)}
                    pendingActions={pendingSingleActions}
                    onToggle={(checked) =>
                      setSelectedTaskIds((current) => toggleTaskSelection(current, task.id, checked))
                    }
                    onToggleExpanded={() => toggleTaskExpanded(task.id)}
                    onViewItems={() => setDetailTask(task)}
                    onAction={(action) =>
                      requestSingleTaskAction(task, action, (confirmedAction) =>
                        singleActionMutation.mutate({ taskId: task.id, action: confirmedAction })
                      )
                    }
                  />
                ))}
              </div>
              {selectionState.selectedCount > 0 && (
                <BulkActionToolbar
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
        </CardContent>
      </Card>

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
    </div>
  )
}

export function WorkerLaneStrip({
  dashboard,
  loading
}: {
  dashboard: RouterOutputs['job']['backgroundDashboard'] | undefined
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2 rounded-lg border px-3 py-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-7 w-56" />
      </div>
    )
  }
  if (!dashboard) {
    return (
      <Alert variant="warning">
        <AlertTitle>后台任务通道状态不可用</AlertTitle>
        <AlertDescription>任务列表仍可操作；开始新任务前请确认后台任务进程已启动。</AlertDescription>
      </Alert>
    )
  }
  const laneNames: Record<string, string> = {
    ARCHIVE_RESOLVE: '链接解析',
    BACKGROUND_WRITER: '媒体写入'
  }
  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-background px-3 py-2"
      aria-label="后台任务执行通道"
    >
      {dashboard.lanes.map((lane) => (
        <div key={lane.executionLane} className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{laneNames[lane.executionLane] ?? lane.executionLane}</span>
          <LaneStatusBadge status={lane.status} />
          <span className="max-w-64 truncate font-mono text-xs text-muted-foreground">
            {lane.runningJob ? `${lane.runningJob.type} · ${lane.runningJob.progress}%` : '等待领取任务'}
          </span>
        </div>
      ))}
    </section>
  )
}

function LaneStatusBadge({ status }: { status: 'READY' | 'RUNNING' | 'DRAINING' | 'ERROR' }) {
  if (status === 'DRAINING') return <Badge variant="warning">{archiveLaneStatusLabel(status)}</Badge>
  return <AdminStatusBadge status={status}>{archiveLaneStatusLabel(status)}</AdminStatusBadge>
}

export function ArchiveTaskTable({
  tasks,
  selectedTaskIds,
  expandedTaskIds,
  selectionState,
  pendingActions,
  onToggleAll,
  onToggleTask,
  onToggleExpanded,
  onViewItems,
  onAction
}: {
  tasks: ArchiveTaskView[]
  selectedTaskIds: ReadonlySet<string>
  expandedTaskIds: ReadonlySet<string>
  selectionState: boolean | 'indeterminate'
  pendingActions: ReadonlySet<string>
  onToggleAll: (checked: boolean) => void
  onToggleTask: (taskId: string, checked: boolean) => void
  onToggleExpanded: (taskId: string) => void
  onViewItems: (task: ArchiveTaskOutput) => void
  onAction: (task: ArchiveTaskOutput, action: SingleTaskAction) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-11" />
          <TableHead className="w-10">
            <Checkbox
              checked={selectionState}
              onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
              aria-label="选择当前页全部任务"
            />
          </TableHead>
          <TableHead>作品 / 来源</TableHead>
          <TableHead>状态 / 质量</TableHead>
          <TableHead className="w-56 min-w-56">进度</TableHead>
          <TableHead>
            <span aria-label="图片数量，顺序为成功、失败、总数">成功 / 失败 / 总数</span>
          </TableHead>
          <TableHead>创建时间</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => {
          const canExpand = canExpandArchivePublishedMedia(task)
          const expanded = canExpand && expandedTaskIds.has(task.id)
          return (
            <Fragment key={task.id}>
              <TableRow data-state={selectedTaskIds.has(task.id) ? 'selected' : undefined}>
                <TableCell>
                  {canExpand && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onToggleExpanded(task.id)}
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label={expanded ? '收起已发布媒体' : '展开已发布媒体'}
                      aria-expanded={expanded}
                    >
                      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={selectedTaskIds.has(task.id)}
                    onCheckedChange={(checked) => onToggleTask(task.id, Boolean(checked))}
                    aria-label={`选择 ${task.title || `${task.providerKey} ${task.externalId}`}`}
                  />
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  <TaskIdentity task={task} />
                </TableCell>
                <TableCell>
                  <TaskStatus task={task} />
                </TableCell>
                <TableCell className="w-56">
                  <TaskProgress task={task} compact />
                </TableCell>
                <TableCell>
                  <ArchiveImageCounts task={task} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatTaskTime(task.createdAt)}</TableCell>
                <TableCell>
                  <TaskActions
                    task={task}
                    pendingActions={pendingActions}
                    onViewItems={() => onViewItems(task)}
                    onAction={(action) => onAction(task, action)}
                  />
                </TableCell>
              </TableRow>
              {expanded && task.publishedArtwork && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="bg-muted/10 p-0">
                    <ArchivePublishedMediaPreview artworkId={task.publishedArtwork.id} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function ArchiveTaskCard({
  task,
  selected,
  expanded,
  pendingActions,
  onToggle,
  onToggleExpanded,
  onViewItems,
  onAction
}: {
  task: ArchiveTaskView
  selected: boolean
  expanded: boolean
  pendingActions: ReadonlySet<string>
  onToggle: (checked: boolean) => void
  onToggleExpanded: () => void
  onViewItems: () => void
  onAction: (action: SingleTaskAction) => void
}) {
  const canExpand = canExpandArchivePublishedMedia(task)
  const showExpanded = canExpand && expanded
  return (
    <Card
      data-state={selected ? 'selected' : undefined}
      className="gap-4 py-4 data-[state=selected]:ring-2 data-[state=selected]:ring-ring"
    >
      <CardHeader className="px-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`选择 ${task.title || `${task.providerKey} ${task.externalId}`}`}
          />
          <div className="min-w-0 flex-1">
            <TaskIdentity task={task} />
          </div>
          <TaskActions task={task} pendingActions={pendingActions} onViewItems={onViewItems} onAction={onAction} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <TaskStatus task={task} />
        <TaskProgress task={task} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>图片</span>
            <ArchiveImageCounts task={task} />
          </div>
          <span>{formatTaskTime(task.createdAt)}</span>
        </div>
        {canExpand && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleExpanded}
            className="w-fit -translate-x-3 text-muted-foreground hover:text-foreground"
            aria-label={showExpanded ? '收起已发布媒体' : '展开已发布媒体'}
            aria-expanded={showExpanded}
          >
            {showExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {showExpanded ? '收起已发布媒体' : '查看已发布媒体'}
          </Button>
        )}
      </CardContent>
      {showExpanded && task.publishedArtwork && (
        <div className="border-t bg-muted/10">
          <ArchivePublishedMediaPreview artworkId={task.publishedArtwork.id} />
        </div>
      )}
    </Card>
  )
}

function TaskIdentity({ task }: { task: ArchiveTaskOutput }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <PrivacySensitiveText as="p" className="line-clamp-2 font-medium">
        {task.title || `${task.providerKey} #${task.externalId}`}
      </PrivacySensitiveText>
      <PrivacySensitiveText as="p" className="truncate font-mono text-xs text-muted-foreground">
        {task.providerKey} #{task.externalId} · {task.submittedUrl}
      </PrivacySensitiveText>
      <div className="flex flex-wrap gap-1">
        {task.kind && <Badge variant="outline">{task.kind === 'UPDATE' ? '更新归档' : '首次归档'}</Badge>}
        {task.submissionId && <ArchiveSubmissionBadge submissionId={task.submissionId} />}
      </div>
    </div>
  )
}

function TaskStatus({ task }: { task: ArchiveTaskOutput }) {
  const lifecycleState = task.publishedArtwork?.archiveLifecycleState
  const displayStatus = archiveTaskDisplayStatus(task)
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <AdminStatusBadge status={displayStatus}>
          {archiveTaskStatusLabel(displayStatus, task.errorCode)}
        </AdminStatusBadge>
        <Badge variant="outline">{task.selectedQuality === 'ORIGINAL' ? '原图' : '展示质量'}</Badge>
      </div>
      {task.decisionCode === 'USE_DISPLAY_QUALITY' && <span className="text-xs text-warning">等待确认展示质量</span>}
      {lifecycleState === 'TRASHING' && <span className="text-xs text-warning">正在移入回收站</span>}
      {lifecycleState === 'RESTORING' && <span className="text-xs text-warning">正在从回收站恢复</span>}
      {lifecycleState === 'TRASHED' && <span className="text-xs text-muted-foreground">作品已在回收站</span>}
      <span className="text-xs text-muted-foreground">尝试 {task.attempt}</span>
    </div>
  )
}

function TaskActions({
  task,
  pendingActions,
  onViewItems,
  onAction
}: {
  task: ArchiveTaskOutput
  pendingActions: ReadonlySet<string>
  onViewItems: () => void
  onAction: (action: SingleTaskAction) => void
}) {
  const isPending = (action: SingleTaskAction) => pendingActions.has(singleActionKey(task.id, action))
  const lifecycleState = task.publishedArtwork?.archiveLifecycleState
  const deleted = lifecycleState === 'TRASHED'
  const lifecyclePending = lifecycleState === 'TRASHING' || lifecycleState === 'RESTORING'
  const maintenanceRetryAction = archiveMaintenanceRetryAction(lifecycleState)
  const displayStatus = archiveTaskDisplayStatus(task)
  const active = ACTIVE_STATUSES.has(displayStatus)
  return (
    <div className="flex justify-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="打开任务操作菜单">
            <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onViewItems}>
              <Images aria-hidden="true" />
              图片明细
            </DropdownMenuItem>
            {['RUNNING', 'RETRY_WAIT'].includes(displayStatus) && (
              <DropdownMenuItem disabled={isPending('PAUSE')} onSelect={() => onAction('PAUSE')}>
                {isPending('PAUSE') ? <Spinner /> : <CirclePause aria-hidden="true" />}暂停任务
              </DropdownMenuItem>
            )}
            {displayStatus === 'PAUSED' && task.decisionCode !== 'USE_DISPLAY_QUALITY' && (
              <DropdownMenuItem disabled={isPending('RESUME')} onSelect={() => onAction('RESUME')}>
                {isPending('RESUME') ? <Spinner /> : <CirclePlay aria-hidden="true" />}继续任务
              </DropdownMenuItem>
            )}
            {task.decisionCode === 'USE_DISPLAY_QUALITY' && (
              <DropdownMenuItem
                disabled={isPending('USE_DISPLAY_QUALITY')}
                onSelect={() => onAction('USE_DISPLAY_QUALITY')}
              >
                {isPending('USE_DISPLAY_QUALITY') ? <Spinner /> : <CirclePlay aria-hidden="true" />}改用展示质量继续
              </DropdownMenuItem>
            )}
            {['FAILED', 'CANCELLED'].includes(task.status) && (
              <DropdownMenuItem disabled={isPending('RETRY')} onSelect={() => onAction('RETRY')}>
                {isPending('RETRY') ? <Spinner /> : <RotateCcw aria-hidden="true" />}重试任务
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && task.publishedArtwork && !deleted && !lifecyclePending && (
              <DropdownMenuItem asChild>
                <Link href={`/artworks/${task.publishedArtwork.id}`}>
                  <ExternalLink aria-hidden="true" />
                  查看作品
                </Link>
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && deleted && (
              <DropdownMenuItem disabled={isPending('RESTORE_ARCHIVE')} onSelect={() => onAction('RESTORE_ARCHIVE')}>
                {isPending('RESTORE_ARCHIVE') ? <Spinner /> : <RotateCcw aria-hidden="true" />}从回收站恢复
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && maintenanceRetryAction && (
              <DropdownMenuItem
                disabled={isPending(maintenanceRetryAction)}
                onSelect={() => onAction(maintenanceRetryAction)}
              >
                {isPending(maintenanceRetryAction) ? <Spinner /> : <RefreshCw aria-hidden="true" />}
                {lifecycleState === 'TRASHING' ? '继续移入回收站' : '继续恢复归档'}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {(['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status) ||
            (task.status === 'COMPLETED' && task.publishedArtwork && !deleted && !lifecyclePending) ||
            (!active && task.status !== 'COMPLETED')) && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status) && (
              <DropdownMenuItem
                variant="destructive"
                disabled={task.status === 'CANCELLING' || isPending('CANCEL')}
                onSelect={() => onAction('CANCEL')}
              >
                {isPending('CANCEL') ? <Spinner /> : <Square aria-hidden="true" />}
                {task.status === 'CANCELLING' ? '正在取消' : '取消任务'}
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && task.publishedArtwork && !deleted && !lifecyclePending && (
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending('DELETE_ARCHIVE')}
                onSelect={() => onAction('DELETE_ARCHIVE')}
              >
                {isPending('DELETE_ARCHIVE') ? <Spinner /> : <Trash2 aria-hidden="true" />}移入回收站
              </DropdownMenuItem>
            )}
            {!active && task.status !== 'COMPLETED' && (
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending('DELETE_STAGING')}
                onSelect={() => onAction('DELETE_STAGING')}
              >
                {isPending('DELETE_STAGING') ? <Spinner /> : <Trash2 aria-hidden="true" />}清理暂存文件
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function BulkActionToolbar({
  selectedCount,
  eligibleCounts,
  pending,
  pendingAction,
  onAction,
  onClear
}: {
  selectedCount: number
  eligibleCounts: Record<ArchiveTaskBulkAction, number>
  pending: boolean
  pendingAction: ArchiveTaskBulkAction | undefined
  onAction: (action: ArchiveTaskBulkAction) => void
  onClear: () => void
}) {
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
  const confirmations: Partial<Record<SingleTaskAction, { title: ReactNode; description: string; confirmText: string }>> =
    {
      CANCEL: {
        title: task.title ? (
          <>
            取消“<PrivacySensitiveText>{task.title}</PrivacySensitiveText>”？
          </>
        ) : (
          `取消“${task.providerKey} #${task.externalId}”？`
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

function formatTaskTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}
