'use client'

import { ZoomIn } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatFileSize } from '@/utils/media'
import { combinationApiResource } from '@/utils/combinationStatic'
import { appendCacheKey } from '../utils'
import { LazyImage } from '../lazy-image'
import type { ImageListItem } from '../types'
import { getImageAspectRatio, isVideoImageListItem } from './utils'
import { ImageMediaActions, ImageVideoMetadataEntry } from './columns'

interface ImageManagerThumbnailListProps {
  imageList: ImageListItem[]
  refreshKey: number
  reprobingImageId: number | null
  onPreviewIndexChange: (index: number) => void
  onOpenVideoMetadata: (image: ImageListItem) => void
  onDownload: (path: string) => void
  onOpenChapterDialog: (image: ImageListItem, mode: 'upload' | 'replace') => void
  onDownloadChapters: (image: ImageListItem) => void
  onDeleteChapter: (image: ImageListItem) => void
  onReprobeVideo: (image: ImageListItem) => void
  onDelete: (imageId: number) => void
}

export function ImageManagerThumbnailList({
  imageList,
  refreshKey,
  reprobingImageId,
  onPreviewIndexChange,
  onOpenVideoMetadata,
  onDownload,
  onOpenChapterDialog,
  onDownloadChapters,
  onDeleteChapter,
  onReprobeVideo,
  onDelete
}: ImageManagerThumbnailListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {imageList.map((img, index) => {
          const fileName = img.path.split('/').pop() || ''
          return (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40"
              onClick={() => {
                if (!isVideoImageListItem(img)) {
                  onPreviewIndexChange(index)
                }
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b bg-background/90 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">#{img.sortOrder}</span>
                    <span className="truncate text-sm font-medium text-foreground" title={fileName}>
                      {fileName}
                    </span>
                    <Badge variant={isVideoImageListItem(img) ? 'secondary' : 'outline'}>
                      {isVideoImageListItem(img) ? '视频' : '图片'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {img.width && img.height ? `${img.width} × ${img.height}` : '未知尺寸'}
                    {' · '}
                    {formatFileSize(img.size || 0)}
                  </div>
                  <div className="mt-2">
                    <ImageVideoMetadataEntry image={img} onOpenVideoMetadata={onOpenVideoMetadata} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <ImageMediaActions
                    image={img}
                    buttonVariant="secondary"
                    reprobingImageId={reprobingImageId}
                    onDownload={onDownload}
                    onOpenChapterDialog={onOpenChapterDialog}
                    onDownloadChapters={onDownloadChapters}
                    onDeleteChapter={onDeleteChapter}
                    onReprobeVideo={onReprobeVideo}
                    onDelete={onDelete}
                  />
                </div>
              </div>

              <div
                className="relative mx-auto w-full max-w-2xl bg-neutral-100/50 dark:bg-neutral-800/50"
                style={{ aspectRatio: getImageAspectRatio(img) }}
              >
                {isVideoImageListItem(img) ? (
                  <video
                    src={appendCacheKey(combinationApiResource(img.path), refreshKey)}
                    className="h-full w-full object-contain p-3"
                    controls
                    preload="metadata"
                  />
                ) : (
                  <>
                    <LazyImage
                      src={appendCacheKey(img.path, refreshKey)}
                      alt={img.path}
                      fill
                      className="object-contain p-3"
                      sizes="(max-width: 768px) 100vw, 720px"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <ZoomIn className="text-primary/50 w-8 h-8 drop-shadow-sm" />
                    </div>
                  </>
                )}
              </div>
              <div className="border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="block truncate" title={img.path}>
                  {img.path}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
