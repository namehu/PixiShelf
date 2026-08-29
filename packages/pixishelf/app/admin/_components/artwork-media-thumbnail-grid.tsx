import type { MediaCoverSource } from '@/lib/media-cover'
import { MediaThumbnail } from '@/components/media/media-thumbnail'
import { formatFileSize } from '@/utils/media'

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
        {visibleMedia.map((item) => {
          const fileName = item.path.replace(/\\/g, '/').split('/').pop() || item.path
          return (
            <div key={item.id} className="min-w-0 overflow-hidden rounded-md border bg-background">
              <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
                <MediaThumbnail
                  media={item}
                  alt={fileName}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 20vw, 10vw"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-col gap-0.5 p-2 text-[10px]">
                <div className="truncate" title={fileName}>
                  {fileName}
                </div>
                <div className="text-muted-foreground">
                  {item.width ?? 0}×{item.height ?? 0} · {formatFileSize(Number(item.size ?? 0))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
