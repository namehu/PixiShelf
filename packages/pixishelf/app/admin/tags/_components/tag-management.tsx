'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { BarChart3, RefreshCw, Download, Edit2, Trash, Languages, Search, RotateCcw, Plus } from 'lucide-react'
import type { TagManagementStats } from '@/types/tags'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateTagStatsAction, exportUntranslatedTagsAction } from '@/actions/tag-action'
import { getTranslateName } from '@/utils/tags'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { SortingState } from '@tanstack/react-table'
import { useMutation } from '@tanstack/react-query'
import { confirm } from '@/components/shared/global-confirm'

// 导入子组件
import { TagStatsCards } from './tag-stats-cards'
import { TagDialog } from './tag-dialog'

// 定义 TagListItem 类型，匹配后端返回的数据结构
interface TagListItem {
  id: number
  name: string
  name_zh: string | null
  name_en: string | null
  description: string | null
  artworkCount: number
  createdAt: string
  updatedAt: string
}

/**
 * 导出未翻译标签自定义 Hook
 */
function useExportUntranslatedTags() {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportUntranslated = async () => {
    try {
      setIsExporting(true)
      const { data } = await exportUntranslatedTagsAction()

      if (!data?.length) {
        toast.info('没有需要导出的未翻译标签')
        return
      }

      // 创建Blob并下载
      const content = data.join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `untranslated-tags-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`成功导出 ${data.length} 个未翻译标签`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '导出过程发生错误'
      toast.error(errorMessage)
    } finally {
      setIsExporting(false)
    }
  }

  return {
    isExporting,
    handleExportUntranslated
  }
}

/**
 * 标签管理组件
 */
export default function TagManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()

  // 标签统计状态
  const [stats, setStats] = useState<TagManagementStats>({
    totalTags: 0,
    translatedTags: 0,
    untranslatedTags: 0,
    translationRate: 0
  })

  // 标签统计更新状态
  const [isUpdatingStats, setIsUpdatingStats] = useState(false)

  // 导出未翻译标签状态
  const { isExporting, handleExportUntranslated } = useExportUntranslatedTags()

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<TagListItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // URL Search Params Sync
  const [searchState, setSearchState] = useQueryStates({
    name: parseAsString,
    filter: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  // Local state for search inputs
  const [localSearch, setLocalSearch] = useState({
    name: searchState.name || '',
    filter: searchState.filter || 'all'
  })

  const handleSearch = () => {
    setSearchState({
      name: localSearch.name || null,
      filter: localSearch.filter,
      page: 1 // 重置到第一页
    })
  }

  const handleReset = () => {
    setLocalSearch({ name: '', filter: 'all' })
    setSearchState({
      name: null,
      filter: 'all',
      page: 1,
      pageSize: 20
    })
  }

  // 手动更新标签统计
  const handleUpdateStats = async () => {
    try {
      setIsUpdatingStats(true)
      const result = await updateTagStatsAction()

      if (result.success) {
        toast.success('标签统计更新成功')
        setRefreshKey((prev) => prev + 1)
      } else {
        throw new Error(result.message || '更新失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '标签统计更新失败'
      toast.error(errorMessage)
    } finally {
      setIsUpdatingStats(false)
    }
  }

  // Delete Mutation
  const deleteMutation = useMutation(
    trpc.tag.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        setRefreshKey((prev) => prev + 1)
      },
      onError: (err) => {
        toast.error(`删除失败: ${err.message}`)
      }
    })
  )

  const handleDelete = (id: number, artworkCount: number) => {
    confirm({
      title: '确定删除该标签吗？',
      description:
        artworkCount > 0
          ? `该标签关联了 ${artworkCount} 个作品。删除标签将从所有作品中移除此标签。此操作无法撤销。`
          : '删除后无法恢复。',
      variant: 'destructive',
      confirmText: '确认删除',
      onConfirm: async () => {
        await deleteMutation.mutateAsync(id)
      }
    })
  }

  const handleEdit = (tag: TagListItem) => {
    setEditingTag(tag)
    setDialogOpen(true)
  }

  const handleCreate = () => {
    setEditingTag(null)
    setDialogOpen(true)
  }

  // 表格列定义
  const columns: ProColumnDef<TagListItem>[] = [
    {
      header: '标签名称',
      accessorKey: 'name',
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>
    },
    {
      header: '中文翻译',
      accessorKey: 'name_zh',
      cell: ({ row }) => {
        const record = row.original
        const tName = getTranslateName(record)
        return <div className={tName ? 'text-neutral-900' : 'text-neutral-400 italic'}>{tName || '未翻译'}</div>
      }
    },
    {
      header: '作品数量',
      accessorKey: 'artworkCount',
      enableSorting: true,
      size: 120
    },
    {
      header: '创建时间',
      accessorKey: 'createdAt',
      enableSorting: true,
      size: 180,
      cell: ({ getValue }) => {
        const val = getValue<string>()
        return val ? new Date(val).toLocaleDateString('zh-CN') : '-'
      }
    },
    {
      id: 'actions',
      header: '操作',
      size: 150,
      cell: ({ row }) => {
        const record = row.original
        const tName = getTranslateName(record)

        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleEdit(record)}
              className="text-neutral-600 hover:text-neutral-900 h-8 w-8 p-0"
              title="编辑"
            >
              <Edit2 className="w-4 h-4" />
            </Button>
            {!tName && (
              <Button
                size="sm"
                onClick={() => handleEdit(record)} // Quick edit usually targets translation
                variant="ghost"
                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-8 w-8 p-0"
                title="翻译"
              >
                <Languages className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
              onClick={() => handleDelete(record.id, record.artworkCount)}
              title="删除"
            >
              <Trash className="w-4 h-4" />
            </Button>
          </div>
        )
      }
    }
  ]

  // 数据请求
  const request = useCallback(
    async (params: { pageSize: number; current: number }, sort: SortingState) => {
      // 处理排序
      let sortField = 'artworkCount'
      let sortOrder = 'desc'

      if (sort && sort.length > 0 && sort[0]) {
        sortField = sort[0].id
        sortOrder = sort[0].desc ? 'desc' : 'asc'
      }

      // 调用 TRPC
      const res = await trpcClient.tag.management.query({
        page: params.current,
        limit: params.pageSize,
        search: searchState.name || undefined,
        filter: (searchState.filter as any) || 'all',
        sort: sortField as any,
        order: sortOrder as any
      })

      // 更新统计数据
      if (res.data.stats) {
        setStats(res.data.stats)
      }

      return {
        data: res.data.tags,
        total: res.data.pagination.totalCount,
        success: true
      }
    },
    [trpcClient, searchState]
  )

  const handlePaginationChange = (updaterOrValue: any) => {
    // 处理 React Table 的 updater 模式
    const newPagination =
      typeof updaterOrValue === 'function'
        ? updaterOrValue({
            pageIndex: (searchState.page || 1) - 1,
            pageSize: searchState.pageSize || 20
          })
        : updaterOrValue

    setSearchState({
      page: newPagination.pageIndex + 1,
      pageSize: newPagination.pageSize
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 md:w-6 md:h-6" />
            标签管理
          </h1>
          <p className="text-sm md:text-base text-neutral-600 mt-1">管理标签翻译，支持搜索、筛选和批量操作</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button
            variant="outline"
            onClick={handleExportUntranslated}
            disabled={isExporting}
            className="flex-1 md:flex-none flex items-center justify-center gap-2"
          >
            <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
            {isExporting ? '导出中...' : '导出未翻译'}
          </Button>
          <Button
            variant="outline"
            onClick={handleUpdateStats}
            disabled={isUpdatingStats}
            className="flex-1 md:flex-none flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isUpdatingStats ? 'animate-spin' : ''}`} />
            {isUpdatingStats ? '更新中...' : '更新统计'}
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <TagStatsCards stats={stats} isLoading={false} />

      {/* 高级表格 */}
      <ProTable
        key={refreshKey}
        rowKey="id"
        headerTitle="标签列表"
        columns={columns}
        request={request}
        defaultPageSize={20}
        // 分页受控
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        searchRender={() => (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Input
              placeholder="搜索标签名称..."
              value={localSearch.name}
              onChange={(e) => setLocalSearch((prev) => ({ ...prev, name: e.target.value }))}
              className="h-8 w-full md:w-[200px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Select
              value={localSearch.filter}
              onValueChange={(value) => setLocalSearch((prev) => ({ ...prev, filter: value }))}
            >
              <SelectTrigger className="h-8 w-full md:w-[120px]">
                <SelectValue placeholder="翻译状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="translated">已翻译</SelectItem>
                <SelectItem value="untranslated">未翻译</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
              <Button variant="default" size="sm" onClick={handleSearch} className="h-8 px-3 flex-1 md:flex-none">
                <Search className="w-4 h-4 mr-1" />
                搜索
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset} className="h-8 px-3 flex-1 md:flex-none">
                <RotateCcw className="w-4 h-4 mr-1" />
                重置
              </Button>
              <Button variant="default" size="sm" className="gap-2 ml-auto" onClick={handleCreate}>
                <Plus className="w-4 h-4" />
                新增标签
              </Button>
            </div>
          </div>
        )}
      />

      <TagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tag={editingTag}
        onSuccess={() => setRefreshKey((prev) => prev + 1)}
      />
    </div>
  )
}
