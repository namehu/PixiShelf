'use client'

import { cn } from '@/lib/utils'

import type { inferRouterOutputs } from '@trpc/server'
import { ExternalLinkIcon, ArchiveRestoreIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
import { ArchiveUploaderGalleryThumbnail } from './archive-uploader-result-visuals'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'
import { ArchiveDiscoverySelectionSurface } from './archive-discovery-selection-surface'

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
  mutationPending,
  selectedItemIds,
  allSelected,
  onToggleAll,
  onToggle,
  isDesktop,
  layoutReady,
  position,
  positionKey = 'ignored',
  scoped = false,
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
  mutationPending: boolean
  selectedItemIds: Set<string>
  allSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggle: (itemId: string, checked: boolean) => void
  isDesktop: boolean
  layoutReady: boolean
  position?: ArchiveDiscoveryListPosition
  positionKey?: string
  scoped?: boolean
  onPositionChange: (position: ArchiveDiscoveryListPosition) => void
}) {
  return (
    <ArchiveDiscoveryResultList
      items={items}
      view={resultView}
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
      positionKey={positionKey}
      position={position}
      onPositionChange={onPositionChange}
      emptyState={
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveRestoreIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{scoped ? '本来源没有已忽略画廊' : '还没有忽略画廊'}</EmptyTitle>
            <EmptyDescription>
              {scoped
                ? '这里显示本来源发现过的全局已忽略画廊，包括被本地规则过滤的结果。'
                : '从发现结果中忽略的画廊会集中显示在这里，并可随时恢复。'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
      header={
        <div className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b bg-muted/30 px-3 sm:gap-3 sm:px-4 text-xs font-medium text-muted-foreground">
          <Checkbox
            disabled={mutationPending}
            checked={allSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label="选择当前已加载的忽略画廊，最多一百条"
          />
          <span>画廊</span>
          <span className="text-right">链接</span>
        </div>
      }
      renderItem={(item) => (
        <ArchiveDiscoverySelectionSurface
          itemId={item.id}
          title={item.title}
          checked={selectedItemIds.has(item.id)}
          disabled={mutationPending || (!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS)}
          onToggle={(checked) => onToggle(item.id, checked)}
          className={resultView === 'cards' ? 'h-full rounded-lg border p-3' : 'border-b px-3 py-3 sm:px-4'}
        >
          <div
            className={cn(
              'relative grid items-start gap-2 sm:gap-3',
              resultView === 'cards' ? 'grid-cols-[1.5rem_minmax(0,1fr)]' : 'grid-cols-[1.5rem_minmax(0,1fr)_auto]'
            )}
          >
            <Checkbox
              className="mt-1"
              checked={selectedItemIds.has(item.id)}
              disabled={
                mutationPending || (!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS)
              }
              onCheckedChange={(checked) => onToggle(item.id, checked === true)}
              aria-label={`选择 ${item.title}`}
            />
            <div
              className={cn(
                'flex min-w-0 gap-3',
                resultView === 'cards' ? 'order-3 col-span-2 flex-col' : 'items-start',
                resultView === 'preview' && 'col-span-3 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1'
              )}
            >
              {resultView !== 'list' ? (
                <ArchiveUploaderGalleryThumbnail key={item.id} item={item} card={resultView === 'cards'} />
              ) : null}
              <div className="min-w-0 w-full flex-1">
                <PrivacySensitiveText as="p" className="line-clamp-2 break-words font-medium">
                  {item.title}
                </PrivacySensitiveText>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="tabular-nums">#{item.externalId}</span> ·{' '}
                  <PrivacySensitiveText>{item.sourceDisplayName}</PrivacySensitiveText> ·{' '}
                  {formatArchiveUploaderTimestamp(item.ignoredAt)}
                </p>
              </div>
            </div>
            <div
              className={cn(
                'flex items-center justify-end',
                resultView === 'cards' ? 'col-start-2 row-start-1' : 'col-start-3 row-start-1',
                resultView === 'list' && 'max-sm:flex-col'
              )}
            >
              {item.catalogItemId ? (
                <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-9">
                  <a
                    href={`/api/archive/catalog/${encodeURIComponent(item.catalogItemId)}/source`}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    aria-label={`打开原站 ${item.title}`}
                  >
                    <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
                    原站
                  </a>
                </Button>
              ) : (
                <span
                  className="flex min-h-11 items-center gap-2 px-2 text-xs text-muted-foreground"
                  title="来源地址不可用"
                >
                  <ExternalLinkIcon aria-hidden="true" />
                  原站不可用
                </span>
              )}
            </div>
          </div>
        </ArchiveDiscoverySelectionSurface>
      )}
    />
  )
}
