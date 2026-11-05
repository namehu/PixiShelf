'use client'

import { ArchiveQualityBadge } from '@/components/artwork/archive-quality-badge'

import type { inferRouterOutputs } from '@trpc/server'
import { ExternalLinkIcon, BookOpenIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { DISCOVERY_LANGUAGES } from '@/lib/archive-discovery-filters'
import { cn } from '@/lib/utils'
import { formatArchiveSourceSize } from '@/lib/archive-source-size'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { CatalogStatusBadge, DiscoveryCreatorStatus } from './discovery-creator-status'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
import { type ArchiveDiscoveryCatalogView, resultFeedLabel } from './archive-discovery-results-toolbar'
import { ArchiveUploaderGalleryThumbnail } from './archive-uploader-result-visuals'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'
import { ArchiveTitleMatchEvidence } from './archive-title-match-evidence'
import { ArchiveDiscoverySelectionSurface } from './archive-discovery-selection-surface'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ScanItem = RouterOutputs['archiveSearch']['listItems']['items'][number]
type ScanRun = RouterOutputs['archiveSearch']['getSource']['runs'][number]
const MAX_SELECTED_ITEMS = 100

export function ScanResults({
  titleReview,
  filtered = false,
  onClearFilters,
  onScan,
  canScan = false,
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
  titleReview?: { sourceId: string; rulesVersion: number } | undefined
  filtered?: boolean
  onClearFilters?: () => void
  onScan?: () => void
  canScan?: boolean
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
              {activeRun
                ? '正在扫描'
                : filtered
                  ? '没有匹配的内容'
                  : neverScanned
                    ? '尚无扫描记录'
                    : `没有${resultFeedLabel(view)}项目`}
            </EmptyTitle>
            <EmptyDescription>
              {activeRun
                ? '任务完成后，画廊会自动汇入长期目录。'
                : filtered
                  ? '尝试调整标题或筛选条件。'
                  : neverScanned
                    ? '点击“扫描最新”创建第一批发现结果。'
                    : emptyCatalogViewDescription(view)}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <Button variant="outline" onClick={onClearFilters}>
              清空筛选
            </Button>
          ) : canScan ? (
            <Button variant="outline" onClick={onScan}>
              扫描最新
            </Button>
          ) : null}
        </Empty>
      }
      header={
        <div className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b bg-muted/30 px-3 sm:gap-3 sm:px-4 text-xs font-medium text-muted-foreground">
          <Checkbox
            disabled={mutationPending}
            checked={allActionableSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label="选择当前已加载的结果，最多一百条"
          />
          <span>画廊</span>
          <span className="text-right">链接</span>
        </div>
      }
      renderItem={(item, index) => (
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
              'relative grid items-start gap-x-2 gap-y-2 sm:gap-x-3',
              resultView === 'cards' ? 'grid-cols-[1.5rem_minmax(0,1fr)]' : 'grid-cols-[1.5rem_minmax(0,1fr)_auto]'
            )}
            data-state={selectedItemIds.has(item.id) ? 'selected' : undefined}
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
                'min-w-0',
                resultView === 'cards'
                  ? 'order-3 col-span-2 flex flex-col gap-3'
                  : resultView === 'preview'
                    ? 'col-span-3 row-start-2 grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:flex sm:gap-3'
                    : 'flex items-start gap-3'
              )}
            >
              {resultView !== 'list' ? (
                <ArchiveUploaderGalleryThumbnail key={item.id} item={item} card={resultView === 'cards'} />
              ) : null}
              <div className={cn('min-w-0 w-full flex-1', resultView === 'preview' && 'contents sm:block')}>
                <div className="flex min-w-0 flex-col items-start gap-1.5">
                  <PrivacySensitiveText as="p" className="line-clamp-2 w-full min-w-0 break-words font-medium">
                    {item.title}
                  </PrivacySensitiveText>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <CatalogStatusBadge item={item} />
                  {item.localQuality ? <ArchiveQualityBadge quality={item.localQuality} /> : null}
                  <DiscoveryCreatorStatus
                    effectiveCreators={item.effectiveCreators}
                    pendingCreators={item.pendingCreators}
                  />
                </div>
                {titleReview ? (
                  <ArchiveTitleMatchEvidence
                    variant="summary"
                    evaluation={item.matchEvaluation}
                    evidence={item.matchEvidence}
                    decision={item.reviewDecision}
                  />
                ) : null}
                <p className="col-span-2 mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="whitespace-nowrap tabular-nums">第 {index + 1} 条</span> ·{' '}
                  <span className="tabular-nums">#{item.externalId}</span> ·{' '}
                  <PrivacySensitiveText>
                    {item.category ?? '分类未知'} ·{' '}
                    {item.languages?.length
                      ? item.languages.map((language) => DISCOVERY_LANGUAGES[language] ?? language).join('、')
                      : '语言未知'}
                  </PrivacySensitiveText>{' '}
                  · {item.fileCount ? `${item.fileCount} 页 · ` : ''}
                  {item.sourceSizeBytes ? `原站整部 ${formatArchiveSourceSize(item.sourceSizeBytes)} · ` : '原站整部大小未知 · '}
                  <span className="whitespace-nowrap">
                    {item.postedAt ? formatArchiveUploaderTimestamp(item.postedAt) : '发布时间未知'}
                  </span>
                </p>
                {item.changeReasons.length > 0 ? (
                  <p className="col-span-2 mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.changeReasons.map(({ label }) => label).join(' · ')}
                  </p>
                ) : item.workflowStage === 'ARCHIVED' && !item.comparisonKnown ? (
                  <p className="col-span-2 mt-1 text-xs text-muted-foreground">旧记录缺少比较快照，下次扫描会补齐</p>
                ) : null}
                {item.errorMessage ? (
                  <PrivacySensitiveText as="p" className="col-span-2 mt-1 line-clamp-2 text-xs text-destructive">
                    {item.errorMessage}
                  </PrivacySensitiveText>
                ) : null}
              </div>
            </div>
            <div
              className={cn(
                'flex shrink-0 flex-wrap items-center justify-end gap-1',
                resultView === 'cards' ? 'col-start-2 row-start-1' : 'col-start-3 row-start-1',
                resultView === 'list' && 'max-sm:flex-col'
              )}
            >
              {item.artworkId && item.workflowStage !== 'DELETED' ? (
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" asChild>
                  <a href={`/artworks/${item.artworkId}`} aria-label={`查看本地作品 ${item.title}`}>
                    <BookOpenIcon aria-hidden="true" data-icon="inline-start" />
                    本地作品
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-9">
                <a
                  href={`/api/archive/catalog/${encodeURIComponent(item.id)}/source`}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={`打开原站 ${item.title}`}
                >
                  <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
                  原站
                </a>
              </Button>
            </div>
          </div>
        </ArchiveDiscoverySelectionSurface>
      )}
    />
  )
}

function emptyCatalogViewDescription(view: ArchiveDiscoveryCatalogView) {
  return {
    ACTIONABLE: '当前没有需要决定是否归档的画廊。',
    PROCESSING: '当前没有正在解析或下载的画廊。',
    ARCHIVED: '这个来源还没有完成归档的画廊。',
    DELETED: '这个来源没有已删除的作品。',
    ATTENTION: '当前没有需要处理的异常。',
    ALL: '已完成的扫描暂未发现公开画廊。'
  }[view]
}
