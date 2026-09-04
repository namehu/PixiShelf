'use client'

import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { VideoIcon, Loader2 } from 'lucide-react'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { toast } from 'sonner'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from '@/components/artwork/preferred-tag'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon } from 'lucide-react'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface RelatedArtworksProps {
  artistId: number
  currentArtworkId: number
}

export default function RelatedArtworks({ artistId, currentArtworkId }: RelatedArtworksProps) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const preferredTags = usePreferredTags()
  const [artworks, setArtworks] = useState<ArtworkResponseDto[]>([])
  const [hasFetchedInitial, setHasFetchedInitial] = useState(false)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [hasMoreNewer, setHasMoreNewer] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)

  // 初始加载：将当前作品定位到中间
  const { data: initialData, isLoading: isInitialLoading } = useQuery(
    trpc.artwork.getNeighbors.queryOptions({
      artistId,
      artworkId: currentArtworkId,
      limit: 20,
      direction: 'both'
    })
  )

  useEffect(() => {
    if (initialData && !hasFetchedInitial) {
      setArtworks(initialData)
      setHasFetchedInitial(true)
      // 初始结果较少时直接判定无更多分页
      if (initialData.length < 5) {
        // 阈值仅用于首屏快速兜底，不作为精确分页条件
        setHasMoreNewer(false)
        setHasMoreOlder(false)
      }
    }
  }, [initialData, hasFetchedInitial])

  // 首次加载完成后居中当前作品
  useEffect(() => {
    if (hasFetchedInitial && currentRef.current && viewportRef.current) {
      const viewport = viewportRef.current
      const scrollLeft = currentRef.current.offsetLeft - viewport.clientWidth / 2 + currentRef.current.clientWidth / 2
      viewport.scrollTo({ left: scrollLeft, behavior: 'instant' })
    }
  }, [hasFetchedInitial])

  // 加载更多逻辑（向左为更新作品，向右为更早作品）
  const fetchMore = async (direction: 'older' | 'newer') => {
    if (isFetchingMore) return
    if (direction === 'older' && !hasMoreOlder) return
    if (direction === 'newer' && !hasMoreNewer) return

    setIsFetchingMore(true)

    const cursorId = direction === 'newer' ? artworks[0]?.id : artworks[artworks.length - 1]?.id
    if (!cursorId) {
      setIsFetchingMore(false)
      return
    }

    try {
      const result = await trpcClient.artwork.getNeighbors.query({
        artistId,
        artworkId: cursorId,
        limit: 20,
        direction
      })

      if (result.length === 0) {
        if (direction === 'newer') setHasMoreNewer(false)
        if (direction === 'older') setHasMoreOlder(false)
      } else {
        if (direction === 'newer') {
          // 向左补数据（保持滚动位置不跳变）
          const oldScrollWidth = viewportRef.current?.scrollWidth || 0
          const oldScrollLeft = viewportRef.current?.scrollLeft || 0

          setArtworks((prev) => [...result, ...prev])

          // 先记录新增前宽度，再在下一帧恢复视觉连续性
          // 需要等待 DOM 更新完成后再重算 scrollLeft
          requestAnimationFrame(() => {
            if (viewportRef.current) {
              const newScrollWidth = viewportRef.current.scrollWidth
              const diff = newScrollWidth - oldScrollWidth
              viewportRef.current.scrollLeft = oldScrollLeft + diff
            }
          })
        } else {
          // 向右追加数据
          setArtworks((prev) => [...prev, ...result])
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    } finally {
      setIsFetchingMore(false)
    }
  }

  // 滚动监听：到边界时触发分页加载
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const { scrollLeft, scrollWidth, clientWidth } = target
    const threshold = 200 // 距离边界 200px 触发

    if (scrollLeft < threshold) {
      fetchMore('newer')
    } else if (scrollLeft + clientWidth > scrollWidth - threshold) {
      fetchMore('older')
    }
  }

  if (isInitialLoading || !hasFetchedInitial) return null
  if (artworks.length === 0) return null

  return (
    <section aria-labelledby="related-artworks-heading" className="my-8 w-full border-t border-border py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="related-artworks-heading" className="text-lg font-semibold text-foreground">
          该艺术家的其他作品
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/artists/${artistId}`}>
            查看全部
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <ScrollAreaPrimitive.Root className="relative w-full overflow-hidden whitespace-nowrap" ref={scrollRef}>
        <ScrollAreaPrimitive.Viewport ref={viewportRef} className="h-full w-full rounded-[inherit]" onScroll={onScroll}>
          <div className="flex w-max items-center gap-3 pb-4">
            {hasMoreNewer && (
              <div className="flex h-32 w-10 shrink-0 items-center justify-center">
                {isFetchingMore ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="正在加载较新作品" />
                ) : (
                  <div className="size-1" />
                )}
              </div>
            )}

            {artworks.map((artwork) => {
              const isCurrent = artwork.id === currentArtworkId
              const cover = artwork.images[0]
              const preferredTag = getPreferredTagName(preferredTags, artwork.tags)
              if (!cover) return null

              return (
                <Link
                  key={artwork.id}
                  href={`/artworks/${artwork.id}`}
                  ref={isCurrent ? currentRef : null}
                  className={cn(
                    'relative block h-32 w-32 shrink-0 overflow-hidden rounded-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/60',
                    !isCurrent && 'hover:opacity-90'
                  )}
                  aria-label={`查看作品：${artwork.title}`}
                >
                  <MediaThumbnail
                    media={cover}
                    alt={artwork.title}
                    fill
                    className={cn('object-cover', isCurrent && 'opacity-35')}
                    sizes="128px"
                  />
                  {isCurrent && <div className="absolute inset-0 z-10 border-2 border-primary bg-background/20" />}
                  {preferredTag && (
                    <div className="absolute top-1 left-1 z-20 max-w-[72%] rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] leading-tight font-semibold text-destructive-foreground">
                      <PrivacySensitiveText className="block truncate">{preferredTag}</PrivacySensitiveText>
                    </div>
                  )}
                  {(artwork as any).isVideo ? (
                    <div className="absolute top-1 right-1 z-20 flex size-6 items-center justify-center rounded-full bg-foreground/70 p-1 text-background">
                      <VideoIcon size={14} />
                    </div>
                  ) : artwork.imageCount > 1 ? (
                    <div className="absolute top-1 right-1 z-20 flex size-6 items-center justify-center rounded-full bg-foreground/70 p-1 text-[10px] text-background">
                      {artwork.imageCount}
                    </div>
                  ) : null}
                </Link>
              )
            })}

            {hasMoreOlder && (
              <div className="flex h-32 w-10 shrink-0 items-center justify-center">
                {isFetchingMore ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="正在加载较早作品" />
                ) : (
                  <div className="size-1" />
                )}
              </div>
            )}
          </div>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar orientation="horizontal" />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </section>
  )
}
