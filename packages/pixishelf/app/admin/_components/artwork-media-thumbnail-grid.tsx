import type { MediaCoverSource } from '@/lib/media-cover'
import { MediaThumbnail } from '@/components/media/media-thumbnail'

export interface ArtworkMediaThumbnailItem extends MediaCoverSource {
  id: number | string
  path: string
  width?: number | null
  height?: number | null
  size?: number | null
}

interface ArtworkMediaThumbnailGridProps {
  media: readonly ArtworkMediaThumbnailItem[]
  limit?: number
  emptyMessage?: string
}

export function ArtworkMediaThumbnailGrid({
  media,
  limit = 10,
  emptyMessage = '该作品没有媒体'
}: ArtworkMediaThumbnailGridProps) {
  const visibleMedia = media.slice(0, limit)

  if (visibleMedia.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <>
      <div className="mb-2 text-xs text-muted-foreground">前 {visibleMedia.length} 张媒体</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
        {visibleMedia.map((item) => {
          const fileName = item.path.replace(/\\/g, '/').split('/').pop() || item.path
          return (
            <div
              key={item.id}
              className="relative flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-md bg-muted/40"
            >
              <MediaThumbnail
                media={item}
                alt={fileName}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 20vw, 17vw"
                className="object-contain"
              />
            </div>
          )
        })}
      </div>
    </>
  )
}
