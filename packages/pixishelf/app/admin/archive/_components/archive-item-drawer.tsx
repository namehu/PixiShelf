'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { inferRouterOutputs } from '@trpc/server'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { SSheet } from '@/components/shared/s-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'

const PAGE_SIZE = 50

type RouterOutputs = inferRouterOutputs<AppRouter>
type ArchiveTask = RouterOutputs['archive']['listTasks'][number]
type ArchiveItem = RouterOutputs['archive']['listTaskItems']['items'][number]

export function ArchiveItemDrawer({
  open,
  task,
  onOpenChange
}: {
  open: boolean
  task: ArchiveTask | null
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const scrollRef = useRef<HTMLDivElement>(null)
  const itemsQuery = useInfiniteQuery(
    trpc.archive.listTaskItems.infiniteQueryOptions(
      { taskId: task?.id ?? '', limit: PAGE_SIZE },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: open && Boolean(task),
        staleTime: 5_000
      }
    )
  )
  const items = useMemo(() => itemsQuery.data?.pages.flatMap((batch) => batch.items) ?? [], [itemsQuery.data])
  const totalItems = itemsQuery.data?.pages[0]?.totalItems ?? task?.totalItems ?? 0
  const rowVirtualizer = useVirtualizer({
    useFlushSync: false,
    count: itemsQuery.hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 176,
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

  return (
    <SSheet
      open={open}
      onOpenChange={onOpenChange}
      title={task?.title || (task ? `E-Hentai #${task.externalId}` : '图片明细')}
      description={
        task
          ? `${task.providerKey} #${task.externalId} · ${task.completedItems}/${task.totalItems} 张已完成`
          : undefined
      }
      side="right"
      className="w-[min(100vw,46rem)] sm:max-w-[46rem]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <p className="mb-4 shrink-0 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          这里展示归档时保存的 E-Hentai 图片页链接；下载时临时解析的 CDN 直链可能过期，因此不会持久化。共 {totalItems}{' '}
          张，向下滚动会自动加载。
        </p>

        {itemsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : itemsQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {itemsQuery.error.message}
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
                      <ArchiveItemCard item={item} totalItems={totalItems} />
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        正在加载更多图片明细…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">该任务没有图片明细。</div>
        )}
      </div>
    </SSheet>
  )
}

function ArchiveItemCard({ item, totalItems }: { item: ArchiveItem; totalItems: number }) {
  const pageNumber = item.pageIndex + 1
  const numberLabel = String(pageNumber).padStart(String(Math.max(totalItems, 1)).length, '0')
  const metadata = [
    item.quality === 'ORIGINAL' ? '原图' : item.quality === 'DISPLAY' ? '展示质量' : null,
    item.mimeType,
    item.width && item.height ? `${item.width}×${item.height}` : null,
    formatBytes(item.byteCount)
  ].filter(Boolean)

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{numberLabel}</Badge>
        <ItemStatusBadge status={item.status} />
        <span className="text-xs text-muted-foreground">尝试 {item.attempts}</span>
        {metadata.length > 0 && <span className="text-xs text-muted-foreground">{metadata.join(' · ')}</span>}
      </div>

      <div className="flex items-start gap-1">
        <a
          href={item.sourcePageUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 break-all text-sm text-primary underline-offset-4 hover:underline"
        >
          {item.sourcePageUrl}
          <ExternalLink className="ml-1 inline size-3.5" />
        </a>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`复制第 ${pageNumber} 张图片页链接`}
          title="复制链接"
          onClick={() => copyLink(item.sourcePageUrl)}
        >
          <Copy />
        </Button>
      </div>

      <p className="break-all text-xs text-muted-foreground">预期文件名：{item.expectedFilename}</p>
      {item.stagedPath && <p className="break-all text-xs text-muted-foreground">暂存路径：{item.stagedPath}</p>}
      {item.errorMessage && (
        <p className="whitespace-pre-wrap break-words text-sm text-destructive">
          {item.errorCode ? `${item.errorCode}：` : ''}
          {item.errorMessage}
        </p>
      )}
    </div>
  )
}

function ItemStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PENDING: '等待下载',
    DOWNLOADING: '下载中',
    COMPLETED: '已完成',
    FAILED: '失败'
  }
  const variant = status === 'COMPLETED' ? 'default' : status === 'FAILED' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{labels[status] || status}</Badge>
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

async function copyLink(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success('图片页链接已复制')
  } catch {
    toast.error('复制失败，请手动选择链接')
  }
}
