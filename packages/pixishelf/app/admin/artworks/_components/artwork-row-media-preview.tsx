'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { ArtworkMediaThumbnailGrid } from '../../_components/artwork-media-thumbnail-grid'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import type { ImageListItem } from './types'
import { useArtworkMediaUpload } from '../_hooks/use-artwork-media-upload'
import { ImageManagerDragOverlay } from './image-manager/drag-overlay'
import { AddImageDialog } from './add-image-dialog'
import { ImageReplaceDialog } from './image-replace-dialog'

interface ArtworkRowMediaPreviewProps {
  artworkId: number
  onSuccess?: () => void
}

export function ArtworkRowMediaPreview({ artworkId, onSuccess }: ArtworkRowMediaPreviewProps) {
  const trpc = useTRPC()
  const artworkQuery = useQuery(trpc.artwork.getById.queryOptions(artworkId))
  const { refetch } = artworkQuery
  const handleSuccess = useCallback(() => {
    void refetch()
    onSuccess?.()
  }, [onSuccess, refetch])

  if (artworkQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> 加载媒体预览…
      </div>
    )
  }

  if (!artworkQuery.data) {
    return <div className="py-8 text-center text-sm text-muted-foreground">媒体预览加载失败</div>
  }

  return <ArtworkRowMediaPreviewContent artwork={artworkQuery.data} onSuccess={handleSuccess} />
}

function ArtworkRowMediaPreviewContent({ artwork, onSuccess }: { artwork: ArtworkResponseDto; onSuccess: () => void }) {
  const imageList = artwork.images as ImageListItem[]
  const mediaUpload = useArtworkMediaUpload({ artwork, imageList, onSuccess })

  return (
    <>
      <div
        data-testid="artwork-row-media-drop-target"
        className={cn(
          'relative min-h-40 p-4 transition-colors duration-150 ease-out',
          mediaUpload.isDragging && 'bg-accent/10'
        )}
        {...mediaUpload.dragHandlers}
      >
        {mediaUpload.isDragging && <ImageManagerDragOverlay dragZone={mediaUpload.dragZone} />}

        <ArtworkMediaThumbnailGrid media={imageList} emptyMessage="该作品没有媒体，可将文件拖到此处新增或替换" />
      </div>

      <AddImageDialog {...mediaUpload.addDialog} />
      <ImageReplaceDialog {...mediaUpload.replaceDialog} />
    </>
  )
}
