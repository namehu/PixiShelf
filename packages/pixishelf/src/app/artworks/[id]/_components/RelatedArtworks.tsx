'use client'

import { useTRPC } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { VideoIcon } from 'lucide-react'

interface RelatedArtworksProps {
  artistId: number
  currentArtworkId: number
}

export default function RelatedArtworks({ artistId, currentArtworkId }: RelatedArtworksProps) {
  const trpc = useTRPC()
  const { data: artworks, isLoading } = useQuery(
    trpc.artwork.getNeighbors.queryOptions({
      artistId,
      artworkId: currentArtworkId,
      limit: 20
    })
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (artworks && currentRef.current && scrollRef.current) {
      // Find the scroll viewport
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (viewport) {
        // Center the current item
        // offsetLeft is relative to the scroll container content
        const scrollLeft = currentRef.current.offsetLeft - viewport.clientWidth / 2 + currentRef.current.clientWidth / 2
        viewport.scrollTo({ left: scrollLeft, behavior: 'smooth' })
      }
    }
  }, [artworks])

  if (isLoading || !artworks || artworks.length === 0) return null

  return (
    <div className="w-full my-8 border-t border-gray-100 py-8">
      <div className="px-6 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">其他作品</h2>
        <Link href={`/artists/${artistId}`} className="text-sm text-blue-600 hover:underline">
          查看全部
        </Link>
      </div>

      <ScrollAreaPrimitive.Root className="w-full whitespace-nowrap relative overflow-hidden" ref={scrollRef}>
        <ScrollAreaPrimitive.Viewport className="w-full h-full rounded-[inherit]">
          <div className="flex w-max space-x-4 px-6 pb-4">
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
                    'relative block h-32 w-32 shrink-0 overflow-hidden rounded-md transition-all',
                    !isCurrent && 'hover:opacity-90'
                  )}
                  title={artwork.title}
                >
                  <Image src={cover.path} alt={artwork.title} fill className="object-cover" sizes="128px" />
                  {isCurrent && <div className="absolute inset-0 bg-white/50 z-10" />}
                  {artwork.isVideo && (
                    <div className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full z-20">
                      <VideoIcon size={10} />
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar orientation="horizontal" />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    </div>
  )
}
