'use client'

import Link from 'next/link'
import { VideoPreview } from './VideoPreview'
import { isVideoFile } from '@/types/media'

export interface ArtworkCardProps {
  artwork: {
    id: number
    title: string
    artist?: {
      name: string
    } | null
    images?: {
      id: number
      path: string
    }[]
    imageCount?: number
  }
  showArtist?: boolean
  layout?: 'vertical' | 'horizontal'
  className?: string
}

export function ArtworkCard({ artwork, showArtist = true, layout = 'vertical', className = '' }: ArtworkCardProps) {
  const { id, title, artist, images = [], imageCount = 0 } = artwork
  const coverImage = images[0]
  const src = coverImage ? `/api/v1/images/${encodeURIComponent(coverImage.path)}` : ''
  const artistName = artist?.name
  const isVideoCover = coverImage && isVideoFile(coverImage.path)

  if (layout === 'horizontal') {
    return (
      <Link href={`/artworks/${id}`} className={`block animate-fade-in ${className}`}>
        <div className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow flex">
          {/* Media Preview */}
          <div className="relative w-32 h-24 flex-shrink-0 overflow-hidden bg-neutral-100">
            {src ? (
              isVideoCover ? (
                <VideoPreview src={src} title={title} className="h-full w-full object-cover" />
              ) : (
                <img src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
              )
            ) : (
              <div className="h-full w-full bg-neutral-200 flex items-center justify-center">
                <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            )}

            {/* Image Count Badge */}
            {imageCount > 0 && (
              <div className="absolute top-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span>{imageCount}</span>
              </div>
            )}
          </div>

          {/* Artwork Info */}
          <div className="p-4 flex-1 min-w-0">
            <h3 className="font-medium text-neutral-900 truncate mb-1">{title}</h3>
            {showArtist && artistName && <p className="text-sm text-neutral-600 truncate">{artistName}</p>}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/artworks/${id}`} className={`block animate-fade-in ${className}`}>
      <div className="bg-white rounded-2xl shadow-sm p-0 overflow-hidden hover:shadow-md transition-shadow">
        {/* Media Preview */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-100">
          {src ? (
            isVideoCover ? (
              <VideoPreview src={src} title={title} className="h-full w-full object-cover" />
            ) : (
              <img src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
            )
          ) : (
            <div className="h-full w-full bg-neutral-200 flex items-center justify-center">
              <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}

          {/* Image Count Badge */}
          {imageCount > 0 && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>{imageCount}</span>
            </div>
          )}
        </div>

        {/* Artwork Info */}
        <div className="p-4">
          <h3 className="font-medium text-neutral-900 truncate mb-1">{title}</h3>
          {showArtist && artistName && <p className="text-sm text-neutral-600 truncate">{artistName}</p>}
        </div>
      </div>
    </Link>
  )
}

export default ArtworkCard
