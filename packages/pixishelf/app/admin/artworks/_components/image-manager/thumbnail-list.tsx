'use client'

import { ZoomIn } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatFileSize } from '@/utils/media'
import { combinationApiResource } from '@/utils/combinationStatic'
import { appendCacheKey } from '../utils'
import { LazyImage } from '../lazy-image'
import type { ImageListItem } from '../types'
import { isVideoImageListItem } from './utils'
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
      <div
        data-testid="image-manager-thumbnail-grid"
        className="grid w-full grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        {imageList.map((img, index) => {
          const fileName = img.path.split('/').pop() || ''
          return (
            <div
              key={img.id}
              data-testid="image-manager-thumbnail-card"
              className="group relative aspect-square overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40"
              onClick={() => {
                if (!isVideoImageListItem(img)) {
                  onPreviewIndexChange(index)
                }
              }}
            >
              <div
                data-testid="image-manager-thumbnail-media"
                className="relative aspect-square h-full w-full bg-neutral-100/50 dark:bg-neutral-800/50"
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

              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/45 to-transparent p-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="rounded bg-black/45 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
                    #{img.sortOrder}
                  </span>
                  <Badge variant={isVideoImageListItem(img) ? 'secondary' : 'outline'} className="bg-background/85">
                    {isVideoImageListItem(img) ? '视频' : '图片'}
                  </Badge>
                </div>
              </div>

              <div className="absolute right-2 top-2 flex shrink-0 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-2.5 text-white">
                <div className="truncate text-xs font-medium" title={fileName}>
                  {fileName}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-white/75">
                  {img.width && img.height ? `${img.width} × ${img.height}` : '未知尺寸'}
                  {' · '}
                  {formatFileSize(img.size || 0)}
                </div>
                <div className="pointer-events-auto mt-1">
                  <ImageVideoMetadataEntry image={img} onOpenVideoMetadata={onOpenVideoMetadata} />
                </div>
                <span className="sr-only" title={img.path}>
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
