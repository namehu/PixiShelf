'use client'

import Link from 'next/link'
import { Copy, Edit, ExternalLink, InfoIcon, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ProColumnDef } from '@/components/shared/pro-table'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from '@/components/artwork/preferred-tag'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ArtworkRescanButton } from './artwork-rescan-button'
import { Badge } from '@/components/ui/badge'

function PreferredTagCell({ artwork }: { artwork: ArtworkResponseDto }) {
  const preferredTags = usePreferredTags()
  const preferredTag = getPreferredTagName(preferredTags, artwork.tags)

  if (!preferredTag) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <Badge variant="secondary" className="max-w-full font-normal">
      <span className="truncate">{preferredTag}</span>
    </Badge>
  )
}

interface ArtworkManagementColumnHandlers {
  pendingReplaceCopyMode: boolean
  onOpenInfo: (item: ArtworkResponseDto) => void
  onEdit: (item: ArtworkResponseDto) => void
  onCopy: (item: ArtworkResponseDto) => void
  onOpenImageManager: (item: ArtworkResponseDto) => void
  onDelete: (id: number) => void
  onRefresh: () => void
}

export function createArtworkManagementColumns({
  pendingReplaceCopyMode,
  onOpenInfo,
  onEdit,
  onCopy,
  onOpenImageManager,
  onDelete,
  onRefresh
}: ArtworkManagementColumnHandlers): ProColumnDef<ArtworkResponseDto>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="选择本页全部作品"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={`选择作品 ${row.original.title}`}
          className="translate-y-[2px]"
        />
      ),
      enableSorting: false,
      enableHiding: false
    },
    {
      header: '内部ID',
      accessorKey: 'id',
      size: 100,
      copyable: true,
      cell: ({ row }) => <span className="font-mono">{row.original.id}</span>
    },
    {
      header: '存储/来源ID',
      accessorKey: 'externalId',
      size: 180,
      copyable: true,
      copyValue: (artwork) => {
        const identity = artwork.storageKey ?? artwork.externalId
        return identity ? (pendingReplaceCopyMode ? `__ext-${identity}` : identity) : null
      },
      cell: ({ row }) => row.original.storageKey ?? row.original.externalId ?? '-'
    },
    {
      header: '偏好',
      id: 'preferredTag',
      size: 120,
      cell: ({ row }) => <PreferredTagCell artwork={row.original} />
    },
    {
      header: '标题',
      accessorKey: 'title',
      size: 240,
      ellipsis: true,
      copyable: true,
      cell: ({ row: { original } }) => {
        const { title } = original
        return (
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-medium" title={title}>
              {title}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => onOpenInfo(original)}
              aria-label={`查看作品 ${title} 的信息`}
            >
              <InfoIcon aria-hidden="true" />
            </Button>
          </div>
        )
      }
    },
    {
      header: '作者',
      accessorKey: 'artist',
      cell: ({ row }) => {
        const artist = row.original.artist

        if (!artist?.id) {
          return '未知'
        }

        return (
          <div className="min-w-0 select-text">
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate" title={artist.name}>
                {artist.name}
              </span>
              <Link
                href={`/artists/${artist.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-primary"
                aria-label={`在新标签页打开艺术家 ${artist.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </div>
          </div>
        )
      }
    },
    {
      header: '媒体数',
      accessorKey: 'mediaCount',
      size: 100,
      cell: ({ row }) => (
        <Button
          variant="link"
          className="h-auto font-mono hover:underline cursor-pointer"
          onClick={() => onOpenImageManager(row.original)}
          title="管理媒体"
        >
          {row.original.mediaCount}
        </Button>
      )
    },
    {
      header: '发布日期',
      accessorKey: 'sourceDate'
    },

    {
      id: 'actions',
      header: '操作',
      size: 160,
      headerClassName: 'sticky right-0 z-20 border-l border-border bg-background',
      cellClassName: 'sticky right-0 z-10 border-l border-border bg-background',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(row.original)}
            aria-label={`编辑作品 ${row.original.title}`}
          >
            <Edit aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCopy(row.original)}
            aria-label={`复制作品 ${row.original.title}`}
          >
            <Copy aria-hidden="true" />
          </Button>
          <ArtworkRescanButton artwork={row.original} onComplete={onRefresh} />
          <Button asChild variant="ghost" size="icon">
            <Link
              href={`/artworks/${row.original.id}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`在新标签页打开作品 ${row.original.title}`}
            >
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => onDelete(row.original.id)}
            aria-label={`删除作品 ${row.original.title}`}
          >
            <Trash aria-hidden="true" />
          </Button>
        </div>
      )
    }
  ]
}
