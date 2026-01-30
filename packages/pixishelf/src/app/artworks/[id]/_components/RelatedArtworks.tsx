'use client'

import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { VideoIcon, Loader2 } from 'lucide-react'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

interface RelatedArtworksProps {
  artistId: number
  currentArtworkId: number
}

export default function RelatedArtworks({ artistId, currentArtworkId }: RelatedArtworksProps) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const [artworks, setArtworks] = useState<ArtworkResponseDto[]>([])
  const [hasFetchedInitial, setHasFetchedInitial] = useState(false)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [hasMoreNewer, setHasMoreNewer] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)

  // Initial load: centered on current artwork
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
      // If initial data length is small, maybe no more data
      if (initialData.length < 5) {
        // arbitrary threshold
        setHasMoreNewer(false)
        setHasMoreOlder(false)
      }
    }
  }, [initialData, hasFetchedInitial])

  // Center the current item on initial load
  useEffect(() => {
    if (hasFetchedInitial && currentRef.current && viewportRef.current) {
      const viewport = viewportRef.current
      const scrollLeft = currentRef.current.offsetLeft - viewport.clientWidth / 2 + currentRef.current.clientWidth / 2
      viewport.scrollTo({ left: scrollLeft, behavior: 'instant' })
    }
  }, [hasFetchedInitial])

  // Fetch more logic
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
          // Prepend items
          const oldScrollWidth = viewportRef.current?.scrollWidth || 0
          const oldScrollLeft = viewportRef.current?.scrollLeft || 0

          setArtworks((prev) => [...result, ...prev])

          // Adjust scroll position to maintain visual continuity
          // We need to wait for DOM update.
          requestAnimationFrame(() => {
            if (viewportRef.current) {
              const newScrollWidth = viewportRef.current.scrollWidth
              const diff = newScrollWidth - oldScrollWidth
              viewportRef.current.scrollLeft = oldScrollLeft + diff
            }
          })
        } else {
          // Append items
          setArtworks((prev) => [...prev, ...result])
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '未知错误')
    } finally {
      setIsFetchingMore(false)
    }
  }

  // Scroll listener for infinite scrolling
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const { scrollLeft, scrollWidth, clientWidth } = target
    const threshold = 200 // pixels from edge

    if (scrollLeft < threshold) {
      fetchMore('newer')
    } else if (scrollLeft + clientWidth > scrollWidth - threshold) {
      fetchMore('older')
    }
  }

  if (isInitialLoading || !hasFetchedInitial) return null
  if (artworks.length === 0) return null

  return (
    <div className="w-full my-8 border-t border-gray-100 py-8">
      <div className="px-6 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">其他作品</h2>
        <Link href={`/artists/${artistId}`} className="text-sm text-blue-600 hover:underline">
          查看全部
        </Link>
      </div>

      <ScrollAreaPrimitive.Root className="w-full whitespace-nowrap relative overflow-hidden" ref={scrollRef}>
        <ScrollAreaPrimitive.Viewport ref={viewportRef} className="w-full h-full rounded-[inherit]" onScroll={onScroll}>
          <div className="flex w-max space-x-4 px-6 pb-4 items-center">
            {hasMoreNewer && (
              <div className="flex items-center justify-center w-10 h-32 shrink-0">
                {isFetchingMore ? (
                  <Loader2 className="animate-spin text-gray-400" size={20} />
                ) : (
                  <div className="w-1 h-1" />
                )}
              </div>
            )}

            {artworks.map((artwork) => {
              const isCurrent = artwork.id === currentArtworkId
              const cover = artwork.images[0]
              if (!cover) return null

              return (
                <Link
                  key={artwork.id}
                  href={`/artworks/${artwork.id}`}
                  ref={isCurrent ? currentRef : null}
                  replace
                  className={cn(
                    'relative block h-32 w-32 shrink-0 overflow-hidden  transition-all',
                    !isCurrent && 'hover:opacity-90'
                  )}
                  title={artwork.title}
                >
                  <Image
                    src={cover.path}
                    alt={artwork.title}
                    fill
                    className={cn('object-cover', isCurrent && 'bg-white opacity-20')}
                    sizes="128px"
                  />
                  {isCurrent && <div className="absolute inset-0 bg-white opacity-20 z-10" />}
                  {(artwork as any).isVideo ? (
                    <div className="absolute top-1 right-1 bg-black/50 text-white p-1 flex items-center justify-center w-6 h-6 rounded-full z-20">
                      <VideoIcon size={14} />
                    </div>
                  ) : artwork.imageCount > 1 ? (
                    <div className="absolute top-1 right-1 bg-black/50 text-white p-1 flex items-center justify-center w-6 h-6 rounded-full z-20 text-[10px]">
                      {artwork.imageCount}
                    </div>
                  ) : null}
                </Link>
              )
            })}

            {hasMoreOlder && (
              <div className="flex items-center justify-center w-10 h-32 shrink-0">
                {isFetchingMore ? (
                  <Loader2 className="animate-spin text-gray-400" size={20} />
                ) : (
                  <div className="w-1 h-1" />
                )}
              </div>
            )}
          </div>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar orientation="horizontal" />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </div>
  )
}
