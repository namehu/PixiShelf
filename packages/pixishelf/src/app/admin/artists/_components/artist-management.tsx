'use client'

import { useState, useMemo } from 'react'
import { useTRPC } from '@/lib/trpc'
import { DataTable } from './data-table'
import { columns } from './columns'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/useDebounce'
import { PaginationState, SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'

export function ArtistManagement() {
  // 状态管理
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20
  })
  const [sorting, setSorting] = useState<SortingState>([])
  const [searchTerm, setSearchTerm] = useState('')

  // 防抖搜索
  const debouncedSearch = useDebounce(searchTerm, 500)

  // 计算排序参数
  const sortBy = useMemo(() => {
    if (sorting.length === 0) return 'name_asc'
    const { id, desc } = sorting[0]!
    if (id === 'name') return desc ? 'name_desc' : 'name_asc'
    if (id === 'artworksCount') return desc ? 'artworks_desc' : 'artworks_asc'
    return 'name_asc'
  }, [sorting])

  const trpc = useTRPC()
  // 查询数据
  const { data, isLoading } = useQuery(
    trpc.artist.queryPage.queryOptions({
      cursor: pagination.pageIndex + 1, // pageIndex 是 0-based，API 是 1-based
      pageSize: pagination.pageSize,
      search: debouncedSearch || undefined,
      sortBy
    })
  )

  const artists = data?.data || []
  const pageCount = data?.pagination.totalPages || 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex w-full max-w-sm items-center space-x-2">
          <Input
            placeholder="搜索艺术家..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setPagination((prev) => ({ ...prev, pageIndex: 0 })) // 搜索重置页码
            }}
            className="h-8 w-[150px] lg:w-[250px]"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={artists}
        pageCount={pageCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        isLoading={isLoading}
      />
    </div>
  )
}
