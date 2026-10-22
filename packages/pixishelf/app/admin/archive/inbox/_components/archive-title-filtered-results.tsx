'use client'

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { decodeArchiveTitle } from '@pixishelf/job-contracts'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { ArchiveDiscoveryResultList } from './archive-discovery-result-list'
import { ArchiveDiscoveryContentFilters } from './archive-discovery-content-filters'
import { DEFAULT_DISCOVERY_FILTERS, discoveryQueryFilters } from './archive-discovery-filter-state'
import { ArchiveTitleMatchEvidence } from './archive-title-match-evidence'
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
            <div
              data-discovery-item={item.id}
              className={cn(
                'grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 bg-background p-3 sm:gap-3 sm:p-4',
                resultView === 'cards' ? 'h-full rounded-lg border' : 'border-b',
                selected.has(item.id) && 'bg-accent/50'
              )}
            >
              <Checkbox
                className="mt-1"
                aria-label={`复核 ${title}`}
                checked={selected.has(item.id)}
                disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
                onCheckedChange={(checked) => toggle(item.id, checked === true)}
              />
              <div
                className={cn(
                  'min-w-0',
                  resultView === 'cards'
                    ? 'col-span-2 flex flex-col gap-3'
                    : resultView === 'preview'
                      ? 'grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-x-3'
                      : 'flex flex-col'
                )}
              >
                {resultView !== 'list' ? (
                  <div className={resultView === 'preview' ? 'sm:row-span-3' : undefined}>
                    <ArchiveUploaderGalleryThumbnail
                      key={item.id}
                      item={{ ...item, title }}
                      card={resultView === 'cards'}
                      sourceHref={sourceHref}
                    />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <PrivacySensitiveText as="p" className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                    <a
                      className="hover:underline"
                      href={sourceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      {title}
                    </a>
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
                    evaluation={item.matchEvaluation}
                    evidence={item.matchEvidence}
                    decision={item.reviewDecision}
                  />
                </div>
                <div
                  className={cn(
                    'mt-3 flex flex-wrap gap-2',
                    resultView === 'preview' && 'col-span-2 sm:col-span-1 sm:col-start-2'
                  )}
                >
                  <Button
                    size="sm"
                    className="h-11 sm:h-9"
                    disabled={pending || item.matchEvaluation?.uploaderMatches === false}
                    onClick={() => review([item.id], 'INCLUDE')}
                  >
                    接纳
                  </Button>
                  {item.reviewDecision !== 'EXCLUDE' ? (
                    <Button
                      size="sm"
                      className="h-11 sm:h-9"
                      variant="outline"
                      disabled={pending}
                      onClick={() => review([item.id], 'EXCLUDE')}
                    >
                      确认排除
                    </Button>
                  ) : null}
                  {item.reviewDecision !== 'AUTO' ? (
                    <Button
                      size="sm"
                      className="h-11 sm:h-9"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => review([item.id], 'AUTO')}
                    >
                      恢复遵循规则
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )
        }}
      />
      {selected.size ? (
        <div
          className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] z-20 flex flex-wrap items-center gap-2 rounded-md border bg-background p-3 shadow-lg lg:bottom-4"
          aria-label="批量复核"
        >
          <span className="text-sm">已选 {selected.size} 条</span>
          <Button className="h-11" disabled={pending} onClick={() => review([...selected], 'INCLUDE')}>
            接纳所选
          </Button>
          <Button
            className="h-11"
            variant="outline"
            disabled={pending}
            onClick={() => review([...selected], 'EXCLUDE')}
          >
            确认排除
          </Button>
          <Button className="h-11" variant="ghost" disabled={pending} onClick={() => review([...selected], 'AUTO')}>
            恢复遵循规则
          </Button>
          <Button className="h-11" variant="ghost" disabled={pending} onClick={() => setSelected(new Set())}>
            清空勾选
          </Button>
        </div>
      ) : null}
    </div>
  )
}
