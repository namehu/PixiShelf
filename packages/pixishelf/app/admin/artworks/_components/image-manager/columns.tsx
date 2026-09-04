'use client'

import { Download, MoreHorizontal, RotateCcw, Trash2, Upload, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ProColumnDef } from '@/components/shared/pro-table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatFileSize } from '@/utils/media'
import type { ImageListItem } from '../types'
import { getChapterActionLabel, getVideoMetadataSummary, isVideoImageListItem } from './utils'
import {
  ImageVideoOptimizationEntry,
  isActiveVideoOptimization,
  isMp4OptimizationTarget,
  type VideoOptimizationJob
} from './video-optimization'

interface ImageVideoMetadataEntryProps {
  image: ImageListItem
  onOpenVideoMetadata: (image: ImageListItem) => void
}

export function ImageVideoMetadataEntry({ image, onOpenVideoMetadata }: ImageVideoMetadataEntryProps) {
  if (!isVideoImageListItem(image)) {
    return <span className="text-xs text-muted-foreground">-</span>
  }

  const summary = getVideoMetadataSummary(image)
  const Icon = summary.icon

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-7 gap-1.5 rounded-sm px-2 text-xs font-medium', summary.className)}
      aria-label={`查看视频媒体详情：${image.path}`}
      onClick={(event) => {
        event.stopPropagation()
        onOpenVideoMetadata(image)
      }}
    >
      <Icon data-icon="inline-start" aria-hidden="true" />
      {summary.label}
    </Button>
  )
}

interface ImageMediaActionsProps {
  image: ImageListItem
  buttonVariant?: 'ghost' | 'secondary'
  reprobingImageId: number | null
  onDownload: (path: string) => void
  onOpenChapterDialog: (image: ImageListItem, mode: 'upload' | 'replace') => void
  onDownloadChapters: (image: ImageListItem) => void
  onDeleteChapter: (image: ImageListItem) => void
  onReprobeVideo: (image: ImageListItem) => void
  videoOptimizationJob?: VideoOptimizationJob | null
  isStartingVideoOptimization?: boolean
  onStartVideoOptimization: (image: ImageListItem) => void
  onDelete: (imageId: number) => void
}

export function ImageMediaActions({
  image,
  buttonVariant = 'ghost',
  reprobingImageId,
  onDownload,
  onOpenChapterDialog,
  onDownloadChapters,
  onDeleteChapter,
  onReprobeVideo,
  videoOptimizationJob,
  isStartingVideoOptimization = false,
  onStartVideoOptimization,
  onDelete
}: ImageMediaActionsProps) {
  const video = isVideoImageListItem(image)
  const optimizationActive = isActiveVideoOptimization(videoOptimizationJob)

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={buttonVariant}
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-primary"
        aria-label={`下载媒体 ${image.path}`}
        onClick={(e) => {
          e.stopPropagation()
          onDownload(image.path)
        }}
      >
        <Download aria-hidden="true" />
      </Button>

      {video && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={buttonVariant}
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              aria-label={`打开章节操作菜单：${image.path}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation()
                onOpenChapterDialog(image, image.hasChapters ? 'replace' : 'upload')
              }}
            >
              <Upload data-icon="inline-start" aria-hidden="true" />
              {getChapterActionLabel(image)}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!image.hasChapters || !image.chaptersUrl}
              onClick={(event) => {
                event.stopPropagation()
                onDownloadChapters(image)
              }}
            >
              <Download data-icon="inline-start" aria-hidden="true" />
              下载章节
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!image.hasChapters}
              onClick={(event) => {
                event.stopPropagation()
                onDeleteChapter(image)
              }}
            >
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              删除章节
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!isMp4OptimizationTarget(image) || optimizationActive || isStartingVideoOptimization}
              onClick={(event) => {
                event.stopPropagation()
                onStartVideoOptimization(image)
              }}
            >
              <WandSparkles data-icon="inline-start" aria-hidden="true" />
              {!isMp4OptimizationTarget(image)
                ? '该格式需要转码'
                : optimizationActive
                  ? '无损优化进行中'
                  : 'MP4 无损播放优化'}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={reprobingImageId === image.id}
              onClick={(event) => {
                event.stopPropagation()
                onReprobeVideo(image)
              }}
            >
              <RotateCcw
                data-icon="inline-start"
                aria-hidden="true"
                className={cn(reprobingImageId === image.id && 'animate-spin')}
              />
              {reprobingImageId === image.id ? '探测中…' : '重新探测视频'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant={buttonVariant}
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        aria-label={`删除媒体 ${image.path}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(image.id)
        }}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  )
}

interface CreateImageManagerColumnsInput {
  reprobingImageId: number | null
  onMouseEnter: (image: ImageListItem, event: React.MouseEvent) => void
  onMouseLeave: () => void
  onOpenVideoMetadata: (image: ImageListItem) => void
  onDownload: (path: string) => void
  onOpenChapterDialog: (image: ImageListItem, mode: 'upload' | 'replace') => void
  onDownloadChapters: (image: ImageListItem) => void
  onDeleteChapter: (image: ImageListItem) => void
  onReprobeVideo: (image: ImageListItem) => void
  videoOptimizationJobsByImageId: Record<number, VideoOptimizationJob | undefined>
  startingVideoOptimizationImageId: number | null
  onStartVideoOptimization: (image: ImageListItem) => void
  onCancelVideoOptimization: (job: VideoOptimizationJob) => void
  onDelete: (imageId: number) => void
}

export function createImageManagerColumns({
  reprobingImageId,
  onMouseEnter,
  onMouseLeave,
  onOpenVideoMetadata,
  onDownload,
  onOpenChapterDialog,
  onDownloadChapters,
  onDeleteChapter,
  onReprobeVideo,
  videoOptimizationJobsByImageId,
  startingVideoOptimizationImageId,
  onStartVideoOptimization,
  onCancelVideoOptimization,
  onDelete
}: CreateImageManagerColumnsInput): ProColumnDef<ImageListItem>[] {
  return [
    {
      id: '__select',
      size: 44,
      header: ({ table }) => {
        const videoRows = table.getRowModel().rows.filter((row) => isVideoImageListItem(row.original))
        const selectedCount = videoRows.filter((row) => row.getIsSelected()).length
        return (
          <Checkbox
            aria-label="选择当前页全部视频"
            checked={selectedCount === 0 ? false : selectedCount === videoRows.length ? true : 'indeterminate'}
            disabled={videoRows.length === 0}
            onCheckedChange={(checked) => videoRows.forEach((row) => row.toggleSelected(Boolean(checked)))}
          />
        )
      },
      cell: ({ row }) =>
        isVideoImageListItem(row.original) ? (
          <Checkbox
            aria-label={`选择视频 ${row.original.path}`}
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
            onClick={(event) => event.stopPropagation()}
          />
        ) : null
    },
    {
      header: 'Order',
      accessorKey: 'sortOrder',
      size: 60,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sortOrder}</span>
    },
    {
      header: '文件名 / 路径',
      accessorKey: 'path',
      privacySensitive: true,
      cell: ({ getValue, row }) => {
        const val = getValue<string>()
        return (
          <div className="flex flex-col gap-0.5">
            <span>
              <span
                className="font-medium text-sm cursor-help"
                onMouseEnter={(e) => onMouseEnter(row.original, e)}
                onMouseLeave={onMouseLeave}
              >
                {val.split('/').pop()}
              </span>
            </span>
            <span className="max-w-[300px] truncate text-[10px] text-muted-foreground">
              {val}
            </span>
          </div>
        )
      }
    },
    {
      header: '类型',
      accessorKey: 'mediaType',
      size: 88,
      cell: ({ row }) => (
        <Badge variant={isVideoImageListItem(row.original) ? 'secondary' : 'outline'}>
          {isVideoImageListItem(row.original) ? '视频' : '图片'}
        </Badge>
      )
    },
    {
      header: '视频详情',
      id: 'videoMetadata',
      size: 120,
      cell: ({ row }) => <ImageVideoMetadataEntry image={row.original} onOpenVideoMetadata={onOpenVideoMetadata} />
    },
    {
      header: '播放优化',
      id: 'videoOptimization',
      size: 190,
      cell: ({ row }) => (
        <ImageVideoOptimizationEntry
          image={row.original}
          job={videoOptimizationJobsByImageId[row.original.id]}
          isStarting={startingVideoOptimizationImageId === row.original.id}
          onStart={onStartVideoOptimization}
          onCancel={onCancelVideoOptimization}
        />
      )
    },
    {
      header: '尺寸',
      accessorKey: 'width',
      size: 100,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.width && row.original.height ? `${row.original.width} x ${row.original.height}` : '-'}
        </span>
      )
    },
    {
      header: '大小',
      accessorKey: 'size',
      size: 80,
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">{formatFileSize(getValue<number>() || 0)}</span>
      )
    },
    {
      header: '操作',
      id: 'actions',
      size: 80,
      cell: ({ row }) => (
        <ImageMediaActions
          image={row.original}
          reprobingImageId={reprobingImageId}
          onDownload={onDownload}
          onOpenChapterDialog={onOpenChapterDialog}
          onDownloadChapters={onDownloadChapters}
          onDeleteChapter={onDeleteChapter}
          onReprobeVideo={onReprobeVideo}
          videoOptimizationJob={videoOptimizationJobsByImageId[row.original.id]}
          isStartingVideoOptimization={startingVideoOptimizationImageId === row.original.id}
          onStartVideoOptimization={onStartVideoOptimization}
          onDelete={onDelete}
        />
      )
    }
  ]
}
