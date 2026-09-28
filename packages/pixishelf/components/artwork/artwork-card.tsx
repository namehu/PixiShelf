'use client'

import Link from 'next/link'
import { Bookmark, ImageIcon, VideoIcon } from 'lucide-react'
import { formatFileSize } from '@/utils/media'
import type { ArtworkCardData } from '@/types'
import { cn } from '@/lib/utils'
import { useMemo } from 'react'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from './preferred-tag'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { ReadingSummaryDto } from '@pixishelf/db/reading-contract'

interface ArtworkCardProps {
  artwork: ArtworkCardData
  priority?: boolean
  className?: string
  displayMode?: 'card' | 'minimal'
  reading?: ReadingSummaryDto
  showReadingStatus?: boolean
}

/**
 * 作品卡片组件
 */
export default function ArtworkCard({ artwork, priority = false, className, displayMode = 'card', reading, showReadingStatus = false }: ArtworkCardProps) {
  const preferredTags = usePreferredTags()
  const { id, title, imageCount, totalMediaSize = 0, images = [], artist, tags = [] } = artwork

  const cover = images[0]
  const { mediaType } = cover ?? {}
  const { name } = artist ?? {}
  const preferredTag = useMemo(() => getPreferredTagName(preferredTags, tags), [preferredTags, tags])
  const readingLabel = reading?.status === 'COMPLETED'
    ? `已看完 ${reading.seenCount}/${reading.totalCount}`
    : reading?.status === 'IN_PROGRESS'
      ? `阅读中 ${reading.seenCount}/${reading.totalCount}`
      : '未看'
  const readingProgress = reading && reading.totalCount > 0
    ? Math.min(1, Math.max(0, reading.seenCount / reading.totalCount))
    : 0
  const showReadingMarker = showReadingStatus && reading?.status !== 'COMPLETED'

  return (
    <article data-slot="artwork-card" className={cn('group min-w-0', className)}>
      <Link
        href={`/artworks/${id}`}
        aria-label={`查看作品：${title}`}
        aria-description={showReadingStatus ? readingLabel : undefined}
        title={showReadingStatus ? readingLabel : undefined}
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
          <div className={cn('absolute left-2 max-w-[72%] rounded-sm bg-destructive px-2 py-0.5 text-[10px] leading-tight font-semibold text-destructive-foreground', showReadingMarker ? 'top-8' : 'top-2')}>
            <PrivacySensitiveText className="block truncate">{preferredTag}</PrivacySensitiveText>
          </div>
        )}
        {showReadingMarker ? (
          <span
            data-slot="reading-marker"
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 flex size-6 items-center justify-center rounded-br-lg bg-neutral-700/85 text-neutral-300 shadow-sm backdrop-blur-md"
          >
            {reading?.status === 'IN_PROGRESS' ? (
              <svg className="size-3.5 -rotate-90" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="1" strokeDasharray={`${readingProgress} 1`} />
              </svg>
            ) : (
              <Bookmark className="size-3" strokeWidth={1.75} />
            )}
          </span>
        ) : null}

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
          <PrivacySensitiveText as="h3" className="truncate text-sm leading-5 font-semibold text-foreground">
            {title || '未命名作品'}
          </PrivacySensitiveText>
          {name && (
            <PrivacySensitiveText as="p" className="truncate text-xs leading-5 text-muted-foreground">
              {name}
            </PrivacySensitiveText>
          )}
        </div>
      )}
    </article>
  )
}
