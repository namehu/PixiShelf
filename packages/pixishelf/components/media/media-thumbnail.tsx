import Image, { type ImageProps } from 'next/image'
import { VideoIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  isVideoCoverSource,
  resolveMediaCoverUrl,
  type MediaCoverSource
} from '@/lib/media-cover'

interface MediaThumbnailProps extends Omit<ImageProps, 'src'> {
  media?: MediaCoverSource | null
  placeholderClassName?: string
  placeholderLabel?: string
}

export function MediaThumbnail({
  media,
  placeholderClassName,
  placeholderLabel,
  className,
  ...imageProps
}: MediaThumbnailProps) {
  const src = resolveMediaCoverUrl(media)

  if (src) {
    return <Image src={src} className={className} {...imageProps} />
  }

  const isVideo = isVideoCoverSource(media)
  return (
    <div
      data-testid="media-thumbnail-placeholder"
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-100 px-3 text-center text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500',
        className,
        placeholderClassName
      )}
      role="img"
      aria-label={imageProps.alt}
    >
      {isVideo && <VideoIcon className="size-6" aria-hidden="true" />}
      <span className="text-xs">{placeholderLabel || (isVideo ? '封面待生成' : '暂无封面')}</span>
    </div>
  )
}

export default MediaThumbnail
