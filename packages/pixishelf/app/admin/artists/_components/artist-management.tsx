'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { useTRPCClient, useTRPC } from '@/lib/trpc'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { Input } from '@/components/ui/input'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import { Search, RotateCcw, Edit, Trash, ExternalLink, Plus, Star, Sparkles, RefreshCw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ArtistDialog } from './artist-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import Link from 'next/link'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { AdminImageVisibilitySwitch } from '../../_components/admin-image-visibility-switch'
import {
  ArtistAvatarThumbnail,
  ArtistBackgroundThumbnail,
  ArtistImagePreviewDialog,
  type ArtistImagePreviewTarget
} from './artist-image-preview'
import { PixivArtistEnrichmentDialog } from './pixiv-artist-enrichment-dialog'

type ArtistListItem = ArtistResponseDto

export function StarButton({
  id,
  initialIsStarred,
  onToggle
}: {
  id: number
  initialIsStarred: boolean
  onToggle: (id: number, val: boolean) => Promise<void>
}) {
  const [isStarred, setIsStarred] = useState(initialIsStarred)
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async () => {
    if (isLoading) return
    const newValue = !isStarred
    // 乐观更新：先立即反映 UI 状态，再由请求成功决定是否回滚
    setIsStarred(newValue)
    setIsLoading(true)
    try {
      await onToggle(id, newValue)
    } catch (_error) {
      // 请求失败时回滚为上一次已确认状态
      setIsStarred(!newValue)
      toast.error('操作失败')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label={isStarred ? '取消星标' : '设为星标'}
      disabled={isLoading}
    >
      <Star className={cn(isStarred ? 'fill-warning text-warning' : 'text-muted-foreground')} aria-hidden="true" />
    </Button>
  )
}

import { buildArtistQuery } from './utils'

export function ArtistManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pixivDialogOpen, setPixivDialogOpen] = useState(false)
  const [editingArtist, setEditingArtist] = useState<ArtistListItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [previewedImage, setPreviewedImage] = useState<ArtistImagePreviewTarget | null>(null)
  const showArtistImages = useAdminPreferencesStore((state) => state.showArtistImages)
  const columnVisibility = useMemo<VisibilityState>(
    () => ({ avatar: showArtistImages, backgroundImg: showArtistImages }),
    [showArtistImages]
  )
  const loadedArtistsRef = useRef(new Map<number, ArtistListItem>())
  const selectedArtistIds = Object.keys(rowSelection).map(Number)
  const selectedArtists = selectedArtistIds
    .map((id) => loadedArtistsRef.current.get(id))
    .filter((artist): artist is ArtistListItem => Boolean(artist))

  // 1. URL 参数同步状态
  const [searchState, setSearchState] = useQueryStates({
    name: parseAsString, // 对应 API 的 search 参数
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    sortId: parseAsString,
    sortDesc: parseAsString, // 'true' | 'false'
    isStarred: parseAsString, // 'true' | 'false' | null
    pixivStatus: parseAsString
  })

  // 2. 本地搜索输入状态
  const [keyword, setKeyword] = useState(searchState.name || '')

  // 星标 Mutation
  const setStarMutation = useMutation(
    trpc.artist.setStar.mutationOptions({
      onSuccess: () => {
        // 更新成功后刷新列表
        setRefreshKey((prev) => prev + 1)
      },
      onError: (err) => {
        toast.error(`操作失败: ${err.message}`)
      }
    })
  )

  const handleToggleStar = useCallback(
    async (id: number, isStarred: boolean) => {
      await setStarMutation.mutateAsync({ id, isStarred })
    },
    [setStarMutation]
  )

  // 3. 排序状态 (从 URL 派生)
  const sorting = useMemo<SortingState>(() => {
    if (searchState.sortId) {
      return [{ id: searchState.sortId, desc: searchState.sortDesc === 'true' }]
    }
    return []
  }, [searchState.sortId, searchState.sortDesc])

  // 处理排序变更
  const handleSortingChange = useCallback(
    (updaterOrValue: any) => {
      const newSorting = typeof updaterOrValue === 'function' ? updaterOrValue(sorting) : updaterOrValue

      if (newSorting.length > 0) {
        const { id, desc } = newSorting[0]
        setSearchState({
          sortId: id,
          sortDesc: desc ? 'true' : 'false'
        })
      } else {
        setSearchState({ sortId: null, sortDesc: null })
      }
    },
    [sorting, setSearchState]
  )

  // 删除 Mutation
  const deleteMutation = useMutation(
    trpc.artist.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        setRefreshKey((prev) => prev + 1)
      },
      onError: (err) => {
        toast.error(`删除失败: ${err.message}`)
      }
    })
  )

  const retryPixivMutation = useMutation(
    trpc.artist.retryPixivEnrichment.mutationOptions({
      onSuccess: () => {
        toast.success('Pixiv 艺术家重试任务已创建')
        setRefreshKey((prev) => prev + 1)
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const adoptPixivNameMutation = useMutation(
    trpc.artist.adoptPixivSourceName.mutationOptions({
      onSuccess: () => {
        toast.success('已采用 Pixiv 来源姓名')
        setRefreshKey((prev) => prev + 1)
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const handleDelete = (id: number) => {
    confirm({
      title: '确定删除该艺术家吗？',
      description: '删除后无法恢复，且如果有作品关联将无法删除。',
      onConfirm: () => {
        deleteMutation.mutate(id)
      }
    })
  }

  const handleEdit = (item: ArtistListItem) => {
    setEditingArtist(item)
    setDialogOpen(true)
  }

  // 4. 数据请求函数
  const request = useCallback(
    async (params: { pageSize: number; current: number }) => {
      const queryParams = buildArtistQuery(params, searchState)
      const res = await trpcClient.artist.queryPage.query(queryParams)
      for (const artist of res.data) loadedArtistsRef.current.set(artist.id, artist)

      return {
        data: res.data,
        total: res.pagination.total,
        success: true
      }
    },
    [trpcClient, searchState]
  )

  // 5. 操作处理函数
  const handleSearch = () => {
    setRowSelection({})
    setSearchState({
      name: keyword || null,
      page: 1
    })
  }

  const handleReset = () => {
    setRowSelection({})
    setKeyword('')
    setSearchState({
      name: null,
      page: 1,
      pageSize: 20,
      sortId: null,
      sortDesc: null,
      isStarred: null,
      pixivStatus: null
    })
  }

  // 分页变更处理
  const handlePaginationChange = (updaterOrValue: any) => {
    const currentPagination = {
      pageIndex: (searchState.page || 1) - 1,
      pageSize: searchState.pageSize || 20
    }

    const newPagination = typeof updaterOrValue === 'function' ? updaterOrValue(currentPagination) : updaterOrValue

    setSearchState({
      page: newPagination.pageIndex + 1,
      pageSize: newPagination.pageSize
    })
  }

  // 列定义
  const columns = useMemo<ProColumnDef<ArtistListItem>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        header: ({ table }) => {
          const eligibleRows = table.getRowModel().rows.filter((row) => row.original.pixivEligible)
          const selectedCount = eligibleRows.filter((row) => row.getIsSelected()).length
          const checked =
            selectedCount === 0 ? false : selectedCount === eligibleRows.length ? true : ('indeterminate' as const)
          return (
            <Checkbox
              checked={checked}
              disabled={eligibleRows.length === 0}
              onCheckedChange={(value) => eligibleRows.forEach((row) => row.toggleSelected(Boolean(value)))}
              aria-label="选择本页所有具有 Pixiv 身份的艺术家"
            />
          )
        },
        cell: ({ row }) =>
          row.original.pixivEligible ? (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
              aria-label={`选择艺术家 ${row.original.name}`}
            />
          ) : null,
        enableHiding: false
      },
      {
        accessorKey: 'id',
        header: 'ID',
        cell: ({ row }) => <div className="w-[50px]">{row.getValue('id')}</div>
      },
      {
        accessorKey: 'isStarred',
        header: '星标',
        cell: ({ row }) => (
          <StarButton id={row.original.id} initialIsStarred={row.getValue('isStarred')} onToggle={handleToggleStar} />
        )
      },
      {
        accessorKey: 'avatar',
        header: '头像',
        size: 76,
        cell: ({ row }) => (
          <ArtistAvatarThumbnail
            name={row.original.name}
            image={row.original.avatar}
            onPreview={setPreviewedImage}
          />
        )
      },
      {
        accessorKey: 'backgroundImg',
        header: '背景图',
        size: 112,
        cell: ({ row }) => (
          <ArtistBackgroundThumbnail
            name={row.original.name}
            image={row.original.backgroundImg}
            onPreview={setPreviewedImage}
          />
        )
      },
      {
        accessorKey: 'name',
        header: '姓名',
        enableSorting: true,
        cell: ({ row }) => (
          <div className="grid gap-1">
            <span>{row.original.name}</span>
            {row.original.pixivSync?.sourceName && row.original.pixivSync.sourceName !== row.original.name ? (
              <span className="text-xs text-muted-foreground">Pixiv：{row.original.pixivSync.sourceName}</span>
            ) : null}
          </div>
        )
      },
      {
        id: 'sources',
        header: '来源',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.sources.map((source) => (
              <Badge
                key={`${source.providerKey}:${source.externalId}`}
                variant={source.type === 'PIXIV' ? 'info' : 'secondary'}
              >
                {source.type === 'PIXIV'
                  ? `Pixiv ${source.externalId}`
                  : source.type === 'LOCAL'
                    ? '本地'
                    : source.type === 'MANUAL'
                      ? '手工'
                      : source.providerKey}
              </Badge>
            ))}
          </div>
        )
      },
      {
        id: 'pixivSync',
        header: 'Pixiv 补全',
        cell: ({ row }) => <PixivSyncBadge artist={row.original} />
      },
      {
        accessorKey: 'artworksCount',
        header: '作品数',
        cell: ({ row }) => {
          return <div className="font-medium">{row.getValue('artworksCount')}</div>
        },
        enableSorting: true
      },
      {
        accessorKey: 'createdAt',
        header: '创建时间',
        cell: ({ row }) => {
          return <div className="text-muted-foreground">{row.getValue('createdAt')}</div>
        }
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleEdit(row.original)}
              aria-label={`编辑艺术家 ${row.original.name}`}
            >
              <Edit aria-hidden="true" />
            </Button>
            <Button asChild variant="ghost" size="icon">
              <Link
                href={`/artists/${row.original.id}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`在新标签页打开艺术家 ${row.original.name}`}
              >
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
            {row.original.pixivEligible ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={retryPixivMutation.isPending}
                onClick={() => retryPixivMutation.mutate({ artistId: row.original.id })}
                aria-label={`重新从 Pixiv 补全艺术家 ${row.original.name}`}
                title="重新从 Pixiv 补全"
              >
                {retryPixivMutation.isPending && retryPixivMutation.variables?.artistId === row.original.id ? (
                  <Spinner />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
              </Button>
            ) : null}
            {row.original.pixivSync?.sourceName && row.original.pixivSync.sourceName !== row.original.name ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={adoptPixivNameMutation.isPending}
                onClick={() => adoptPixivNameMutation.mutate({ artistId: row.original.id })}
                aria-label={`采用艺术家 ${row.original.name} 的 Pixiv 来源姓名`}
                title={`采用 Pixiv 姓名：${row.original.pixivSync.sourceName}`}
              >
                <Check aria-hidden="true" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => handleDelete(row.original.id)}
              aria-label={`删除艺术家 ${row.original.name}`}
            >
              <Trash aria-hidden="true" />
            </Button>
          </div>
        )
      }
    ],
    [adoptPixivNameMutation, handleToggleStar, retryPixivMutation]
  )

  return (
    <div>
      <ProTable
        key={refreshKey}
        rowKey="id"
        columns={columns}
        request={request}
        defaultPageSize={20}
        // 分页控制
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnVisibility={columnVisibility}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        headerTitle="艺术家列表"
        toolBarRender={() => (
          <>
            {selectedArtistIds.length ? (
              <>
                <span className="text-sm text-muted-foreground">已选择 {selectedArtistIds.length} 项</span>
                <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
                  清除选择
                </Button>
              </>
            ) : null}
            <AdminImageVisibilitySwitch
              id="artist-image-column-visibility"
              label="显示图片"
              preference="artist-images"
            />
          </>
        )}
        searchRender={() => (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Select
              value={searchState.isStarred || 'all'}
              onValueChange={(val) => {
                setSearchState({ isStarred: val === 'all' ? null : val, page: 1 })
              }}
            >
              <SelectTrigger className="h-8 w-[120px]" aria-label="筛选星标状态">
                <SelectValue placeholder="星标状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="true">已星标</SelectItem>
                  <SelectItem value="false">未星标</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={searchState.pixivStatus || 'all'}
              onValueChange={(value) => {
                setRowSelection({})
                setSearchState({ pixivStatus: value === 'all' ? null : value, page: 1 })
              }}
            >
              <SelectTrigger className="h-8 w-[160px]" aria-label="筛选 Pixiv 补全状态">
                <SelectValue placeholder="Pixiv 补全状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部补全状态</SelectItem>
                  <SelectItem value="NO_IDENTITY">无 Pixiv 身份</SelectItem>
                  <SelectItem value="UNCHECKED">待检查</SelectItem>
                  <SelectItem value="CHECKED">已检查</SelectItem>
                  <SelectItem value="SUCCESS">成功</SelectItem>
                  <SelectItem value="PARTIAL">部分成功</SelectItem>
                  <SelectItem value="NO_DATA">无数据</SelectItem>
                  <SelectItem value="FAILED">失败</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              name="artist-search"
              aria-label="搜索艺术家"
              autoComplete="off"
              placeholder="搜索艺术家…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-8 w-full md:w-[200px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="default" size="sm" onClick={handleSearch}>
              <Search data-icon="inline-start" aria-hidden="true" />
              搜索
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              重置
            </Button>
            <Button variant="default" size="sm" onClick={() => setPixivDialogOpen(true)}>
              <Sparkles data-icon="inline-start" aria-hidden="true" />
              {selectedArtistIds.length ? `补全已选 ${selectedArtistIds.length} 项` : '从 Pixiv 补全'}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setEditingArtist(null)
                setDialogOpen(true)
              }}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              新增艺术家
            </Button>
          </div>
        )}
      />

      <ArtistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        artist={editingArtist}
        onSuccess={() => setRefreshKey((prev) => prev + 1)}
      />
      <PixivArtistEnrichmentDialog
        open={pixivDialogOpen}
        onOpenChange={setPixivDialogOpen}
        onStatusChanged={() => {
          setRowSelection({})
          setRefreshKey((prev) => prev + 1)
        }}
        selectedArtists={selectedArtists.map((artist) => ({
          id: artist.id,
          name: artist.name,
          checked: artist.pixivSync?.status != null
        }))}
      />
      <ArtistImagePreviewDialog
        target={previewedImage}
        onOpenChange={(open) => !open && setPreviewedImage(null)}
      />
    </div>
  )
}

function PixivSyncBadge({ artist }: { artist: ArtistListItem }) {
  if (!artist.pixivEligible) return <span className="text-muted-foreground">—</span>
  const status = artist.pixivSync?.status
  if (!status) return <Badge variant="outline">待检查</Badge>
  const display = {
    SUCCESS: { label: '成功', variant: 'success' as const },
    PARTIAL: { label: '部分成功', variant: 'warning' as const },
    NO_DATA: { label: '无数据', variant: 'muted' as const },
    FAILED: { label: '失败', variant: 'destructive' as const }
  }[status]
  return (
    <Badge variant={display.variant} title={artist.pixivSync?.lastError ?? undefined}>
      {display.label}
    </Badge>
  )
}
