'use client'

import type { inferRouterOutputs } from '@trpc/server'
import { ArrowUpRightIcon, BanIcon, RotateCcwIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { CatalogStatusBadge, DiscoveryCreatorStatus } from './discovery-creator-status'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
import { type ArchiveDiscoveryCatalogView, resultFeedLabel } from './archive-discovery-results-toolbar'
import { ArchiveUploaderGalleryThumbnail } from './archive-uploader-result-visuals'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ScanItem = RouterOutputs['archiveSearch']['listItems']['items'][number]
type ScanRun = RouterOutputs['archiveSearch']['getSource']['runs'][number]
const MAX_SELECTED_ITEMS = 100

export function ScanResults({
  view,
  runs,
  activeRun,
  items,
  resultView,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onIgnore,
  onAdd,
  onNavigateInboxItem,
  mutationPending,
  selectedItemIds,
  allActionableSelected,
  onToggleAll,
  onToggle,
  isDesktop,
  layoutReady,
  positionKey,
  position,
  onPositionChange
}: {
  view: ArchiveDiscoveryCatalogView
  runs: ScanRun[]
  activeRun?: ScanRun
  items: ScanItem[]
  resultView: ArchiveUploaderResultView
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRetry: () => void
  onIgnore: (itemId: string) => void
  onAdd: (itemId: string) => void
  onNavigateInboxItem: (itemId: string) => void
  mutationPending: boolean
  selectedItemIds: Set<string>
  allActionableSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggle: (itemId: string, checked: boolean) => void
  isDesktop: boolean
  layoutReady: boolean
  positionKey: string
  position?: ArchiveDiscoveryListPosition
  onPositionChange: (position: ArchiveDiscoveryListPosition) => void
}) {
  const neverScanned = runs.length === 0
  return (
    <ArchiveDiscoveryResultList
      items={items}
      view={resultView}
      isDesktop={isDesktop}
      layoutReady={layoutReady}
      isLoading={isLoading}
      isError={isError}
      errorTitle="扫描结果加载失败"
      errorDescription="扫描记录仍保存在数据库中，请稍后重试。"
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
            <EmptyTitle>
              {activeRun ? '正在扫描' : neverScanned ? '尚无扫描记录' : `没有${resultFeedLabel(view)}项目`}
            </EmptyTitle>
            <EmptyDescription>
              {activeRun
                ? '任务完成后，画廊会自动汇入长期目录。'
                : neverScanned
                  ? '点击“扫描最新”创建第一批发现结果。'
                  : emptyCatalogViewDescription(view)}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
      header={
        <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground">
          <Checkbox
            checked={allActionableSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label="选择当前已加载的结果，最多一百条"
          />
          <span>画廊</span>
          <span className="text-right">操作</span>
        </div>
      }
      renderItem={(item) => (
        <div
          className={cn(
            'bg-background',
            resultView === 'cards' ? 'h-full rounded-lg border p-3' : 'border-b px-4 py-3'
          )}
        >
          <div
            className={cn(
              'grid min-h-20 items-start gap-3',
              resultView === 'list' ? 'grid-cols-[1.5rem_minmax(0,1fr)_auto]' : 'grid-cols-[1.5rem_minmax(0,1fr)]'
            )}
            data-state={selectedItemIds.has(item.id) ? 'selected' : undefined}
          >
            <Checkbox
              checked={selectedItemIds.has(item.id)}
              disabled={!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS}
              onCheckedChange={(checked) => onToggle(item.id, checked === true)}
              aria-label={`选择 ${item.title}`}
            />
            <div
              className={cn(
                'flex min-w-0 gap-3',
                resultView === 'cards' ? 'order-3 col-span-2 flex-col' : 'items-start'
              )}
            >
              {resultView !== 'list' ? (
                <ArchiveUploaderGalleryThumbnail
                  key={item.id}
                  item={item}
                  card={resultView === 'cards'}
                  previewCatalogId={resultView === 'cards' ? item.id : undefined}
                  sourceHref={
                    resultView === 'cards' ? undefined : `/api/archive/catalog/${encodeURIComponent(item.id)}/source`
                  }
                />
              ) : null}
              <div className="min-w-0 w-full flex-1">
                <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:gap-2">
                  <PrivacySensitiveText as="p" className="line-clamp-2 w-full min-w-0 break-words font-medium">
                    {item.title}
                  </PrivacySensitiveText>
                  <CatalogStatusBadge item={item} />
                </div>
                <DiscoveryCreatorStatus
                  effectiveCreators={item.effectiveCreators}
                  pendingCreators={item.pendingCreators}
                />
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  #{item.externalId} · <PrivacySensitiveText>{item.displayUrl}</PrivacySensitiveText>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.fileCount ? `${item.fileCount} 页 · ` : ''}
                  {item.postedAt ? formatArchiveUploaderTimestamp(item.postedAt) : '发布时间未知'}
                </p>
                {item.changeReasons.length > 0 ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.changeReasons.map(({ label }) => label).join(' · ')}
                  </p>
                ) : item.workflowStage === 'ARCHIVED' && !item.comparisonKnown ? (
                  <p className="mt-1 text-xs text-muted-foreground">旧记录缺少比较快照，下次扫描会补齐</p>
                ) : null}
                {item.errorMessage ? (
                  <PrivacySensitiveText as="p" className="mt-1 line-clamp-2 text-xs text-destructive">
                    {item.errorMessage}
                  </PrivacySensitiveText>
                ) : null}
              </div>
            </div>
            <div
              className={cn(
                'flex flex-wrap items-center justify-end',
                resultView === 'cards'
                  ? 'col-start-2 row-start-1'
                  : resultView === 'preview'
                    ? 'col-start-2'
                    : undefined
              )}
            >
              {resultView === 'cards' ? (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`/api/archive/catalog/${encodeURIComponent(item.id)}/source`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`在新标签页打开原站 ${item.title}`}
                  >
                    <ArrowUpRightIcon aria-hidden="true" />
                    打开原站
                  </a>
                </Button>
              ) : null}
              <SourcePreviewButton
                source={{ kind: 'catalog', itemId: item.id }}
                variant="ghost"
                size="icon"
                aria-label={`站内缩略图预览 ${item.title}`}
                title="站内缩略图预览"
              >
                <span className="sr-only">站内缩略图预览</span>
              </SourcePreviewButton>
              {item.actionable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onIgnore(item.id)}
                  disabled={mutationPending}
                  aria-label={`忽略 ${item.title}`}
                >
                  <BanIcon aria-hidden="true" />
                </Button>
              ) : item.workflowBucket === 'ATTENTION' && item.intakeItemId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onNavigateInboxItem(item.intakeItemId!)}
                  aria-label={`去收件箱处理 ${item.title}`}
                >
                  <ArrowUpRightIcon aria-hidden="true" />
                </Button>
              ) : item.recoverable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onAdd(item.id)}
                  disabled={mutationPending}
                  aria-label={`重新加入收件箱 ${item.title}`}
                >
                  <RotateCcwIcon aria-hidden="true" />
                </Button>
              ) : item.workflowStage === 'ARCHIVED' && item.artworkId ? (
                <Button variant="ghost" size="icon" asChild aria-label={`查看已归档作品 ${item.title}`}>
                  <a href={`/artworks/${item.artworkId}`} target="_blank" rel="noreferrer">
                    <ArrowUpRightIcon aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    />
  )
}

function emptyCatalogViewDescription(view: ArchiveDiscoveryCatalogView) {
  return {
    ACTIONABLE: '当前没有需要决定是否归档的画廊。',
    PROCESSING: '当前没有正在解析或下载的画廊。',
    ARCHIVED: '这个来源还没有完成归档的画廊。',
    ATTENTION: '当前没有需要处理的异常。',
    ALL: '已完成的扫描暂未发现公开画廊。'
  }[view]
}
