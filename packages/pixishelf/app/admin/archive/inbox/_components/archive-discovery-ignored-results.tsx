'use client'

import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { inferRouterOutputs } from '@trpc/server'
import { ArchiveRestoreIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { ArchiveUploaderGalleryThumbnail, type ArchiveUploaderPreviewItem } from './archive-uploader-result-visuals'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'

type IgnoredItem = inferRouterOutputs<AppRouter>['archiveSearch']['listIgnoredItems']['items'][number]
const MAX_SELECTED_ITEMS = 100

export function IgnoredResults({
  items,
  resultView,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onPreview,
  onRestore,
  mutationPending,
  selectedItemIds,
  allSelected,
  onToggleAll,
  onToggle
}: {
  items: IgnoredItem[]
  resultView: ArchiveUploaderResultView
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRetry: () => void
  onPreview: (item: ArchiveUploaderPreviewItem) => void
  onRestore: (itemId: string) => void
  mutationPending: boolean
  selectedItemIds: Set<string>
  allSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggle: (itemId: string, checked: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    useFlushSync: false,
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 104,
    overscan: 6
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualIndex = virtualRows.at(-1)?.index

  useEffect(() => {
    if (lastVirtualIndex == null || lastVirtualIndex < items.length - 6 || !hasNextPage || isFetchingNextPage) return
    onLoadMore()
  }, [hasNextPage, isFetchingNextPage, items.length, lastVirtualIndex, onLoadMore])

  if (isLoading) return <Skeleton className="h-[60vh] min-h-80 w-full" />
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>已忽略画廊加载失败</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>忽略决定仍保存在数据库中，请稍后重试。</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArchiveRestoreIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>还没有忽略画廊</EmptyTitle>
          <EmptyDescription>从发现结果中忽略的画廊会集中显示在这里，并可随时恢复。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground sm:grid-cols-[2.5rem_minmax(0,1fr)_10rem_10rem_5rem]">
        <Checkbox
          checked={allSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => onToggleAll(checked === true)}
          aria-label="选择当前已加载的忽略画廊，最多一百条"
        />
        <span>画廊</span>
        <span className="hidden sm:block">忽略来源</span>
        <span className="hidden sm:block">忽略时间</span>
        <span className="hidden sm:block">操作</span>
      </div>
      <ScrollArea className="h-[60vh] min-h-80 max-h-[44rem]" viewportRef={scrollRef}>
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow) => {
            const item = items[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 w-full border-b bg-background px-4 py-3"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {item ? (
                  <div className="grid min-h-20 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_10rem_10rem_5rem]">
                    <Checkbox
                      checked={selectedItemIds.has(item.id)}
                      disabled={!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS}
                      onCheckedChange={(checked) => onToggle(item.id, checked === true)}
                      aria-label={`选择 ${item.title}`}
                    />
                    <div className="flex min-w-0 items-center gap-3">
                      {resultView === 'preview' ? (
                        <ArchiveUploaderGalleryThumbnail key={item.id} item={item} onPreview={onPreview} />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <PrivacySensitiveText as="p" className="line-clamp-2 font-medium">
                          {item.title}
                        </PrivacySensitiveText>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          E-Hentai #{item.externalId}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground sm:hidden">
                          <PrivacySensitiveText>{item.sourceDisplayName}</PrivacySensitiveText> ·{' '}
                          {formatArchiveUploaderTimestamp(item.ignoredAt)}
                        </p>
                      </div>
                    </div>
                    <PrivacySensitiveText as="p" className="hidden truncate text-sm text-muted-foreground sm:block">
                      {item.sourceDisplayName}
                    </PrivacySensitiveText>
                    <p className="hidden whitespace-nowrap text-sm text-muted-foreground sm:block">
                      {formatArchiveUploaderTimestamp(item.ignoredAt)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRestore(item.id)}
                      disabled={mutationPending}
                      aria-label={`恢复 ${item.title}`}
                    >
                      <RotateCcwIcon aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Spinner aria-hidden="true" />
                    正在加载更多结果…
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t px-4 text-xs text-muted-foreground">
        <span>
          已加载 {items.length} 条 · 单次最多选择 {MAX_SELECTED_ITEMS} 条
        </span>
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            加载中
          </span>
        ) : hasNextPage ? (
          <span>继续向下滚动</span>
        ) : (
          <span>已加载全部</span>
        )}
      </div>
    </Card>
  )
}
