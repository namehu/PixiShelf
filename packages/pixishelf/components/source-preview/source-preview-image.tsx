'use client'

import type { ArchivePreviewThumbnailDto } from '@/services/archive-preview/archive-preview-types'
import { SourcePreviewThumbnail } from './source-preview-thumbnail'
import type { PreviewImageState } from './use-source-preview-images'

export function SourcePreviewImage({
  item,
  image,
  fullscreen = false,
  onError
}: {
  item: ArchivePreviewThumbnailDto
  image?: PreviewImageState
  fullscreen?: boolean
  onError: () => void
}) {
  const loaded = image?.status === 'loaded' && image.url && image.width && image.height
  return (
    <div className={fullscreen ? 'swiper-zoom-target relative flex w-full justify-center' : 'relative w-full'}>
      <SourcePreviewThumbnail
        item={loaded ? { ordinal: item.ordinal, url: image.url!, width: image.width!, height: image.height! } : item}
        alt={`来源图片 ${item.ordinal + 1}`}
        fullscreen={fullscreen}
        eager={Boolean(loaded)}
        onError={loaded ? onError : undefined}
      />
      {!loaded && (
        <span
          className="absolute bottom-3 left-3 rounded bg-background/90 px-2 py-1 text-sm text-foreground"
          role="status"
        >
          {image?.status === 'failed' ? '大图加载失败' : image?.status === 'loading' ? '正在加载大图' : '待加载大图'}
        </span>
      )}
    </div>
  )
}
