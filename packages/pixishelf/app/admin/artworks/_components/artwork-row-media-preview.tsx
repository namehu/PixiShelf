'use client'

import { useQuery } from '@tanstack/react-query'
import { ImageIcon, Loader2, Video } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { combinationApiResource } from '@/utils/combination-static'
import { formatFileSize } from '@/utils/media'

export function ArtworkRowMediaPreview({ artworkId }: { artworkId: number }) {
  const trpc = useTRPC()
  const artworkQuery = useQuery(trpc.artwork.getById.queryOptions(artworkId))

  if (artworkQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> 加载媒体预览…
      </div>
    )
  }

  const images = artworkQuery.data?.images?.slice(0, 10) ?? []
  if (images.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">该作品没有媒体</div>
  }

  return (
    <div className="p-4">
      <div className="mb-2 text-xs text-muted-foreground">前 {images.length} 张媒体</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
        {images.map((image) => {
          const fileName = image.path.replace(/\\/g, '/').split('/').pop() || image.path
          const extension = fileName.split('.').pop()?.toLowerCase()
          const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(extension || '')
          return (
            <div key={image.id} className="min-w-0 overflow-hidden rounded-md border bg-background">
              <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
                {isVideo ? (
                  <Video aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
                ) : image.path ? (
                  <img
                    src={combinationApiResource(image.path)}
                    alt={fileName}
                    width={240}
                    height={240}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-0.5 p-2 text-[10px]">
                <div className="truncate" title={fileName}>
                  {fileName}
                </div>
                <div className="text-muted-foreground">
                  {image.width ?? 0}×{image.height ?? 0} · {formatFileSize(Number(image.size ?? 0))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
