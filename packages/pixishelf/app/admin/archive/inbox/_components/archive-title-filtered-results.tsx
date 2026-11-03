'use client'

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { BookOpenIcon, CheckIcon, ExternalLinkIcon, RotateCcwIcon, XIcon, FileSearchIcon } from 'lucide-react'
import { decodeArchiveTitle } from '@pixishelf/job-contracts'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { ArchiveDiscoveryResultList } from './archive-discovery-result-list'
import { ArchiveDiscoveryContentFilters } from './archive-discovery-content-filters'
import { DEFAULT_DISCOVERY_FILTERS, discoveryQueryFilters } from './archive-discovery-filter-state'
import {
  ArchiveTitleMatchEvidence,
  ArchiveTitleMatchEvidenceDialog,
  type ArchiveTitleMatchEvidenceSnapshot
} from './archive-title-match-evidence'
import { ArchiveDiscoverySelectionBar } from './archive-discovery-bulk-bar'
import { ArchiveDiscoverySelectionSurface } from './archive-discovery-selection-surface'
import { ArchiveUploaderGalleryThumbnail, ArchiveUploaderResultViewToggle } from './archive-uploader-result-visuals'
import { useTitleReview } from './use-title-review'

export function ArchiveTitleFilteredResults({
  sourceId,
  rulesVersion,
  counts
}: {
  sourceId: string
  rulesVersion: number
  counts: { filtered: number; unreviewed: number; excluded: number } | undefined
}) {
  const trpc = useTRPC()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const resultView = useAdminPreferencesStore((state) => state.archiveUploaderResultView)
  const setResultView = useAdminPreferencesStore((state) => state.setArchiveUploaderResultView)
  const [ready, setReady] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_DISCOVERY_FILTERS)
  const [reviewFilter, setReviewFilter] = useState<'ALL' | 'UNREVIEWED' | 'EXCLUDED'>('UNREVIEWED')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [evidenceItem, setEvidenceItem] = useState<ArchiveTitleMatchEvidenceSnapshot | null>(null)
  const query = useInfiniteQuery(
    trpc.archiveSearch.listItems.infiniteQueryOptions(
      {
        sourceId,
        view: 'ALL',
        matchView: 'FILTERED',
        reviewFilter,
        filters: discoveryQueryFilters(filters),
        unboundOnly: filters.unboundOnly,
        includeCounts: false,
        limit: 50
      },
      { initialCursor: null, getNextPageParam: (page) => page.nextCursor }
    )
  )
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const { pending, review } = useTitleReview(sourceId, rulesVersion, () => setSelected(new Set()))
  const selectedItems = items.filter((item) => selected.has(item.id))
  const acceptableIds = selectedItems
    .filter((item) => item.matchEvaluation?.uploaderMatches !== false)
    .map((item) => item.id)
  useEffect(() => setReady(true), [])
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))))
  }, [items])
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked && next.size < 100) next.add(id)
      else if (!checked) next.delete(id)
      return next
    })
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={reviewFilter}
          aria-label="过滤复核范围"
          className="grid w-full grid-cols-3 justify-start sm:flex sm:w-auto"
          onValueChange={(value) => {
            if (value) {
              setReviewFilter(value as typeof reviewFilter)
              setSelected(new Set())
            }
          }}
        >
          <ToggleGroupItem
            value="UNREVIEWED"
            className="h-auto min-h-11 flex-col gap-0.5 px-2 py-2 sm:flex-row sm:gap-2 sm:px-3"
          >
            <span>未复核</span> <span className="tabular-nums">{counts?.unreviewed ?? '—'}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="EXCLUDED"
            className="h-auto min-h-11 flex-col gap-0.5 px-2 py-2 sm:flex-row sm:gap-2 sm:px-3"
          >
            <span>已确认排除</span> <span className="tabular-nums">{counts?.excluded ?? '—'}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="ALL"
            className="h-auto min-h-11 flex-col gap-0.5 px-2 py-2 sm:flex-row sm:gap-2 sm:px-3"
          >
            <span>全部过滤项</span> <span className="tabular-nums">{counts?.filtered ?? '—'}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <ArchiveUploaderResultViewToggle value={resultView} onChange={setResultView} />
      </div>
      <ArchiveDiscoveryContentFilters
        value={filters}
        onChange={(value) => {
          setFilters(value)
          setSelected(new Set())
        }}
      />
      <p className="text-sm text-muted-foreground">接纳后回到本来源列表，不会自动下载。复核决定只影响当前来源。</p>
      <ArchiveDiscoveryResultList
        items={items}
        view={resultView}
        isDesktop={desktop}
        layoutReady={ready}
        isLoading={query.isPending}
        isError={query.isError}
        errorTitle="过滤项加载失败"
        errorDescription="请重试，复核记录仍保存在数据库中。"
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
        }}
        onRetry={() => void query.refetch()}
        positionKey={`${sourceId}:${reviewFilter}:${JSON.stringify(filters)}`}
        onPositionChange={() => {}}
        emptyState={
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有符合条件的过滤项</EmptyTitle>
              <EmptyDescription>可以切换复核范围或调整筛选。远端未返回的画廊不会出现在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        header={
          <div className="flex min-h-12 items-center gap-3 border-b px-4 text-sm">
            <Checkbox
              aria-label="选择已加载过滤项，最多一百条"
              disabled={pending || items.length === 0}
              checked={
                items.length > 0 && items.slice(0, 100).every((item) => selected.has(item.id))
                  ? true
                  : selected.size > 0
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(checked) =>
                setSelected(checked ? new Set(items.slice(0, 100).map((item) => item.id)) : new Set())
              }
            />
            <span>过滤候选 · 已加载 {items.length} 条</span>
          </div>
        }
        renderItem={(item, index) => {
          const title = decodeArchiveTitle(item.title)
          const sourceHref = `/api/archive/catalog/${encodeURIComponent(item.id)}/source`
          return (
            <ArchiveDiscoverySelectionSurface
              itemId={item.id}
              title={title}
              checked={selected.has(item.id)}
              disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
              onToggle={(checked) => toggle(item.id, checked)}
              className={cn(
                'grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2 p-3 sm:gap-3 sm:p-4',
                resultView === 'cards' ? 'h-full rounded-lg border' : 'border-b'
              )}
            >
              <Checkbox
                className="mt-1"
                aria-label={`复核 ${title}`}
                checked={selected.has(item.id)}
                disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
                onCheckedChange={(checked) => toggle(item.id, checked === true)}
              />
              <div className="col-start-3 row-start-1 flex flex-wrap items-center justify-end gap-1 max-sm:flex-col">
                {item.artworkId && item.workflowStage !== 'DELETED' ? (
                  <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" asChild>
                    <a href={`/artworks/${item.artworkId}`} aria-label={`查看本地作品 ${title}`}>
                      <BookOpenIcon aria-hidden="true" data-icon="inline-start" />
                      本地作品
                    </a>
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" asChild>
                  <a
                    href={sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    aria-label={`打开原站 ${title}`}
                  >
                    <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
                    原站
                  </a>
                </Button>
              </div>
              <div
                className={cn(
                  'col-span-3 min-w-0',
                  resultView === 'cards'
                    ? 'flex flex-col gap-3'
                    : resultView === 'preview'
                      ? 'grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-4'
                      : 'flex flex-col sm:col-span-1 sm:col-start-2 sm:row-start-1'
                )}
              >
                {resultView !== 'list' ? (
                  <div className={resultView === 'preview' ? 'sm:row-span-2' : undefined}>
                    <ArchiveUploaderGalleryThumbnail
                      key={item.id}
                      item={{ ...item, title }}
                      card={resultView === 'cards'}
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <PrivacySensitiveText as="p" className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {title}
                  </PrivacySensitiveText>
                  <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <span className="whitespace-nowrap tabular-nums">第 {index + 1} 条</span> · #{item.externalId} ·{' '}
                    <PrivacySensitiveText>{item.uploaderName ?? '上传者未知'}</PrivacySensitiveText>
                  </p>
                </div>
                <div
                  className={resultView === 'preview' ? 'col-span-2 min-w-0 sm:col-span-1 sm:col-start-2' : 'min-w-0'}
                >
                  <ArchiveTitleMatchEvidence
                    variant="summary"
                    evaluation={item.matchEvaluation}
                    evidence={item.matchEvidence}
                    decision={item.reviewDecision}
                  />
                </div>
              </div>
            </ArchiveDiscoverySelectionSurface>
          )
        }}
      />
      <ArchiveDiscoverySelectionBar
        selectedCount={selected.size}
        pending={pending}
        onClear={() => setSelected(new Set())}
        label="批量复核"
        primaryAction={
          <Button
            aria-label="接纳所选"
            disabled={pending || acceptableIds.length === 0}
            onClick={() => review(acceptableIds, 'INCLUDE')}
          >
            <CheckIcon data-icon="inline-start" />
            接纳所选（{acceptableIds.length}）
          </Button>
        }
        secondaryAction={
          <Button
            aria-label="确认排除"
            variant="outline"
            disabled={pending}
            onClick={() => review([...selected], 'EXCLUDE')}
          >
            <XIcon data-icon="inline-start" />
            确认排除（{selected.size}）
          </Button>
        }
        menuItems={
          <DropdownMenuGroup>
            <DropdownMenuItem
              aria-label="恢复遵循规则"
              disabled={pending}
              onSelect={() => review([...selected], 'AUTO')}
            >
              <RotateCcwIcon />
              恢复遵循规则（{selected.size}）
            </DropdownMenuItem>
            {selectedItems.length === 1 ? (
              <DropdownMenuItem onSelect={() => setEvidenceItem(selectedItems[0]!)}>
                <FileSearchIcon />
                查看匹配证据
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        }
      />
      <ArchiveTitleMatchEvidenceDialog item={evidenceItem} onClose={() => setEvidenceItem(null)} />
    </div>
  )
}
