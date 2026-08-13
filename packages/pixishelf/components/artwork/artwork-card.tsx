'use client'

import Link from 'next/link'
import { ImageIcon, VideoIcon } from 'lucide-react'
import { formatFileSize } from '@/utils/media'
import type { ArtworkCardData } from '@/types'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from './preferred-tag'
import MediaThumbnail from '@/components/media/media-thumbnail'

interface ArtworkCardProps {
  artwork: ArtworkCardData
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

  const cover = images[0]
  const { mediaType } = cover ?? {}
  const { name } = artist ?? {}
  const preferredTag = useMemo(() => getPreferredTagName(preferredTags, tags), [preferredTags, tags])

  return (
    <article data-slot="artwork-card" className={cn('group min-w-0', className)}>
      <Link
        href={`/artworks/${id}`}
        aria-label={`查看作品：${title}`}
        className={cn(
          'relative block aspect-[3/4] w-full overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2',
          displayMode === 'minimal' ? 'rounded-none' : 'rounded-md'
        )}
      >
        <MediaThumbnail
          media={cover}
          alt={title}
          width={400}
          height={533}
          className="h-full w-full object-cover transition-transform duration-(--motion-base) ease-(--ease-standard) group-hover:scale-[1.02]"
          loading={priority ? 'eager' : 'lazy'}
          priority={priority}
        />

        <div className="absolute inset-0 bg-foreground/0 transition-colors duration-(--motion-fast) group-hover:bg-foreground/5" />

        {preferredTag && (
          <div className="absolute top-2 left-2 max-w-[72%] rounded-sm bg-destructive px-2 py-0.5 text-[10px] leading-tight font-semibold text-destructive-foreground">
            <span className="block truncate">{preferredTag}</span>
          </div>
        )}

        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {/* 图片数量标识 */}
          {mediaType === 'image' && imageCount > 1 && (
            <div className="flex items-center gap-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[10px] font-medium text-background backdrop-blur-sm">
              <ImageIcon className="size-2.5" aria-hidden="true" />
              {imageCount}
            </div>
          )}
          {/* 视频icon */}
          {mediaType === 'video' && totalMediaSize > 0 && (
            <div className="flex items-center gap-1 rounded bg-foreground/70 px-1.5 py-0.5 text-[10px] font-medium text-background backdrop-blur-sm">
              <VideoIcon className="size-2.5" aria-hidden="true" />
              {formatFileSize(totalMediaSize)}
            </div>
          )}
        </div>
      </Link>

      {/* 作品信息 */}
      {displayMode !== 'minimal' && (
        <div className="mt-2 flex min-w-0 flex-col gap-0.5 px-0.5">
          <h3 className="truncate text-sm leading-5 font-semibold text-foreground" title={title}>
            {title || '未命名作品'}
          </h3>
          {name && (
            <p className="truncate text-xs leading-5 text-muted-foreground" title={name}>
              {name}
            </p>
          )}
        </div>
      )}
    </article>
  )
}
