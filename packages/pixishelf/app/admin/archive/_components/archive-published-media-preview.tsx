'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { ArtworkMediaThumbnailGrid } from '../../_components/artwork-media-thumbnail-grid'
import { useTRPC } from '@/lib/trpc'

export function ArchivePublishedMediaPreview({ artworkId }: { artworkId: number }) {
  const trpc = useTRPC()
  const artworkQuery = useQuery(trpc.artwork.getById.queryOptions(artworkId))

  if (artworkQuery.isLoading) {
    return (
      <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" /> 加载已发布媒体…
      </div>
    )
  }

  if (artworkQuery.isError || !artworkQuery.data) {
    return <div className="px-4 py-8 text-center text-sm text-destructive">已发布媒体暂时无法加载，请稍后重试。</div>
  }

  return (
    <div className="p-4" data-testid="archive-published-media-preview">
      <ArtworkMediaThumbnailGrid media={artworkQuery.data.images} emptyMessage="该已发布作品没有媒体" />
    </div>
  )
}
