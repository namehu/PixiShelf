'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery } from '@tanstack/react-query'
import { parseAsString, useQueryState } from 'nuqs'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileJson,
  FileSpreadsheet,
  FolderSearch,
  GripVertical,
  ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Video,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { confirm } from '@/components/shared/global-confirm'
import { combinationApiResource } from '@/utils/combination-static'
import { formatFileSize } from '@/utils/media'
import { PENDING_REPLACE_STALE_JOB_MS, type PendingReplaceMediaSnapshot } from '@/schemas/pending-replace.dto'
import type { BatchItemView, BatchView } from './batch-replace-types'
import { PendingReplacePairingWorkspace } from './pending-replace-pairing-workspace'

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'RUNNING', 'CANCELLING'])
const SUCCESS_ITEM_STATUSES = new Set(['SUCCESS', 'BACKUP_CLEANED'])
const SELECTABLE_ITEM_STATUSES = new Set(['READY', 'FAILED', 'EXCLUDED'])

export default function BatchReplaceManagement() {
  const trpc = useTRPC()
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())
  const [view, setView] = useQueryState('view', parseAsString.withOptions({ history: 'replace' }))

  const statusQuery = useQuery(
    trpc.pendingReplace.status.queryOptions(
      {},
      {
        refetchInterval: (query) => {
          const currentBatch = query.state.data as unknown as BatchView | null | undefined
          return currentBatch?.systemJob?.status && ACTIVE_JOB_STATUSES.has(currentBatch.systemJob.status) ? 1500 : 5000
        }
      }
    )
  )
  const batch = statusQuery.data as unknown as BatchView | null | undefined
  const previewMutation = useMutation(
    trpc.pendingReplace.preview.mutationOptions({
      onSuccess: async () => {
        toast.success('待替换目录扫描完成')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const startMutation = useMutation(
    trpc.pendingReplace.start.mutationOptions({
      onSuccess: async () => {
        toast.success('批量替换任务已启动')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.pendingReplace.cancel.mutationOptions({
      onSuccess: async () => statusQuery.refetch(),
      onError: (error) => toast.error(error.message)
    })
  )
  const restoreMutation = useMutation(
    trpc.pendingReplace.restore.mutationOptions({
      onSuccess: async () => {
        toast.success('旧媒体已恢复，新媒体已退回待处理目录')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const recoverMutation = useMutation(
    trpc.pendingReplace.recover.mutationOptions({
      onSuccess: async (result) => {
        toast.success(`中断现场已回滚，处理 ${result.recoveredItems} 个未完成项目`)
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cleanupMutation = useMutation(
    trpc.pendingReplace.cleanupBackups.mutationOptions({
      onSuccess: async () => {
        toast.success('本批次旧媒体备份已清理')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const reorderMutation = useMutation(
    trpc.pendingReplace.reorder.mutationOptions({
      onSuccess: async () => {
        toast.success('媒体顺序已保存')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  useEffect(() => {
    if (!batch || batch.status !== 'PREVIEWED') return
    setSelectedItemIds(new Set(batch.items.filter((item) => item.status === 'READY').map((item) => item.id)))
  }, [batch?.id, batch?.status, batch?.readyItems])

  useEffect(() => {
    if (!batch || batch.status === 'PREVIEWED') return
    const selectableIds = new Set(
      batch.items.filter((item) => SELECTABLE_ITEM_STATUSES.has(item.status)).map((item) => item.id)
    )
    setSelectedItemIds((current) => new Set([...current].filter((itemId) => selectableIds.has(itemId))))
  }, [batch?.id, batch?.status, batch?.readyItems, batch?.failedItems, batch?.excludedItems])

  const isRunning = Boolean(batch?.systemJob && ACTIVE_JOB_STATUSES.has(batch.systemJob.status))
  const jobHeartbeatAt = batch?.systemJob?.heartbeatAt ?? batch?.systemJob?.updatedAt
  const isRecoverable = Boolean(
    isRunning && jobHeartbeatAt && Date.now() - new Date(jobHeartbeatAt).getTime() >= PENDING_REPLACE_STALE_JOB_MS
  )
  const selectableItemIds =
    batch?.items.filter((item) => SELECTABLE_ITEM_STATUSES.has(item.status) && !isRunning).map((item) => item.id) ?? []
  const selectedCount = selectedItemIds.size
  const selectedAll = selectableItemIds.length > 0 && selectableItemIds.every((id) => selectedItemIds.has(id))
  const failedItemIds = batch?.items.filter((item) => item.status === 'FAILED').map((item) => item.id) ?? []
  const unboundCount =
    batch?.items.filter(
      (item) =>
        ['INVALID', 'READY', 'EXCLUDED'].includes(item.status) && item.newMediaSnapshot.length > 0 && !item.artworkId
    ).length ?? 0
  const pairingAvailable = batch?.status === 'PREVIEWED'
  const activeView =
    view === 'review'
      ? 'review'
      : view === 'pairing' && pairingAvailable
        ? 'pairing'
        : pairingAvailable && unboundCount > 0
          ? 'pairing'
          : 'review'

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedItemIds(checked ? new Set(selectableItemIds) : new Set())
  }

  const toggleExpanded = (itemId: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const start = (itemIds: string[]) => {
    if (!batch || itemIds.length === 0) return
    confirm({
      title: `替换选中的 ${itemIds.length} 个作品？`,
      description: '执行前会备份原媒体。任务开始后请保持服务运行，失败项目可单独重试。',
      confirmText: `开始替换 (${itemIds.length})`,
      onConfirm: () => startMutation.mutate({ batchId: batch.id, itemIds })
    })
  }

  return (
    <div className="min-h-full w-full bg-neutral-50/70 p-4 dark:bg-neutral-950/30 md:p-6">
      <div className="mx-auto w-full max-w-[1680px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
              <Link href="/admin/artworks">
                <ArrowLeft aria-hidden="true" />
                返回作品管理
              </Link>
            </Button>
            <h1 className="text-pretty text-2xl font-semibold tracking-normal text-foreground">批量替换作品媒体</h1>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <FolderSearch aria-hidden="true" className="size-4 shrink-0" />
              <code className="truncate rounded bg-muted px-1.5 py-0.5" translate="no">
                scanPath/pending-replaces
              </code>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end" aria-live="polite">
            <Button
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={isRunning || previewMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {previewMutation.isPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {previewMutation.isPending ? '扫描中…' : batch ? '重新扫描' : '扫描目录'}
            </Button>
            {isRunning ? (
              <>
                {isRecoverable && (
                  <Button
                    variant="outline"
                    disabled={recoverMutation.isPending}
                    onClick={() =>
                      batch &&
                      confirm({
                        title: '回收中断的替换任务？',
                        description: '仅在服务已经重启或任务确定停止时使用。未完成项目会回滚，已成功项目保持不变。',
                        confirmText: '回收任务',
                        onConfirm: () => recoverMutation.mutate({ batchId: batch.id })
                      })
                    }
                    className="flex-1 sm:flex-none"
                  >
                    {recoverMutation.isPending ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )}
                    恢复中断现场
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() =>
                    batch &&
                    confirm({
                      title: '停止当前替换任务？',
                      description: '当前项目完成安全回滚后，任务才会停止。',
                      confirmText: '停止任务',
                      onConfirm: () => cancelMutation.mutate({ batchId: batch.id })
                    })
                  }
                  disabled={batch?.systemJob?.status === 'CANCELLING'}
                  className="flex-1 sm:flex-none"
                >
                  <Square aria-hidden="true" />
                  {batch?.systemJob?.status === 'CANCELLING' ? '正在安全停止…' : '停止任务'}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => start([...selectedItemIds])}
                disabled={!batch || selectedCount === 0 || startMutation.isPending}
                className="flex-1 sm:flex-none"
              >
                {startMutation.isPending ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {startMutation.isPending ? '正在启动…' : `执行替换 (${selectedCount})`}
              </Button>
            )}
          </div>
        </header>

        <WorkflowStages
          batch={batch}
          unboundCount={unboundCount}
          isRunning={isRunning}
          scanning={previewMutation.isPending}
        />

        {statusQuery.isLoading ? (
          <LoadingState />
        ) : statusQuery.isError ? (
          <ErrorState message={statusQuery.error.message} onRetry={() => statusQuery.refetch()} />
        ) : batch ? (
          <>
            <BatchSummary batch={batch} />
            {batch.systemJob && <JobProgress batch={batch} />}

            {batch.items.length > 0 ? (
              <Tabs value={activeView} onValueChange={(nextView) => void setView(nextView)} className="gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <TabsList className={cn('grid w-full sm:w-auto', pairingAvailable ? 'grid-cols-2' : 'grid-cols-1')}>
                    {pairingAvailable && (
                      <TabsTrigger value="pairing" className="min-w-0 px-3 sm:min-w-40">
                        <Link2 aria-hidden="true" />
                        配对工作台
                        {unboundCount > 0 && (
                          <Badge variant="secondary" className="ml-1">
                            {unboundCount}
                          </Badge>
                        )}
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="review" className="min-w-0 px-3 sm:min-w-40">
                      <ListChecks aria-hidden="true" />
                      替换清单
                      <Badge variant="outline" className="ml-1">
                        {batch.totalItems}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                  {pairingAvailable && unboundCount > 0 && (
                    <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
                      还有 {unboundCount} 个目录需要配对
                    </p>
                  )}
                </div>

                {pairingAvailable && (
                  <TabsContent value="pairing" className="mt-0">
                    <PendingReplacePairingWorkspace
                      batch={batch}
                      disabled={isRunning}
                      onBound={() => statusQuery.refetch()}
                    />
                  </TabsContent>
                )}
                <TabsContent value="review" className="mt-0">
                  <BatchItemList
                    batch={batch}
                    selectedItemIds={selectedItemIds}
                    expandedItemIds={expandedItemIds}
                    selectedAll={selectedAll}
                    selectableCount={selectableItemIds.length}
                    isRunning={isRunning}
                    failedItemIds={failedItemIds}
                    savingOrder={reorderMutation.isPending}
                    restoring={restoreMutation.isPending}
                    cleaningUp={cleanupMutation.isPending}
                    onToggleSelected={toggleSelected}
                    onToggleAll={toggleAll}
                    onToggleExpanded={toggleExpanded}
                    onRetryFailed={() => start(failedItemIds)}
                    onSaveOrder={(itemId, orderedSourceNames) => reorderMutation.mutate({ itemId, orderedSourceNames })}
                    onRestore={(item) =>
                      confirm({
                        title: `恢复 ${item.artworkTitle || item.externalId} 的旧媒体？`,
                        description: '当前新媒体将退回 pending-replaces，旧媒体和数据库记录会恢复。',
                        confirmText: '恢复旧媒体',
                        onConfirm: () => restoreMutation.mutate({ itemId: item.id })
                      })
                    }
                    onCleanup={() =>
                      confirm({
                        title: '清理本批次旧媒体备份？',
                        description: '清理后将无法恢复旧媒体。',
                        confirmText: '清理备份',
                        onConfirm: () => cleanupMutation.mutate({ batchId: batch.id })
                      })
                    }
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <EmptyState onScan={() => previewMutation.mutate()} scanning={previewMutation.isPending} />
            )}
          </>
        ) : (
          <EmptyState onScan={() => previewMutation.mutate()} scanning={previewMutation.isPending} />
        )}
      </div>
    </div>
  )
}

function WorkflowStages({
  batch,
  unboundCount,
  isRunning,
  scanning
}: {
  batch: BatchView | null | undefined
  unboundCount: number
  isRunning: boolean
  scanning: boolean
}) {
  const currentStep = !batch || scanning ? 0 : batch.status === 'PREVIEWED' && unboundCount > 0 ? 1 : 2
  const steps = [
    { label: '扫描目录', icon: FolderSearch },
    { label: '确认配对', icon: Link2 },
    { label: isRunning ? '正在执行' : '复核与执行', icon: ListChecks }
  ]

  return (
    <ol className="grid grid-cols-3 overflow-hidden rounded-lg border bg-background" aria-label="批量替换进度">
      {steps.map((step, index) => {
        const complete = index < currentStep
        const active = index === currentStep
        const StepIcon = complete ? Check : step.icon
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'relative flex min-w-0 items-center justify-center gap-2 border-r px-2 py-3 text-xs font-medium last:border-r-0 sm:text-sm',
              complete && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
              active && 'bg-primary/10 text-primary',
              !complete && !active && 'text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border',
                active && 'border-primary bg-background'
              )}
            >
              <StepIcon aria-hidden="true" className="size-3.5" />
            </span>
            <span className="truncate">{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function BatchSummary({ batch }: { batch: BatchView }) {
  const stats = [
    { label: '目录', value: batch.totalItems },
    {
      label: '可执行',
      value: batch.readyItems,
      emphasis: batch.readyItems > 0 ? 'text-emerald-700 dark:text-emerald-300' : undefined
    },
    {
      label: '需处理',
      value: batch.invalidItems,
      emphasis: batch.invalidItems > 0 ? 'text-amber-700 dark:text-amber-300' : undefined
    },
    { label: '成功', value: batch.succeededItems },
    { label: '失败', value: batch.failedItems, emphasis: batch.failedItems > 0 ? 'text-destructive' : undefined },
    { label: '已恢复', value: batch.restoredItems }
  ]
  return (
    <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="batch-overview-title">
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 id="batch-overview-title" className="text-sm font-semibold">
            当前批次
          </h2>
          <BatchStatusBadge batch={batch} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>创建于 {formatDateTime(batch.createdAt)}</span>
          {batch.backupBytes > 0 && <span>备份 {formatFileSize(batch.backupBytes)}</span>}
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-y sm:grid-cols-6 sm:divide-y-0">
        {stats.map((stat) => (
          <div key={stat.label} className="px-3 py-3 sm:px-4">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className={cn('mt-0.5 text-xl font-semibold tabular-nums', stat.emphasis)}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function BatchStatusBadge({ batch }: { batch: BatchView }) {
  if (batch.systemJob?.status && ACTIVE_JOB_STATUSES.has(batch.systemJob.status)) {
    return (
      <Badge>
        <Loader2 aria-hidden="true" className="animate-spin" />
        执行中
      </Badge>
    )
  }
  if (batch.failedItems > 0) return <Badge variant="destructive">存在失败项</Badge>
  if (batch.succeededItems > 0 && batch.succeededItems === batch.totalItems) {
    return <Badge className="bg-emerald-600 text-white">已完成</Badge>
  }
  if (batch.status === 'PREVIEWED') return <Badge variant="secondary">等待确认</Badge>
  return <Badge variant="outline">{batch.status}</Badge>
}

function JobProgress({ batch }: { batch: BatchView }) {
  if (!batch.systemJob) return null
  return (
    <section className="rounded-lg border bg-background px-4 py-3" aria-live="polite" aria-label="替换任务进度">
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="min-w-0 truncate font-medium">{batch.systemJob.message || batch.systemJob.status}</span>
        <span className="shrink-0 font-medium tabular-nums">{batch.systemJob.progress}%</span>
      </div>
      <Progress value={batch.systemJob.progress} aria-label={`任务完成 ${batch.systemJob.progress}%`} />
      {batch.systemJob.error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {batch.systemJob.error}。请检查失败项目后重试。
        </p>
      )}
    </section>
  )
}

interface BatchItemListProps {
  batch: BatchView
  selectedItemIds: Set<string>
  expandedItemIds: Set<string>
  selectedAll: boolean
  selectableCount: number
  isRunning: boolean
  failedItemIds: string[]
  savingOrder: boolean
  restoring: boolean
  cleaningUp: boolean
  onToggleSelected: (itemId: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  onToggleExpanded: (itemId: string) => void
  onRetryFailed: () => void
  onSaveOrder: (itemId: string, orderedSourceNames: string[]) => void
  onRestore: (item: BatchItemView) => void
  onCleanup: () => void
}

function BatchItemList({
  batch,
  selectedItemIds,
  expandedItemIds,
  selectedAll,
  selectableCount,
  isRunning,
  failedItemIds,
  savingOrder,
  restoring,
  cleaningUp,
  onToggleSelected,
  onToggleAll,
  onToggleExpanded,
  onRetryFailed,
  onSaveOrder,
  onRestore,
  onCleanup
}: BatchItemListProps) {
  const selectedCount = selectedItemIds.size
  return (
    <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="replace-list-title">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <label className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
            <Checkbox
              checked={selectedAll ? true : selectedCount > 0 ? 'indeterminate' : false}
              disabled={selectableCount === 0 || isRunning}
              onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
              aria-label="选择全部可执行项目"
            />
          </label>
          <div className="min-w-0">
            <h2 id="replace-list-title" className="text-sm font-semibold">
              替换清单
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              已选择 {selectedCount} / {selectableCount} 个可执行项目
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {failedItemIds.length > 0 && !isRunning && (
            <Button variant="outline" size="sm" onClick={onRetryFailed}>
              <RotateCcw aria-hidden="true" />
              重试失败项 ({failedItemIds.length})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" aria-label="打开批次操作菜单">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => downloadReport(batch, 'json')}>
                <FileJson aria-hidden="true" />
                下载 JSON 报告
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadReport(batch, 'csv')}>
                <FileSpreadsheet aria-hidden="true" />
                下载 CSV 报告
              </DropdownMenuItem>
              {batch.backupBytes > 0 && !isRunning && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={cleaningUp} onSelect={onCleanup}>
                    <Trash2 aria-hidden="true" />
                    {cleaningUp ? '正在清理…' : '清理旧媒体备份'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="divide-y">
        {batch.items.map((item) => {
          const expanded = expandedItemIds.has(item.id)
          const selectable = SELECTABLE_ITEM_STATUSES.has(item.status) && !isRunning
          return (
            <article key={item.id} className="group scroll-mt-20 focus-within:bg-muted/30 hover:bg-muted/20">
              <div className="flex items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4">
                <label className="mt-0.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
                  <Checkbox
                    checked={selectedItemIds.has(item.id)}
                    disabled={!selectable}
                    onCheckedChange={(value) => onToggleSelected(item.id, Boolean(value))}
                    aria-label={`选择 ${item.sourceDirectoryName}`}
                  />
                </label>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? '收起' : '展开'} ${item.sourceDirectoryName} 的媒体详情`}
                  onClick={() => onToggleExpanded(item.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="max-w-full truncate text-sm font-medium" title={item.sourceDirectoryName}>
                        {item.sourceDirectoryName}
                      </span>
                      <ItemStatusBadge item={item} />
                      {item.warnings.length > 0 && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                          <AlertTriangle aria-hidden="true" />
                          {item.warnings.length} 条警告
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.artworkTitle || '未匹配作品'}
                      {item.externalId ? ` · ${item.externalId}` : ''} · 旧 {item.oldMediaSnapshot.length} / 新{' '}
                      {item.newMediaSnapshot.length}
                    </span>
                    {item.error && (
                      <span className="mt-1 block whitespace-pre-wrap text-xs text-destructive" role="alert">
                        {item.error}。请修正目录或排除此项后重新执行。
                      </span>
                    )}
                  </span>
                </button>
                {item.status === 'SUCCESS' && item.backupDirectory && !isRunning && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoring}
                    onClick={() => onRestore(item)}
                    className="shrink-0"
                  >
                    {restoring ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">恢复旧媒体</span>
                  </Button>
                )}
              </div>
              {expanded && (
                <ExpandedItem
                  item={item}
                  canReorder={batch.status === 'PREVIEWED' && item.status === 'READY'}
                  onSaveOrder={(orderedSourceNames) => onSaveOrder(item.id, orderedSourceNames)}
                  savingOrder={savingOrder}
                />
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ExpandedItem({
  item,
  canReorder,
  onSaveOrder,
  savingOrder
}: {
  item: BatchItemView
  canReorder: boolean
  onSaveOrder: (names: string[]) => void
  savingOrder: boolean
}) {
  return (
    <div className="border-t bg-muted/10 p-4 sm:pl-16">
      <div className="grid gap-5 xl:grid-cols-2">
        <MediaPreviewGroup title="替换前" item={item} media={item.oldMediaSnapshot.slice(0, 5)} side="old" />
        <MediaPreviewGroup title="替换后" item={item} media={item.newMediaSnapshot.slice(0, 5)} side="new" />
      </div>
      {item.warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {item.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      {canReorder && item.newMediaSnapshot.length > 1 && (
        <MediaOrderEditor media={item.newMediaSnapshot} onSave={onSaveOrder} saving={savingOrder} />
      )}
    </div>
  )
}

function MediaPreviewGroup({
  title,
  item,
  media,
  side
}: {
  title: string
  item: BatchItemView
  media: PendingReplaceMediaSnapshot[]
  side: 'old' | 'new'
}) {
  return (
    <section aria-label={`${title}媒体预览`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">前 {Math.min(media.length, 5)} 项</span>
      </div>
      {media.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">无媒体</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {media.map((entry) => (
            <MediaPreviewCard key={`${side}-${entry.path}-${entry.order}`} item={item} media={entry} side={side} />
          ))}
        </div>
      )}
    </section>
  )
}

function MediaPreviewCard({
  item,
  media,
  side
}: {
  item: BatchItemView
  media: PendingReplaceMediaSnapshot
  side: 'old' | 'new'
}) {
  const extension = media.targetName.split('.').pop()?.toLowerCase()
  const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(extension || '')
  const path = resolvePreviewPath(item, media, side)
  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
        {isVideo ? (
          <Video aria-hidden="true" className="size-8 text-muted-foreground" />
        ) : path ? (
          <img
            src={combinationApiResource(path)}
            alt={media.sourceName}
            width={240}
            height={240}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1 p-2 text-[11px]">
        <div className="truncate" title={media.sourceName}>
          {media.sourceName}
        </div>
        {side === 'new' && (
          <div className="truncate text-muted-foreground" title={media.targetName}>
            → {media.targetName}
          </div>
        )}
        <div className="truncate text-muted-foreground">
          {media.width}×{media.height} · {formatFileSize(media.size)}
        </div>
      </div>
    </div>
  )
}

function MediaOrderEditor({
  media,
  onSave,
  saving
}: {
  media: PendingReplaceMediaSnapshot[]
  onSave: (names: string[]) => void
  saving: boolean
}) {
  const descriptionId = useId()
  const initialOrder = useMemo(
    () => [...media].sort((a, b) => a.order - b.order).map((item) => item.sourceName),
    [media]
  )
  const [names, setNames] = useState(initialOrder)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  useEffect(() => setNames(initialOrder), [initialOrder])
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setNames((current) => arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id))))
  }
  return (
    <section className="mt-5 rounded-md border bg-background p-3" aria-labelledby={`${descriptionId}-title`}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id={`${descriptionId}-title`} className="text-sm font-medium">
            完整媒体顺序
          </h3>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            拖动项目或使用空格键与方向键调整最终顺序。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || names.every((name, index) => name === initialOrder[index])}
          onClick={() => onSave(names)}
        >
          {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Save aria-hidden="true" />}
          {saving ? '正在保存…' : '保存顺序'}
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={names} strategy={verticalListSortingStrategy}>
          <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain">
            {names.map((name, index) => (
              <SortableMediaRow key={name} id={name} order={index} descriptionId={descriptionId} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function SortableMediaRow({ id, order, descriptionId }: { id: string; order: number; descriptionId: string }) {
  const sortable = useSortable({ id })
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="flex min-w-0 items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs"
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`调整 ${id} 的顺序，当前位置 p${order}`}
        aria-describedby={descriptionId}
        className="touch-none rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <span className="w-8 shrink-0 font-mono text-muted-foreground">p{order}</span>
      <span className="min-w-0 truncate">{id}</span>
    </div>
  )
}

function ItemStatusBadge({ item }: { item: BatchItemView }) {
  const { status } = item
  if (['SUCCESS', 'BACKUP_CLEANED'].includes(status)) {
    return (
      <Badge className="bg-emerald-600 text-white">
        <CheckCircle2 aria-hidden="true" />
        成功
      </Badge>
    )
  }
  if (status === 'RESTORED') {
    return (
      <Badge variant="secondary">
        <RotateCcw aria-hidden="true" />
        已恢复
      </Badge>
    )
  }
  if (status === 'INVALID' && !item.artworkId && item.newMediaSnapshot.length > 0) {
    return <Badge className="bg-amber-500 text-white">待配对</Badge>
  }
  if (['INVALID', 'FAILED'].includes(status)) {
    return (
      <Badge variant="destructive">
        <XCircle aria-hidden="true" />
        {status === 'INVALID' ? '无效' : '失败'}
      </Badge>
    )
  }
  if (status === 'EXCLUDED') return <Badge variant="outline">已排除</Badge>
  if (
    ['STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'ROLLING_BACK', 'RESTORING', 'RESTORE_SWAPPING'].includes(
      status
    )
  ) {
    return (
      <Badge>
        <Loader2 aria-hidden="true" className="animate-spin" />
        处理中
      </Badge>
    )
  }
  return <Badge variant="secondary">待执行</Badge>
}

function LoadingState() {
  return (
    <div
      className="flex min-h-64 items-center justify-center rounded-lg border bg-background text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 aria-hidden="true" className="mr-2 size-5 animate-spin" />
      正在加载批次…
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex min-h-64 flex-col items-center justify-center rounded-lg border bg-background px-6 text-center"
      role="alert"
    >
      <XCircle aria-hidden="true" className="mb-3 size-9 text-destructive" />
      <p className="font-medium">无法加载批次</p>
      <p className="mt-1 max-w-xl break-words text-sm text-muted-foreground">{message}。请检查服务状态后重试。</p>
      <Button variant="outline" className="mt-4" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        重新加载
      </Button>
    </div>
  )
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed bg-background px-6 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <FolderSearch aria-hidden="true" className="size-6 text-muted-foreground" />
      </span>
      <h2 className="text-base font-semibold">暂无待替换批次</h2>
      <p className="mt-1 text-sm text-muted-foreground">待替换目录准备好后即可开始扫描。</p>
      <Button className="mt-4" onClick={onScan} disabled={scanning}>
        {scanning ? <Loader2 aria-hidden="true" className="animate-spin" /> : <FolderSearch aria-hidden="true" />}
        {scanning ? '扫描中…' : '扫描目录'}
      </Button>
    </div>
  )
}

function resolvePreviewPath(item: BatchItemView, media: PendingReplaceMediaSnapshot, side: 'old' | 'new') {
  if (side === 'old') {
    return item.status === 'SUCCESS' && item.backupDirectory
      ? joinStoredPath(item.backupDirectory, media.sourceName)
      : media.path
  }
  if (SUCCESS_ITEM_STATUSES.has(item.status) && item.targetDirectory) {
    return joinStoredPath(item.targetDirectory, media.targetName)
  }
  return media.path
}

function joinStoredPath(directory: string, name: string) {
  return `${directory.replace(/\/$/, '')}/${name}`
}

function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  }).format(new Date(value))
}

function downloadReport(batch: BatchView, format: 'json' | 'csv') {
  const content =
    format === 'json'
      ? JSON.stringify(batch, null, 2)
      : [
          ['externalId', 'artworkId', 'title', 'sourceDirectory', 'status', 'oldMedia', 'newMedia', 'error'],
          ...batch.items.map((item) => [
            item.externalId ?? '',
            item.artworkId ?? '',
            item.artworkTitle ?? '',
            item.sourceDirectory,
            item.status,
            item.oldMediaSnapshot.length,
            item.newMediaSnapshot.length,
            item.error ?? ''
          ])
        ]
          .map((row) => row.map(csvCell).join(','))
          .join('\n')
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `pending-replace-${batch.id}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  return `"${String(value).replace(/"/g, '""')}"`
}
