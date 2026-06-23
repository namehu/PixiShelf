'use client'

import Link from 'next/link'
import { Copy, Edit, ExternalLink, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ProColumnDef } from '@/components/shared/pro-table'
import { usePreferredTags } from '@/components/user-setting'
import { getPreferredTagName } from '@/components/artwork/preferred-tag'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ArtworkRescanButton } from './artwork-rescan-button'

function PreferredTagCell({ artwork }: { artwork: ArtworkResponseDto }) {
  const preferredTags = usePreferredTags()
  const preferredTag = getPreferredTagName(preferredTags, artwork.tags)

  if (!preferredTag) {
    return <span className="text-neutral-400">-</span>
  }

  return (
    <span className="inline-flex max-w-full rounded-sm bg-[#ff2f4d]/10 px-2 py-0.5 text-xs font-medium text-[#c81e3a]">
      <span className="truncate">{preferredTag}</span>
    </span>
  )
}

interface ArtworkManagementColumnHandlers {
  onOpenInfo: (item: ArtworkResponseDto) => void
  onEdit: (item: ArtworkResponseDto) => void
  onCopy: (item: ArtworkResponseDto) => void
  onOpenImageManager: (item: ArtworkResponseDto) => void
  onDelete: (id: number) => void
  onRefresh: () => void
}

export function createArtworkManagementColumns({
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
          aria-label="Select all"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
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
      header: '作品id',
      accessorKey: 'externalId',
      size: 180,
      copyable: true,
      cell: ({ row }) => (row.original as any).externalId || '-'
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
      cell: ({ row: { original } }) => {
        const { title } = original
        return (
          <div
            className="font-medium cursor-pointer hover:text-primary transition-colors"
            onClick={() => onOpenInfo(original)}
          >
            <div className="truncate" title={title}>
              {title}
            </div>
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
                className="inline-flex shrink-0 items-center text-neutral-400 transition-colors hover:text-primary"
                title={`在新窗口打开 ${artist.name} 详情页`}
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
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
      headerClassName: 'sticky right-0 z-20 bg-background shadow-[-1px_0_0_0_hsl(var(--border))]',
      cellClassName: 'sticky right-0 z-10 bg-background shadow-[-1px_0_0_0_hsl(var(--border))]',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => onEdit(row.original)} title="编辑">
            <Edit className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onCopy(row.original)} title="复制">
            <Copy className="w-4 h-4" />
          </Button>
          <ArtworkRescanButton artwork={row.original} onComplete={onRefresh} />
          <Link href={`/artworks/${row.original.id}`} target="_blank">
            <Button variant="ghost" size="icon" title="新标签页打开">
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500"
            onClick={() => onDelete(row.original.id)}
            title="删除"
          >
            <Trash className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ]
}
