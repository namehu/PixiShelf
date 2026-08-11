'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Link2,
  Loader2,
  Unlink,
  Video
} from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
        (item) =>
          ['INVALID', 'READY', 'EXCLUDED'].includes(item.status) && item.newMediaSnapshot.length > 0
      ),
    [batch.items]
  )
  const unboundItems = useMemo(() => pairableItems.filter((item) => !item.artworkId), [pairableItems])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())
  const activeItem = pairableItems.find((item) => item.id === activeItemId) ?? null
  const [filterValue, setFilterValue] = useState(buildEmptyArtworkFilter)
  const [submittedFilters, setSubmittedFilters] = useState(() => buildArtworkFilterPayload(filterValue))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (activeItem) return
    const nextItem = unboundItems[0] ?? pairableItems[0]
    setActiveItemId(nextItem?.id ?? null)
    if (nextItem && !nextItem.artworkId) setExpandedItemIds(new Set([nextItem.id]))
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
    batch.items
      .filter((item) => item.id !== activeItem?.id && item.artworkId)
      .map((item) => item.artworkId)
  )
  const bindMutation = useMutation(
    trpc.pendingReplace.bind.mutationOptions({
      onSuccess: async (_result, variables) => {
        toast.success('目录与作品已绑定')
        const nextItem = unboundItems.find((item) => item.id !== variables.itemId)
        setExpandedItemIds((current) => {
          const next = new Set(current)
          next.delete(variables.itemId)
          if (nextItem) next.add(nextItem.id)
          return next
        })
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
        setExpandedItemIds((current) => new Set(current).add(variables.itemId))
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
  const toggleSource = (item: BatchItemView) => {
    setActiveItemId(item.id)
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="h-5 w-5" /> 快速配对
        </CardTitle>
        <CardDescription>
          左右两侧都是可展开列表。绑定后资源目录会自动收起并推进下一项；已绑定项目可随时解除或改绑。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div data-testid="pairing-columns" className="grid min-h-[720px] xl:grid-cols-2">
          <section className="min-w-0 border-b xl:border-b-0 xl:border-r" aria-label="资源目录列表">
            <div className="flex items-center justify-between border-b px-4 py-3 text-sm font-medium">
              <span>资源目录</span>
              <Badge variant={unboundItems.length > 0 ? 'secondary' : 'default'}>
                {unboundItems.length > 0 ? `待配对 ${unboundItems.length}` : '全部已配对'}
              </Badge>
            </div>
            <div className="divide-y xl:max-h-[920px] xl:overflow-y-auto">
              {pairableItems.map((item) => {
                const expanded = expandedItemIds.has(item.id)
                const active = item.id === activeItem?.id
                return (
                  <div key={item.id} className={active ? 'bg-primary/[0.04]' : undefined}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        aria-label={`${expanded ? '收起' : '展开'} ${item.sourceDirectoryName}`}
                        aria-expanded={expanded}
                        aria-pressed={active}
                        onClick={() => toggleSource(item)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-muted/60"
                      >
                        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.sourceDirectoryName}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {item.artworkId
                              ? `已绑定：${item.artworkTitle || item.externalId}`
                              : `${item.newMediaSnapshot.length} 个媒体 · 待配对`}
                          </span>
                        </span>
                        {item.artworkId ? (
                          <Badge className="shrink-0 bg-emerald-600"><Check className="h-3 w-3" />已绑定</Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">待配对</Badge>
                        )}
                      </button>
                      {item.artworkId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`解除 ${item.sourceDirectoryName} 的绑定`}
                          disabled={disabled || bindMutation.isPending || unbindMutation.isPending}
                          onClick={() => unbindMutation.mutate({ itemId: item.id })}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          {unbindMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                          <span className="hidden 2xl:inline">解除</span>
                        </Button>
                      )}
                    </div>
                    {expanded && <SourceFolderPreview item={item} />}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="min-w-0" aria-label="候选作品列表">
            <div className="border-b p-4">
              <ArtworkFilterPanel
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
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {activeItem ? `为「${activeItem.sourceDirectoryName}」选择作品 · 共 ${total} 项` : '请先选择资源目录'}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" aria-label="下一页" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {candidateQuery.isLoading ? (
              <div className="flex h-52 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在加载候选作品
              </div>
            ) : (
              <div className="divide-y xl:max-h-[720px] xl:overflow-y-auto">
                {candidates.map((artwork) => {
                  const boundElsewhere = artworkIdsBoundElsewhere.has(artwork.id)
                  const currentBinding = activeItem?.artworkId === artwork.id
                  return (
                    <div key={artwork.id} className={currentBinding ? 'bg-emerald-50/60 p-3 dark:bg-emerald-950/10' : 'p-3'}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium" title={artwork.title}>{artwork.title}</span>
                            {currentBinding && <Badge className="bg-emerald-600">当前绑定</Badge>}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {artwork.artist?.name || '未知作者'} · {artwork.externalId || '无 externalId'} · {artwork.imageCount} 项
                          </div>
                          <div className="mt-2"><CandidateMediaPreview artwork={artwork} /></div>
                        </div>
                        <Button
                          size="sm"
                          variant={currentBinding ? 'secondary' : 'default'}
                          disabled={disabled || !activeItem || !artwork.externalId || boundElsewhere || currentBinding || bindMutation.isPending || unbindMutation.isPending}
                          onClick={() => activeItem && bindMutation.mutate({ itemId: activeItem.id, artworkId: artwork.id })}
                          className="shrink-0"
                        >
                          {bindMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                          {boundElsewhere ? '已被占用' : currentBinding ? '已绑定' : activeItem?.artworkId ? '改绑' : '绑定并继续'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
                {candidates.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    没有符合筛选条件的作品
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function SourceFolderPreview({ item }: { item: BatchItemView }) {
  return (
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="mb-2 text-xs text-muted-foreground">本地资源前 5 项</div>
      <div className="grid grid-cols-5 gap-1.5">
        {item.newMediaSnapshot.slice(0, 5).map((media) => {
          const isVideo = media.mediaType?.toLowerCase() === 'video'
          return (
            <div key={media.path} className="min-w-0 overflow-hidden rounded border bg-background">
              <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
                {isVideo ? (
                  <Video className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <img src={combinationApiResource(media.path)} alt={media.sourceName} loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="truncate px-1.5 py-1 text-[10px]" title={media.sourceName}>{media.sourceName}</div>
              <div className="truncate px-1.5 pb-1 text-[9px] text-muted-foreground">
                {media.width}×{media.height} · {formatFileSize(media.size)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CandidateMediaPreview({ artwork }: { artwork: CandidateArtwork }) {
  const media = artwork.images.slice(0, 5)
  if (media.length === 0) {
    return <div className="flex h-20 items-center justify-center rounded bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>
  }
  return (
    <div className="grid max-w-xl grid-cols-5 gap-1.5">
      {media.map((item, index) => {
        const isVideo = item.mediaType?.toLowerCase() === 'video'
        const source = item.posterUrl || item.path
        return (
          <div key={`${item.path}-${index}`} className="min-w-0 overflow-hidden rounded border bg-muted">
            <div className="flex aspect-square items-center justify-center overflow-hidden">
              {isVideo && !item.posterUrl ? (
                <Video className="h-6 w-6 text-muted-foreground" />
              ) : (
                <img src={combinationApiResource(source)} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
            </div>
            {item.size != null && <div className="truncate px-1 py-0.5 text-[9px] text-muted-foreground">{formatFileSize(item.size)}</div>}
          </div>
        )
      })}
    </div>
  )
}
