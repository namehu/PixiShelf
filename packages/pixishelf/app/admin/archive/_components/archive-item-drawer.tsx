'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { inferRouterOutputs } from '@trpc/server'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { SSheet } from '@/components/shared/s-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'
import { archiveClientErrorMessage } from './archive-client-error'
import {
  archiveItemPollingIntervals,
  defaultArchiveItemFilter,
  type ArchiveItemFilter
} from './archive-item-view-state'

const PAGE_SIZE = 50

type RouterOutputs = inferRouterOutputs<AppRouter>
interface ArchiveTask {
  id: string
  providerKey: string
  externalId: string
  title: string | null
  status: string
  errorCode: string | null
  totalItems: number
  completedItems: number
  failedItems: number
}
type ArchiveItem = RouterOutputs['archive']['listTaskItems']['items'][number]

export function ArchiveItemDrawer({
  open,
  task,
  onOpenChange,
  onTaskChanged,
  realtimeConnected = false,
  liveRefreshVersion = 0
}: {
  open: boolean
  task: ArchiveTask | null
  onOpenChange: (open: boolean) => void
  onTaskChanged: () => void | Promise<unknown>
  realtimeConnected?: boolean
  liveRefreshVersion?: number
}) {
  const trpc = useTRPC()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<ArchiveItemFilter>('ALL')
  const partialFailure = Boolean(task?.status === 'FAILED' && task.errorCode === 'PARTIAL_FAILURE')
  const polling = realtimeConnected
    ? { counts: false as const, items: false as const }
    : archiveItemPollingIntervals(task?.status ?? '')

  useEffect(() => {
    if (!open || !task) return
    setFilter(defaultArchiveItemFilter(task.status, task.errorCode))
    scrollRef.current?.scrollTo({ top: 0 })
  }, [open, partialFailure, task?.id])

  const countsQuery = useQuery(
    trpc.archive.getTaskItemCounts.queryOptions(
      { taskId: task?.id ?? '' },
      {
        enabled: open && Boolean(task),
        refetchInterval: polling.counts,
        staleTime: polling.counts ? 0 : 5_000
      }
    )
  )
  const itemsQuery = useInfiniteQuery(
    trpc.archive.listTaskItems.infiniteQueryOptions(
      { taskId: task?.id ?? '', limit: PAGE_SIZE, status: filter },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: open && Boolean(task),
        refetchInterval: polling.items,
        staleTime: polling.items ? 0 : 5_000
      }
    )
  )
  const retryMutation = useMutation(
    trpc.archive.retryTaskItem.mutationOptions({
      onSuccess: async () => {
        toast.success('已将选中的图片重新加入下载队列')
        await Promise.all([countsQuery.refetch(), itemsQuery.refetch(), onTaskChanged()])
      },
      onError: (error) => toast.error(archiveClientErrorMessage(error, '图片重试失败，请稍后再试。'))
    })
  )

  useEffect(() => {
    if (!open || !task || !realtimeConnected || liveRefreshVersion === 0) return
    void Promise.all([countsQuery.refetch(), itemsQuery.refetch()])
  }, [liveRefreshVersion, open, realtimeConnected, task?.id])
  const items = useMemo(() => itemsQuery.data?.pages.flatMap((batch) => batch.items) ?? [], [itemsQuery.data])
  const totalItems = countsQuery.data?.all ?? task?.totalItems ?? 0
  const filteredItems = filterCount(filter, countsQuery.data, task)
  const rowVirtualizer = useVirtualizer({
    useFlushSync: false,
    count: itemsQuery.hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 192,
    overscan: 5
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualIndex = virtualRows.at(-1)?.index

  useEffect(() => {
    if (
      lastVirtualIndex == null ||
      lastVirtualIndex < items.length - 5 ||
      !itemsQuery.hasNextPage ||
      itemsQuery.isFetchingNextPage
    ) {
      return
    }
    void itemsQuery.fetchNextPage()
  }, [items.length, itemsQuery.fetchNextPage, itemsQuery.hasNextPage, itemsQuery.isFetchingNextPage, lastVirtualIndex])

  const refresh = async () => {
    await Promise.all([countsQuery.refetch(), itemsQuery.refetch(), onTaskChanged()])
  }

  return (
    <SSheet
      open={open}
      onOpenChange={onOpenChange}
      title={task?.title || (task ? `${task.providerKey} #${task.externalId}` : '图片明细')}
      description={
        task
          ? `${task.providerKey} #${task.externalId} · 成功 ${task.completedItems} · 失败 ${task.failedItems} · 共 ${task.totalItems} 张`
          : undefined
      }
      side="right"
      className="w-[min(100vw,46rem)] sm:max-w-[46rem]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex shrink-0 items-start gap-2 rounded-md border bg-muted/30 p-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            保存的是稳定的 E-Hentai 图片页链接；临时 CDN 直链不会持久化。筛选由服务端执行，向下滚动自动加载。
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="刷新明细"
            aria-label="刷新图片明细"
            disabled={itemsQuery.isFetching || countsQuery.isFetching}
            onClick={() => void refresh()}
          >
            <RefreshCw
              data-icon="inline-start"
              aria-hidden="true"
              className={itemsQuery.isFetching || countsQuery.isFetching ? 'animate-spin' : ''}
            />
          </Button>
        </div>

        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value as ArchiveItemFilter)
            scrollRef.current?.scrollTo({ top: 0 })
          }}
          className="mb-4 shrink-0"
        >
          <TabsList className="grid h-auto w-full grid-cols-3 sm:grid-cols-5">
            <TabsTrigger value="ALL">全部 {countsQuery.data?.all ?? totalItems}</TabsTrigger>
            <TabsTrigger value="COMPLETED">成功 {countsQuery.data?.completed ?? task?.completedItems ?? 0}</TabsTrigger>
            <TabsTrigger value="FAILED">失败 {countsQuery.data?.failed ?? task?.failedItems ?? 0}</TabsTrigger>
            <TabsTrigger value="PENDING">待下载 {countsQuery.data?.pending ?? 0}</TabsTrigger>
            <TabsTrigger value="DOWNLOADING">下载中 {countsQuery.data?.downloading ?? 0}</TabsTrigger>
          </TabsList>
        </Tabs>

        {itemsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">正在加载图片明细</span>
          </div>
        ) : itemsQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            图片明细暂时无法加载，请稍后重试。
          </div>
        ) : items.length ? (
          <div
            ref={scrollRef}
            role="region"
            aria-label="图片明细列表"
            tabIndex={0}
            className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {virtualRows.map((virtualRow) => {
                const item = items[virtualRow.index]
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 top-0 w-full pb-3"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {item ? (
                      <ArchiveItemCard
                        item={item}
                        totalItems={totalItems}
                        canRetry={partialFailure && item.status === 'FAILED'}
                        retrying={retryMutation.isPending && retryMutation.variables?.itemId === item.id}
                        onRetry={() => task && retryMutation.mutate({ taskId: task.id, itemId: item.id })}
                      />
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        正在加载更多图片明细…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {filteredItems === 0 ? '当前筛选条件下没有图片。' : '该任务没有图片明细。'}
          </div>
        )}
      </div>
    </SSheet>
  )
}

function ArchiveItemCard({
  item,
  totalItems,
  canRetry,
  retrying,
  onRetry
}: {
  item: ArchiveItem
  totalItems: number
  canRetry: boolean
  retrying: boolean
  onRetry: () => void
}) {
  const pageNumber = item.pageIndex + 1
  const numberLabel = String(pageNumber).padStart(String(Math.max(totalItems, 1)).length, '0')
  const metadata = [
    item.quality === 'ORIGINAL' ? '原图' : item.quality === 'DISPLAY' ? '展示质量' : null,
    item.mimeType,
    item.width && item.height ? `${item.width}×${item.height}` : null,
    formatBytes(item.byteCount)
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{numberLabel}</Badge>
        <ItemStatusBadge status={item.status} attempts={item.attempts} />
        <span className="text-xs text-muted-foreground">尝试 {item.attempts}</span>
        {metadata.length > 0 && <span className="text-xs text-muted-foreground">{metadata.join(' · ')}</span>}
        {canRetry && (
          <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={retrying} onClick={onRetry}>
            {retrying ? (
              <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
            )}
            重试此图
          </Button>
        )}
      </div>

      <p className="break-all text-sm text-muted-foreground">图片页来源：{item.sourcePageUrl}</p>

      <p className="break-all text-xs text-muted-foreground">预期文件名：{item.expectedFilename}</p>
      {(item.errorStage || item.remoteHost) && (
        <p className="break-all text-xs text-warning-foreground">
          失败位置：{failureStageLabel(item.errorStage)}
          {item.remoteHost ? ` · ${item.remoteHost}` : ''}
        </p>
      )}
      {item.errorMessage && (
        <p className="whitespace-pre-wrap break-words text-sm text-destructive">
          {item.errorCode ? `${item.errorCode}：` : ''}
          {item.errorMessage}
        </p>
      )}
    </div>
  )
}

function ItemStatusBadge({ status, attempts }: { status: string; attempts: number }) {
  const labels: Record<string, string> = {
    PENDING: attempts > 0 ? '等待下一轮重试' : '等待下载',
    DOWNLOADING: '下载中',
    COMPLETED: '已完成',
    FAILED: '失败'
  }
  const variant = status === 'COMPLETED' ? 'default' : status === 'FAILED' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{labels[status] || status}</Badge>
}

function filterCount(
  filter: ArchiveItemFilter,
  counts: RouterOutputs['archive']['getTaskItemCounts'] | undefined,
  task: ArchiveTask | null
): number {
  if (filter === 'ALL') return counts?.all ?? task?.totalItems ?? 0
  if (filter === 'COMPLETED') return counts?.completed ?? task?.completedItems ?? 0
  if (filter === 'FAILED') return counts?.failed ?? task?.failedItems ?? 0
  if (filter === 'PENDING') return counts?.pending ?? 0
  return counts?.downloading ?? 0
}

function failureStageLabel(value: string | null): string {
  const labels: Record<string, string> = {
    SOURCE_PAGE: '图片页',
    PROXY_CONNECT: '代理连接',
    TLS_HANDSHAKE: 'TLS 握手',
    MEDIA_REQUEST: '媒体请求',
    MEDIA_STREAM: '媒体传输',
    MEDIA_VALIDATION: '图片校验',
    STORAGE: '本地存储'
  }
  return value ? labels[value] || value : '未知阶段'
}

function formatBytes(value: string | null): string | null {
  const bytes = Number(value)
  if (!value || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1024
  let unit = units[0]!
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024
    unit = units[index]!
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${unit}`
}
