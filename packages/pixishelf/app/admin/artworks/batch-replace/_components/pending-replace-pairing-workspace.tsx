'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  ImageIcon,
  Link2,
  Loader2,
  SearchX,
  Unlink,
  Video
} from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArtworkFilterPanel,
  buildArtworkFilterPayload,
  buildEmptyArtworkFilter,
  MEDIA_TYPE_OPTIONS
} from '@/components/artwork/artwork-filter'
import { OSource } from '@/enums/e-source'
import { combinationApiResource } from '@/utils/combination-static'
import { formatFileSize } from '@/utils/media'
import type { BatchItemView, BatchView } from './batch-replace-types'

interface CandidateArtwork {
  id: number
  externalId?: string | null
  storageKey?: string | null
  title: string
  imageCount: number
  artist?: { name?: string | null } | null
  images: Array<{
    path: string
    size?: number | null
    mediaType?: string | null
    posterUrl?: string | null
  }>
}

export function PendingReplacePairingWorkspace({
  batch,
  disabled,
  onBound
}: {
  batch: BatchView
  disabled: boolean
  onBound: () => Promise<unknown>
}) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const pairableItems = useMemo(
    () =>
      batch.items.filter(
        (item) => ['INVALID', 'READY', 'EXCLUDED'].includes(item.status) && item.newMediaSnapshot.length > 0
      ),
    [batch.items]
  )
  const unboundItems = useMemo(() => pairableItems.filter((item) => !item.artworkId), [pairableItems])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [queueMode, setQueueMode] = useState<'pending' | 'all'>('pending')
  const activeItem = pairableItems.find((item) => item.id === activeItemId) ?? null
  const visibleItems = queueMode === 'all' || unboundItems.length === 0 ? pairableItems : unboundItems
  const [filterValue, setFilterValue] = useState(buildEmptyArtworkFilter)
  const [submittedFilters, setSubmittedFilters] = useState(() => buildArtworkFilterPayload(filterValue))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (activeItem) return
    const nextItem = unboundItems[0] ?? pairableItems[0]
    setActiveItemId(nextItem?.id ?? null)
  }, [activeItem, pairableItems, unboundItems])

  const candidateQuery = useQuery(
    trpc.artwork.list.queryOptions(
      {
        cursor: page,
        pageSize: 8,
        id: submittedFilters.id,
        search: submittedFilters.title,
        artistName: submittedFilters.artistName,
        startDate: submittedFilters.startDate,
        endDate: submittedFilters.endDate,
        externalId: submittedFilters.externalId,
        exactMatch: Boolean(submittedFilters.exactMatch),
        tags: submittedFilters.tags,
        excludeTags: submittedFilters.excludeTags,
        mediaTypes: submittedFilters.mediaTypes,
        sources: submittedFilters.sources,
        hasAudio: submittedFilters.hasAudio ?? undefined,
        mediaCountMin: submittedFilters.mediaCountMin,
        mediaCountMax: submittedFilters.mediaCountMax
      },
      { enabled: Boolean(activeItem) }
    )
  )
  const candidates = (candidateQuery.data?.items ?? []) as unknown as CandidateArtwork[]
  const total = candidateQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 8))
  const artworkIdsBoundElsewhere = new Set(
    batch.items.filter((item) => item.id !== activeItem?.id && item.artworkId).map((item) => item.artworkId)
  )
  const bindMutation = useMutation(
    trpc.pendingReplace.bind.mutationOptions({
      onSuccess: async (_result, variables) => {
        toast.success('目录与作品已绑定')
        const nextItem = unboundItems.find((item) => item.id !== variables.itemId)
        setActiveItemId(nextItem?.id ?? variables.itemId)
        await onBound()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const unbindMutation = useMutation(
    trpc.pendingReplace.unbind.mutationOptions({
      onSuccess: async (_result, variables) => {
        toast.success('已解除目录配对')
        setActiveItemId(variables.itemId)
        setQueueMode('pending')
        await onBound()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  if (pairableItems.length === 0) return null

  const submitFilters = () => {
    setPage(1)
    setSubmittedFilters(buildArtworkFilterPayload(filterValue))
  }
  const resetFilters = () => {
    const empty = buildEmptyArtworkFilter()
    setFilterValue(empty)
    setSubmittedFilters(buildArtworkFilterPayload(empty))
    setPage(1)
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="pairing-workspace-title">
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="pairing-workspace-title" className="flex items-center gap-2 text-sm font-semibold">
            <Link2 aria-hidden="true" className="size-4 text-primary" />
            目录配对
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {unboundItems.length > 0 ? `剩余 ${unboundItems.length} 个目录待配对` : '所有目录均已配对'}
          </p>
        </div>
        <div className="grid grid-cols-2 rounded-md bg-muted p-0.5" aria-label="目录队列筛选">
          <button
            type="button"
            aria-pressed={queueMode === 'pending'}
            onClick={() => setQueueMode('pending')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              queueMode === 'pending' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
            )}
          >
            待配对 ({unboundItems.length})
          </button>
          <button
            type="button"
            aria-pressed={queueMode === 'all'}
            onClick={() => setQueueMode('all')}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              queueMode === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
            )}
          >
            全部 ({pairableItems.length})
          </button>
        </div>
      </header>

      <div data-testid="pairing-layout" className="grid min-h-[680px] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-w-0 border-b bg-muted/10 xl:border-r xl:border-b-0" aria-label="资源目录队列">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">资源目录</div>
          <div className="max-h-72 divide-y overflow-y-auto overscroll-contain xl:max-h-[760px]">
            {visibleItems.map((item) => {
              const active = item.id === activeItem?.id
              return (
                <div key={item.id} className={cn('group flex items-center gap-1 p-1.5', active && 'bg-primary/[0.07]')}>
                  <button
                    type="button"
                    aria-label={`选择资源目录 ${item.sourceDirectoryName}`}
                    aria-pressed={active}
                    onClick={() => setActiveItemId(item.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
                      active && 'bg-background shadow-xs'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-md',
                        item.artworkId
                          ? 'bg-success/10 text-success'
                          : 'bg-warning/10 text-warning-foreground'
                      )}
                    >
                      {item.artworkId ? (
                        <Check aria-hidden="true" className="size-4" />
                      ) : (
                        <FolderOpen aria-hidden="true" className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={item.sourceDirectoryName}>
                        {item.sourceDirectoryName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.artworkId
                          ? item.artworkTitle || item.externalId
                          : `${item.newMediaSnapshot.length} 个媒体`}
                      </span>
                    </span>
                  </button>
                  {item.artworkId && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`解除 ${item.sourceDirectoryName} 的绑定`}
                      disabled={disabled || bindMutation.isPending || unbindMutation.isPending}
                      onClick={() => unbindMutation.mutate({ itemId: item.id })}
                      className="size-8 shrink-0 text-muted-foreground opacity-100 hover:text-destructive xl:opacity-0 xl:group-hover:opacity-100 xl:focus-visible:opacity-100"
                    >
                      {unbindMutation.isPending && unbindMutation.variables?.itemId === item.id ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Unlink aria-hidden="true" />
                      )}
                    </Button>
                  )}
                </div>
              )
            })}
            {visibleItems.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">没有待配对目录</div>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {activeItem ? (
            <ActiveSourceSummary item={activeItem} />
          ) : (
            <div className="border-b px-4 py-8 text-center text-sm text-muted-foreground">请选择资源目录</div>
          )}

          <div className="border-b p-4">
            <ArtworkFilterPanel
              embedded
              localSearch={filterValue}
              setLocalSearch={setFilterValue}
              advancedSearchOpen={advancedOpen}
              onAdvancedSearchOpenChange={setAdvancedOpen}
              mediaTypeOptions={MEDIA_TYPE_OPTIONS}
              sourceOptions={OSource}
              onSearchTags={async (query) => {
                const result = await trpcClient.tag.list.query({ query, pageSize: 20 })
                return (result.items as Array<{ name: string; name_zh?: string | null }>).map((tag) => ({
                  label: tag.name_zh ? `${tag.name} (${tag.name_zh})` : tag.name,
                  value: tag.name
                }))
              }}
              onSearch={submitFilters}
              onReset={resetFilters}
            />
          </div>

          <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {activeItem ? `为「${activeItem.sourceDirectoryName}」选择作品 · ${total} 个结果` : '请先选择资源目录'}
            </p>
            <nav className="flex shrink-0 items-center gap-2" aria-label="候选作品分页">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="下一页"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </div>

          {candidateQuery.isLoading ? (
            <div className="flex h-52 items-center justify-center text-sm text-muted-foreground" role="status">
              <Loader2 aria-hidden="true" className="mr-2 size-5 animate-spin" />
              正在加载候选作品…
            </div>
          ) : candidateQuery.isError ? (
            <div className="flex h-52 flex-col items-center justify-center px-6 text-center" role="alert">
              <SearchX aria-hidden="true" className="mb-2 size-8 text-destructive" />
              <p className="text-sm font-medium">无法加载候选作品</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {candidateQuery.error.message}。请检查筛选条件后重试。
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => candidateQuery.refetch()}>
                重新加载
              </Button>
            </div>
          ) : (
            <div className="divide-y xl:max-h-[560px] xl:overflow-y-auto xl:overscroll-contain">
              {candidates.map((artwork) => {
                const storageIdentity = artwork.storageKey ?? artwork.externalId
                const boundElsewhere = artworkIdsBoundElsewhere.has(artwork.id)
                const currentBinding = activeItem?.artworkId === artwork.id
                const bindingThisArtwork = bindMutation.isPending && bindMutation.variables?.artworkId === artwork.id
                return (
                  <article
                    key={artwork.id}
                    className={cn(
                      'p-3 transition-colors hover:bg-muted/30',
                      currentBinding && 'bg-success/5'
                    )}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="max-w-full truncate text-sm font-medium" title={artwork.title}>
                            {artwork.title}
                          </h3>
                          {currentBinding && <Badge variant="success">当前绑定</Badge>}
                          {boundElsewhere && <Badge variant="outline">已被其他目录占用</Badge>}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {artwork.artist?.name || '未知作者'} · {storageIdentity || '无存储标识'} ·{' '}
                          {artwork.imageCount} 项
                        </p>
                        <div className="mt-2">
                          <CandidateMediaPreview artwork={artwork} />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={currentBinding ? 'secondary' : 'default'}
                        disabled={
                          disabled ||
                          !activeItem ||
                          !storageIdentity ||
                          boundElsewhere ||
                          currentBinding ||
                          bindMutation.isPending ||
                          unbindMutation.isPending
                        }
                        onClick={() =>
                          activeItem && bindMutation.mutate({ itemId: activeItem.id, artworkId: artwork.id })
                        }
                        className="w-full shrink-0 sm:w-auto"
                      >
                        {bindingThisArtwork ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : currentBinding ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Link2 aria-hidden="true" />
                        )}
                        {bindingThisArtwork
                          ? '正在绑定…'
                          : boundElsewhere
                            ? '已被占用'
                            : currentBinding
                              ? '已绑定'
                              : activeItem?.artworkId
                                ? '改绑到此作品'
                                : '绑定并继续'}
                      </Button>
                    </div>
                  </article>
                )
              })}
              {candidates.length === 0 && (
                <div className="flex min-h-52 flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
                  <SearchX aria-hidden="true" className="mb-2 size-8 opacity-60" />
                  没有符合筛选条件的作品
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function ActiveSourceSummary({ item }: { item: BatchItemView }) {
  return (
    <section className="border-b bg-primary/[0.035] px-4 py-3" aria-labelledby="active-source-title">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">当前资源目录</span>
        {item.artworkId ? (
          <Badge variant="success">
            <Check aria-hidden="true" />
            已绑定
          </Badge>
        ) : (
          <Badge variant="secondary">待配对</Badge>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] lg:items-start">
        <div className="min-w-0">
          <h3 id="active-source-title" className="truncate text-sm font-semibold" title={item.sourceDirectoryName}>
            {item.sourceDirectoryName}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={item.sourceDirectory}>
            {item.sourceDirectory}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {item.newMediaSnapshot.length} 个媒体
            {item.artworkId && ` · 当前绑定 ${item.artworkTitle || item.externalId}`}
          </p>
        </div>
        <SourceMediaPreview item={item} />
      </div>
    </section>
  )
}

function SourceMediaPreview({ item }: { item: BatchItemView }) {
  const media = item.newMediaSnapshot.slice(0, 5)
  return (
    <div className="grid grid-cols-5 gap-1.5" aria-label={`${item.sourceDirectoryName} 的媒体预览`}>
      {media.map((entry) => {
        const isVideo = entry.mediaType?.toLowerCase() === 'video'
        return (
          <div key={entry.path} className="min-w-0 overflow-hidden rounded-md border bg-background">
            <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
              {isVideo ? (
                <Video aria-hidden="true" className="size-6 text-muted-foreground" />
              ) : (
                <img
                  src={combinationApiResource(entry.path)}
                  alt={entry.sourceName}
                  width={160}
                  height={160}
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </div>
            <div className="truncate px-1.5 py-1 text-[10px]" title={entry.sourceName}>
              {entry.sourceName}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CandidateMediaPreview({ artwork }: { artwork: CandidateArtwork }) {
  const media = artwork.images.slice(0, 5)
  if (media.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-md bg-muted">
        <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" />
      </div>
    )
  }
  return (
    <div className="grid max-w-2xl grid-cols-5 gap-1.5" aria-label={`${artwork.title} 的媒体预览`}>
      {media.map((item, index) => {
        const isVideo = item.mediaType?.toLowerCase() === 'video'
        const source = item.posterUrl || item.path
        return (
          <div key={`${item.path}-${index}`} className="min-w-0 overflow-hidden rounded-md border bg-muted">
            <div className="flex aspect-square items-center justify-center overflow-hidden">
              {isVideo && !item.posterUrl ? (
                <Video aria-hidden="true" className="size-6 text-muted-foreground" />
              ) : (
                <img
                  src={combinationApiResource(source)}
                  alt=""
                  width={180}
                  height={180}
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </div>
            {item.size != null && (
              <div className="truncate px-1 py-0.5 text-[9px] text-muted-foreground">{formatFileSize(item.size)}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
