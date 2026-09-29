'use client'

import { useState } from 'react'
import { Play, ZoomIn } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatFileSize } from '@/utils/media'
import { combinationApiResource } from '@/utils/combination-static'
import { appendCacheKey } from '../utils'
import { LazyImage } from '../lazy-image'
import type { ImageListItem } from '../types'
import { isVideoImageListItem } from './utils'
import { ImageMediaActions, ImageVideoMetadataEntry } from './columns'
import { ImageVideoOptimizationEntry, type VideoOptimizationJob } from './video-optimization'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface ImageManagerThumbnailListProps {
  imageList: ImageListItem[]
  refreshKey: number
  reprobingImageId: number | null
  videoOptimizationJobsByImageId: Record<number, VideoOptimizationJob | undefined>
  startingVideoOptimizationImageId: number | null
  onPreviewIndexChange: (index: number) => void
  onOpenVideoMetadata: (image: ImageListItem) => void
  onDownload: (path: string) => void
  onOpenChapterDialog: (image: ImageListItem, mode: 'upload' | 'replace') => void
  onDownloadChapters: (image: ImageListItem) => void
  onDeleteChapter: (image: ImageListItem) => void
  onReprobeVideo: (image: ImageListItem) => void
  onStartVideoOptimization: (image: ImageListItem) => void
  onCancelVideoOptimization: (job: VideoOptimizationJob) => void
  onDelete: (imageId: number) => void
}

export function ImageManagerThumbnailList({
  imageList,
  refreshKey,
  reprobingImageId,
  videoOptimizationJobsByImageId,
  startingVideoOptimizationImageId,
  onPreviewIndexChange,
  onOpenVideoMetadata,
  onDownload,
  onOpenChapterDialog,
  onDownloadChapters,
  onDeleteChapter,
  onReprobeVideo,
  onStartVideoOptimization,
  onCancelVideoOptimization,
  onDelete
}: ImageManagerThumbnailListProps) {
  const [playingVideoId, setPlayingVideoId] = useState<number | null>(null)

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      <div
        data-testid="image-manager-thumbnail-grid"
        className="grid w-full grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        {imageList.map((img, index) => {
          const fileName = img.path.split('/').pop() || ''
          const isVideo = isVideoImageListItem(img)
          const isPlaying = isVideo && playingVideoId === img.id
          const thumbnailMedia = isVideo
            ? {
                ...img,
                posterUrl: img.posterUrl || null
              }
            : {
                ...img,
                path: appendCacheKey(img.path, refreshKey)
              }
          return (
            <div
              key={img.id}
              data-testid="image-manager-thumbnail-card"
              className="group relative aspect-square overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40"
            >
              <div
                data-testid="image-manager-thumbnail-media"
                className="relative aspect-square h-full w-full bg-muted/50"
              >
                {isPlaying ? (
                  <video
                    src={appendCacheKey(combinationApiResource(img.path), refreshKey)}
                    className="h-full w-full object-contain p-3"
                    controls
                    autoPlay
                    preload="metadata"
                  />
                ) : (
                  <div className="relative h-full w-full">
                    {isVideo ? (
                      <MediaThumbnail
                        media={thumbnailMedia}
                        alt={img.path}
                        fill
                        className="object-contain p-3"
                        sizes="(max-width: 768px) 100vw, 720px"
                      />
                    ) : (
                      <>
                        <LazyImage
                          src={thumbnailMedia.path}
                          alt={img.path}
                          fill
                          className="object-contain p-3"
                          sizes="(max-width: 768px) 100vw, 720px"
                        />
                        <button
                          type="button"
                          className="absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`预览 ${fileName}`}
                          onClick={() => onPreviewIndexChange(index)}
                        >
                          <ZoomIn className="size-8 text-primary/60 drop-shadow-sm" aria-hidden="true" />
                        </button>
                      </>
                    )}
                    {isVideo ? (
                      <button
                        type="button"
                        data-testid="video-thumbnail-play"
                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/15"
                        aria-label={`播放 ${fileName}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setPlayingVideoId(img.id)
                        }}
                      >
                        <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm">
                          <Play className="size-5 fill-current" />
                        </span>
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/45 to-transparent p-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="rounded bg-black/45 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
                    #{img.sortOrder}
                  </span>
                  <Badge variant={isVideo ? 'secondary' : 'outline'} className="bg-background/85">
                    {isVideo ? '视频' : '图片'}
                  </Badge>
                </div>
              </div>

              <div className="absolute right-2 top-2 z-20 flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <ImageMediaActions
                  image={img}
                  buttonVariant="secondary"
                  reprobingImageId={reprobingImageId}
                  onDownload={onDownload}
                  onOpenChapterDialog={onOpenChapterDialog}
                  onDownloadChapters={onDownloadChapters}
                  onDeleteChapter={onDeleteChapter}
                  onReprobeVideo={onReprobeVideo}
                  videoOptimizationJob={videoOptimizationJobsByImageId[img.id]}
                  isStartingVideoOptimization={startingVideoOptimizationImageId === img.id}
                  onStartVideoOptimization={onStartVideoOptimization}
                  onDelete={onDelete}
                />
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-2.5 text-white">
                <PrivacySensitiveText as="div" className="truncate text-xs font-medium">
                  {fileName}
                </PrivacySensitiveText>
                <div className="mt-0.5 truncate text-[10px] text-white/75">
                  {img.width && img.height ? `${img.width} × ${img.height}` : '未知尺寸'}
                  {' · '}
                  {formatFileSize(img.size || 0)}
                </div>
                <div className="pointer-events-auto mt-1">
                  <ImageVideoMetadataEntry image={img} onOpenVideoMetadata={onOpenVideoMetadata} />
                </div>
                <div className="pointer-events-auto mt-1">
                  <ImageVideoOptimizationEntry
                    image={img}
                    job={videoOptimizationJobsByImageId[img.id]}
                    isStarting={startingVideoOptimizationImageId === img.id}
                    compact
                    onStart={onStartVideoOptimization}
                    onCancel={onCancelVideoOptimization}
                  />
                </div>
                <span className="sr-only">
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
