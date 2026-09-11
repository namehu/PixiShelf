'use client'

import type { inferRouterOutputs } from '@trpc/server'
import { ArchiveRestoreIcon, RotateCcwIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
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
  onToggle,
  isDesktop,
  layoutReady,
  position,
  onPositionChange
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
  isDesktop: boolean
  layoutReady: boolean
  position?: ArchiveDiscoveryListPosition
  onPositionChange: (position: ArchiveDiscoveryListPosition) => void
}) {
  return (
    <ArchiveDiscoveryResultList
      items={items}
      isDesktop={isDesktop}
      layoutReady={layoutReady}
      isLoading={isLoading}
      isError={isError}
      errorTitle="已忽略画廊加载失败"
      errorDescription="忽略决定仍保存在数据库中，请稍后重试。"
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={onLoadMore}
      onRetry={onRetry}
      positionKey="ignored"
      position={position}
      onPositionChange={onPositionChange}
      emptyState={
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveRestoreIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>还没有忽略画廊</EmptyTitle>
            <EmptyDescription>从发现结果中忽略的画廊会集中显示在这里，并可随时恢复。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
      header={
        <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground">
          <Checkbox
            checked={allSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label="选择当前已加载的忽略画廊，最多一百条"
          />
          <span>画廊</span>
          <span className="text-right">操作</span>
        </div>
      }
      renderItem={(item) => (
        <div className="border-b bg-background px-4 py-3">
          <div className="grid min-h-20 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3">
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
                <PrivacySensitiveText as="p" className="break-words font-medium sm:line-clamp-2">
                  {item.title}
                </PrivacySensitiveText>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">#{item.externalId}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  <PrivacySensitiveText>{item.sourceDisplayName}</PrivacySensitiveText> ·{' '}
                  {formatArchiveUploaderTimestamp(item.ignoredAt)}
                </p>
              </div>
            </div>
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
        </div>
      )}
    />
  )
}
