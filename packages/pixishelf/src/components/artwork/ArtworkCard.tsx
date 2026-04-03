'use client'

import Link from 'next/link'
import { ImageIcon, VideoIcon } from 'lucide-react'
import Image from 'next/image'
import { formatFileSize } from '@/utils/media'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
import { usePreferredTags } from '@/components/user-setting'

interface ArtworkCardProps {
  artwork: ArtworkResponseDto
  priority?: boolean
  className?: string
  displayMode?: 'card' | 'minimal'
}

/**
 * 作品卡片组件
 */
export default function ArtworkCard({ artwork, priority = false, className, displayMode = 'card' }: ArtworkCardProps) {
  const preferredTags = usePreferredTags()
  const { id, title, imageCount, totalMediaSize = 0, images = [], artist, tags = [] } = artwork

  const { path: src = '', mediaType } = images[0] ?? {}
  const { name } = artist ?? {}
  const preferredTag = useMemo(() => {
    if (preferredTags.length === 0 || tags.length === 0) return ''
    const artworkTagNames = new Set(tags.map((tag) => tag.name))
    return preferredTags.find((tag) => artworkTagNames.has(tag)) || ''
  }, [preferredTags, tags])

  return (
    <Link href={`/artworks/${id}`} className={cn('group block', className)}>
      {/* 作品封面 */}
      <div
        className={cn(
          'relative aspect-[3/4] w-full overflow-hidden bg-gray-100',
          displayMode === 'minimal' ? 'rounded-none mb-0.5' : 'rounded-lg mb-2'
        )}
      >
        <Image
          src={src}
          alt={title}
          width={400}
          height={533}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading={priority ? 'eager' : 'lazy'}
          priority={priority}
        />

        {/* 遮罩层 - 悬停时微微变暗增加层次感 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />

        {preferredTag && (
          <div className="absolute top-2 left-2 max-w-[72%] rounded-sm bg-[#ff2f4d] px-2 py-0.5 text-[10px] font-semibold leading-tight text-white shadow-sm">
            <span className="truncate block">{preferredTag}</span>
          </div>
        )}

        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {/* 图片数量标识 */}
          {mediaType === 'image' && imageCount > 1 && (
            <div className="bg-black/50 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
              <ImageIcon size={10} />
              {imageCount}
            </div>
          )}
          {/* 视频icon */}
          {mediaType === 'video' && totalMediaSize > 0 && (
            <div className="bg-black/50 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
              <VideoIcon size={10} />
              {formatFileSize(totalMediaSize)}
            </div>
          )}
        </div>
      </div>

      {/* 作品信息 */}
      {displayMode !== 'minimal' && (
        <div className="space-y-0.5 px-0.5">
          <h4 className="font-bold text-sm text-gray-900 truncate leading-snug group-hover:text-blue-600 transition-colors">
            {title}
          </h4>
          {name && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span className="truncate hover:text-gray-700 transition-colors">{name}</span>
            </div>
          )}
        </div>
      )}
      {displayMode === 'minimal' && (
        <div className="sr-only">
          <span>{title}</span>
          {name && <span>{name}</span>}
        </div>
      )}
    </Link>
  )
}
