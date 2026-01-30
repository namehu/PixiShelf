'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTRPCClient } from '@/lib/trpc'
import { ProTable } from '@/components/shared/pro-table'
import { columns } from './columns'
import { Input } from '@/components/ui/input'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { SortingState } from '@tanstack/react-table'
import { Search, RotateCcw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ArtistManagement() {
  const trpcClient = useTRPCClient()

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

  return (
    <div className="space-y-4 p-4">
      {/* 页面标题 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Users className="w-5 h-5 md:w-6 md:h-6" />
            艺术家管理
          </h1>
          <p className="text-sm md:text-base text-neutral-600 mt-1">管理艺术家信息，支持搜索和排序</p>
        </div>
      </div>

      <ProTable
        columns={columns}
        request={request}
        defaultPageSize={20}
        // 分页控制
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        // 排序控制
        sorting={sorting}
        onSortingChange={handleSortingChange}
        // 搜索栏
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
          </div>
        )}
      />
    </div>
  )
}
