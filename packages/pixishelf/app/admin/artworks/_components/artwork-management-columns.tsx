'use client'

import Link from 'next/link'
import { ExternalLink, FileClock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ProColumnDef } from '@/components/shared/pro-table'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from '@/components/artwork/preferred-tag'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ArtworkRowActions } from './artwork-row-actions'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'

function PreferredTagCell({ artwork }: { artwork: ArtworkResponseDto }) {
  const preferredTags = usePreferredTags()
  const preferredTag = getPreferredTagName(preferredTags, artwork.tags)

  if (!preferredTag) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <Badge variant="destructive" className="max-w-full font-semibold">
      <span className="truncate">{preferredTag}</span>
    </Badge>
  )
}

interface ArtworkManagementColumnHandlers {
  pendingReplaceCopyMode: boolean
  onEdit: (item: ArtworkResponseDto) => void
  onCopy: (item: ArtworkResponseDto) => void
  onOpenImageManager: (item: ArtworkResponseDto) => void
  onDelete: (id: number) => void
  onRefresh: () => void
  onRetryPixiv: (artworkId: number) => void
  onOpenPixivReport: (artwork: ArtworkResponseDto) => void
  retryingPixivArtworkId: number | null
}

export function createArtworkManagementColumns({
  pendingReplaceCopyMode,
  onEdit,
  onCopy,
  onOpenImageManager,
  onDelete,
  onRefresh,
  onRetryPixiv,
  onOpenPixivReport,
  retryingPixivArtworkId
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
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
      cell: ({ row }) => <span className="font-mono">{row.original.id}</span>
    },
    {
      header: '存储/来源ID',
      accessorKey: 'externalId',
      size: 180,
      copyable: true,
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
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
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
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
          <span className="block min-w-0 truncate font-medium" title={title}>
            {title}
          </span>
        )
      }
    },
    {
      header: '作者',
      accessorKey: 'artist',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
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
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell',
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
      accessorKey: 'sourceDate',
      headerClassName: 'hidden sm:table-cell',
      cellClassName: 'hidden sm:table-cell'
    },
    {
      id: 'pixivSync',
      header: 'Pixiv 同步',
      size: 168,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <PixivSyncBadge artwork={row.original} />
          {row.original.pixivEligible ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={(event) => {
                event.stopPropagation()
                onOpenPixivReport(row.original)
              }}
              aria-label={`查看作品 ${row.original.title} 的 Pixiv 同步记录`}
              title="查看 Pixiv 同步记录"
            >
              <FileClock aria-hidden="true" />
            </Button>
          ) : null}
          {row.original.pixivSync?.status === 'FAILED' ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={retryingPixivArtworkId !== null}
              onClick={() => onRetryPixiv(row.original.id)}
              aria-label={`重新同步作品 ${row.original.title}`}
              title="重新从 Pixiv 同步"
            >
              {retryingPixivArtworkId === row.original.id ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            </Button>
          ) : null}
        </div>
      )
    },

    {
      id: 'actions',
      header: '操作',
      size: 56,
      headerClassName: 'sticky right-0 z-20 w-14 border-l border-border bg-background text-center',
      cellClassName: 'sticky right-0 z-10 w-14 border-l border-border bg-background text-center',
      cell: ({ row }) => (
        <ArtworkRowActions
          artwork={row.original}
          onEdit={() => onEdit(row.original)}
          onCopy={() => onCopy(row.original)}
          onDelete={() => onDelete(row.original.id)}
          onRescanComplete={onRefresh}
        />
      )
    }
  ]
}

function PixivSyncBadge({ artwork }: { artwork: ArtworkResponseDto }) {
  if (!artwork.pixivEligible) return <span className="text-muted-foreground">—</span>
  const status = artwork.pixivSync?.status
  if (!status) return <Badge variant="outline">未检查</Badge>
  const display = {
    SUCCESS: { label: '成功', variant: 'success' as const },
    PARTIAL: { label: '部分成功', variant: 'warning' as const },
    NO_DATA: { label: '无数据', variant: 'secondary' as const },
    FAILED: { label: '失败', variant: 'destructive' as const }
  }[status]
  return (
    <Badge variant={display.variant} title={artwork.pixivSync?.lastError ?? undefined}>
      {display.label}
    </Badge>
  )
}
