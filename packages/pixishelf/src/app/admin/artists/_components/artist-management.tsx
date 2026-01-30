'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTRPCClient, useTRPC } from '@/lib/trpc'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { Input } from '@/components/ui/input'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { SortingState } from '@tanstack/react-table'
import { Search, RotateCcw, Edit, Trash, ExternalLink, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ArtistDialog } from './artist-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function ArtistManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingArtist, setEditingArtist] = useState<any>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // 1. URL 参数同步状态
  const [searchState, setSearchState] = useQueryStates({
    name: parseAsString, // 对应 API 的 search 参数
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    sortId: parseAsString,
    sortDesc: parseAsString // 'true' | 'false'
  })

  // 2. 本地搜索输入状态
  const [keyword, setKeyword] = useState(searchState.name || '')

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

  const handleDelete = (id: number) => {
    confirm({
      title: '确定删除该艺术家吗？',
      description: '删除后无法恢复，且如果有作品关联将无法删除。',
      onConfirm: () => {
        deleteMutation.mutate(id)
      }
    })
  }

  const handleEdit = (item: any) => {
    setEditingArtist(item)
    setDialogOpen(true)
  }

  // 4. 数据请求函数
  const request = useCallback(
    async (params: { pageSize: number; current: number }) => {
      // 计算 API 所需的 sortBy 参数
      let sortBy: 'name_asc' | 'name_desc' | 'artworks_asc' | 'artworks_desc' = 'name_asc'

      if (searchState.sortId) {
        const isDesc = searchState.sortDesc === 'true'
        if (searchState.sortId === 'name') sortBy = isDesc ? 'name_desc' : 'name_asc'
        if (searchState.sortId === 'artworksCount') sortBy = isDesc ? 'artworks_desc' : 'artworks_asc'
      }

      const res = await trpcClient.artist.queryPage.query({
        cursor: params.current,
        pageSize: params.pageSize,
        search: searchState.name || undefined,
        sortBy
      })

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
    setSearchState({
      name: keyword || null,
      page: 1
    })
  }

  const handleReset = () => {
    setKeyword('')
    setSearchState({
      name: null,
      page: 1,
      pageSize: 20,
      sortId: null,
      sortDesc: null
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
  const columns: ProColumnDef<any>[] = [
    {
      accessorKey: 'id',
      header: 'ID',
      cell: ({ row }) => <div className="w-[50px]">{row.getValue('id')}</div>
    },
    {
      accessorKey: 'avatar',
      header: '头像',
      cell: ({ row }) => {
        const avatar = row.getValue('avatar') as string
        const name = row.getValue('name') as string
        return (
          <Avatar>
            <AvatarImage src={avatar || ''} alt={name} />
            <AvatarFallback>{name?.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        )
      }
    },
    {
      accessorKey: 'name',
      header: '姓名',
      enableSorting: true
    },
    {
      accessorKey: 'username',
      header: '用户名',
      cell: ({ row }) => {
        const username = row.getValue('username') as string
        return username ? <div className="text-muted-foreground">@{username}</div> : '-'
      }
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
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)} title="编辑">
            <Edit className="w-4 h-4" />
          </Button>
          <Link href={`/artists/${row.original.id}`} target="_blank">
            <Button variant="ghost" size="icon" title="新标签页打开">
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500"
            onClick={() => handleDelete(row.original.id)}
            title="删除"
          >
            <Trash className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ]

  return (
    <div>
      <ProTable
        key={refreshKey}
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
        searchRender={() => (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Input
              placeholder="搜索艺术家..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-8 w-full md:w-[200px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="default" size="sm" onClick={handleSearch}>
              <Search className="w-4 h-4 mr-1" />
              搜索
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-1" />
              重置
            </Button>
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={() => {
                setEditingArtist(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="w-4 h-4" />
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
    </div>
  )
}
