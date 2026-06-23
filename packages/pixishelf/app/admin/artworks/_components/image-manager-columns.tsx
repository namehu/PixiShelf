'use client'

import { Download, MoreHorizontal, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ProColumnDef } from '@/components/shared/pro-table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatFileSize } from '@/utils/media'
import type { ImageListItem } from './types'
import { getChapterActionLabel, getVideoMetadataSummary, isVideoImageListItem } from './image-manager-utils'

interface ImageVideoMetadataEntryProps {
  image: ImageListItem
  onOpenVideoMetadata: (image: ImageListItem) => void
}

export function ImageVideoMetadataEntry({ image, onOpenVideoMetadata }: ImageVideoMetadataEntryProps) {
  if (!isVideoImageListItem(image)) {
    return <span className="text-xs text-neutral-400">-</span>
  }

  const summary = getVideoMetadataSummary(image)
  const Icon = summary.icon

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-7 gap-1.5 rounded-sm px-2 text-xs font-medium', summary.className)}
      title="查看视频媒体详情"
      onClick={(event) => {
        event.stopPropagation()
        onOpenVideoMetadata(image)
      }}
    >
      <Icon className="h-3.5 w-3.5" />
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
  onDelete
}: ImageMediaActionsProps) {
  const video = isVideoImageListItem(image)

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={buttonVariant}
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-primary"
        title="下载媒体"
        onClick={(e) => {
          e.stopPropagation()
          onDownload(image.path)
        }}
      >
        <Download className="w-3.5 h-3.5" />
      </Button>

      {video && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={buttonVariant}
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              title="章节操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation()
                onOpenChapterDialog(image, image.hasChapters ? 'replace' : 'upload')
              }}
            >
              <Upload className="w-4 h-4" />
              {getChapterActionLabel(image)}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!image.hasChapters || !image.chaptersUrl}
              onClick={(event) => {
                event.stopPropagation()
                onDownloadChapters(image)
              }}
            >
              <Download className="w-4 h-4" />
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
              <Trash2 className="w-4 h-4" />
              删除章节
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={reprobingImageId === image.id}
              onClick={(event) => {
                event.stopPropagation()
                onReprobeVideo(image)
              }}
            >
              <RotateCcw className={cn('w-4 h-4', reprobingImageId === image.id && 'animate-spin')} />
              {reprobingImageId === image.id ? '探测中...' : '重新探测视频'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant={buttonVariant}
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        title="删除媒体"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(image.id)
        }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

interface CreateImageManagerColumnsInput {
  reprobingImageId: number | null
  onClearHover: () => void
  onMouseEnter: (path: string, event: React.MouseEvent) => void
  onMouseLeave: () => void
  onOpenVideoMetadata: (image: ImageListItem) => void
  onDownload: (path: string) => void
  onOpenChapterDialog: (image: ImageListItem, mode: 'upload' | 'replace') => void
  onDownloadChapters: (image: ImageListItem) => void
  onDeleteChapter: (image: ImageListItem) => void
  onReprobeVideo: (image: ImageListItem) => void
  onDelete: (imageId: number) => void
}

export function createImageManagerColumns({
  reprobingImageId,
  onClearHover,
  onMouseEnter,
  onMouseLeave,
  onOpenVideoMetadata,
  onDownload,
  onOpenChapterDialog,
  onDownloadChapters,
  onDeleteChapter,
  onReprobeVideo,
  onDelete
}: CreateImageManagerColumnsInput): ProColumnDef<ImageListItem>[] {
  return [
    {
      header: 'Order',
      accessorKey: 'sortOrder',
      size: 60,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sortOrder}</span>
    },
    {
      header: '文件名 / 路径',
      accessorKey: 'path',
      cell: ({ getValue }) => {
        const val = getValue<string>()
        return (
          <div className="flex flex-col gap-0.5" onClick={onClearHover}>
            <span>
              <span
                className="font-medium text-sm cursor-help"
                onMouseEnter={(e) => onMouseEnter(val, e)}
                onMouseLeave={onMouseLeave}
              >
                {val.split('/').pop()}
              </span>
            </span>
            <span className="text-[10px] text-neutral-400 truncate max-w-[300px]" title={val}>
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
      header: '尺寸',
      accessorKey: 'width',
      size: 100,
      cell: ({ row }) => (
        <span className="text-xs font-mono text-neutral-500">
          {row.original.width && row.original.height ? `${row.original.width} x ${row.original.height}` : '-'}
        </span>
      )
    },
    {
      header: '大小',
      accessorKey: 'size',
      size: 80,
      cell: ({ getValue }) => (
        <span className="text-xs text-neutral-500">{formatFileSize(getValue<number>() || 0)}</span>
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
          onDelete={onDelete}
        />
      )
    }
  ]
}
