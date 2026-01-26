'use client'
import { useState, useCallback } from 'react'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Edit, Trash, ExternalLink, Download, FolderInput, BarChart3 } from 'lucide-react'
import { ArtworkDialog } from './artwork-dialog'
import { toast } from 'sonner'
import Link from 'next/link'
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { useMigration } from '../_hooks/use-migration'
import { MigrationDialog } from './migration-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { ProTable } from '@/components/shared/pro-table'
import { useMutation } from '@tanstack/react-query'
import { ColumnDef, RowSelectionState } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Search, RotateCcw } from 'lucide-react'

// 定义作品列表项类型
export interface ArtworkListItem {
  id: number
  title: string
  description: string | null
  imageCount: number
  firstImagePath?: string
  artist?: {
    id: number
    name: string
  } | null
  createdAt: string
  updatedAt: string
}

export default function ArtworkManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingArtwork, setEditingArtwork] = useState<any>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Row Selection State
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const selectedRowKeys = Object.keys(rowSelection)

  // URL Search Params Sync
  const [searchState, setSearchState] = useQueryStates({
    title: parseAsString,
    artistName: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  // Local state for search inputs
  const [localSearch, setLocalSearch] = useState({
    title: searchState.title || '',
    artistName: searchState.artistName || ''
  })

  const handleSearch = () => {
    setSearchState({
      title: localSearch.title || null,
      artistName: localSearch.artistName || null,
      page: 1 // 重置到第一页
    })
  }

  const handleReset = () => {
    setLocalSearch({ title: '', artistName: '' })
    setSearchState({
      title: null,
      artistName: null,
      page: 1,
      pageSize: 20
    })
  }

  // Migration Hook
  const { state: migrationState, actions: migrationActions, logger: migrationLogger } = useMigration()
  const [logOpen, setLogOpen] = useState(false)

  // 批量删除 Mutation
  const deleteMutation = useMutation(
    trpc.artwork.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        setRefreshKey((prev) => prev + 1)
        setRowSelection({})
      }
    })
  )

  const [refreshKey, setRefreshKey] = useState(0)

  const handleExportNoSeries = async () => {
    try {
      setIsExporting(true)
      const res = await exportNoSeriesArtworksAction()

      if (!res.success || !res.data) {
        toast.error('导出失败: ' + (res.error || '未知错误'))
        return
      }

      const ids = res.data

      if (ids.length === 0) {
        toast.info('没有找到无系列的作品')
        return
      }

      const content = ids.join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `no-series-artworks-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`成功导出 ${ids.length} 个作品ID`)
    } catch (error) {
      toast.error('导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDelete = (id: number) => {
    confirm({
      title: '确定删除该作品吗？',
      onConfirm: () => {
        deleteMutation.mutate(id)
      }
    })
  }

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return

    confirm({
      title: `确定删除选中的 ${selectedRowKeys.length} 个作品吗？`,
      onConfirm: async () => {
        // 由于后端只提供了单删接口，这里循环调用（实际项目中应提供批量接口）
        // 演示目的，我们假设只能单删
        // 实际操作：循环调用
        // 注意：并发过多可能会有问题
        try {
          // 这里使用 deleteMutation.mutateAsync 进行删除
          // 但 mutateAsync 是针对单个 mutation 的，如果在循环中调用同一个 mutation 实例，可能会有状态覆盖问题
          // 不过 react-query 的 mutation 可以多次调用
          // 或者直接使用 trpcClient (vanilla client) 来进行批量请求

          await Promise.all(selectedRowKeys.map((id) => deleteMutation.mutateAsync(Number(id))))

          toast.success('批量删除成功')
          setRefreshKey((prev) => prev + 1)
          setRowSelection({})
        } catch (error) {
          toast.error('部分删除失败')
        }
      }
    })
  }

  const handleEdit = (item: any) => {
    setEditingArtwork(item)
    setDialogOpen(true)
  }

  // --- Migration Handlers ---
  const handleMigrationClick = () => {
    const isBatch = selectedRowKeys.length > 0
    const count = selectedRowKeys.length

    confirm({
      title: isBatch ? `确认迁移选中的 ${count} 个作品？` : '确认执行全量迁移？',
      description: isBatch ? (
        <div className="text-sm text-neutral-400 mt-2 space-y-2">
          <div>此操作将对选中的作品执行结构化迁移，尝试将其文件移动到标准化的目录结构中。</div>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>迁移过程中请勿关闭浏览器窗口。</li>
          </ul>
        </div>
      ) : (
        <div className="text-sm text-neutral-400 mt-2 space-y-2">
          <div>此操作将扫描所有作品，并尝试将其文件移动到标准化的目录结构中。</div>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>涉及大量文件移动，可能需要较长时间。</li>
            <li>建议在执行前备份数据。</li>
            <li>迁移过程中请勿关闭浏览器窗口。</li>
          </ul>
        </div>
      ),
      confirmText: '确认开始',
      onConfirm: () => {
        setLogOpen(true)
        const onComplete = () => {
          setRefreshKey((prev) => prev + 1)
          setRowSelection({})
        }

        if (isBatch) {
          migrationActions.startMigration({
            targetIds: selectedRowKeys.map(Number),
            onComplete
          })
        } else {
          migrationActions.startMigration({
            onComplete
          })
        }
      }
    })
  }

  // ProTable 列定义
  const columns: ColumnDef<ArtworkListItem>[] = [
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
      header: '标题',
      accessorKey: 'title',
      cell: ({ row }) => (
        <Link href={`/artworks/${row.original.id}`} className="hover:underline font-medium" target="_blank">
          {row.original.title}
        </Link>
      )
    },
    {
      header: '路径',
      accessorKey: 'firstImagePath',
      cell: ({ row }) => (
        <span
          className="font-mono text-xs text-neutral-400 truncate max-w-[200px] block"
          title={row.original.firstImagePath}
        >
          {row.original.firstImagePath || '-'}
        </span>
      )
    },
    {
      header: '作者',
      accessorKey: 'artist', // or use a custom accessor
      cell: ({ row }) => row.original.artist?.name || '未知'
    },
    {
      header: '图片数',
      accessorKey: 'imageCount',
      size: 100
    },
    {
      header: '创建时间',
      accessorKey: 'createdAt',
      size: 180
    },
    {
      id: 'actions',
      header: '操作',
      size: 160,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row.original)} title="编辑">
            <Edit className="w-4 h-4" />
          </Button>
          <Link href={`/artworks/${row.original.id}`} target="_blank">
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

  // ProTable 请求函数
  const request = useCallback(
    async (params: { pageSize: number; current: number }) => {
      // 这里的 params 实际上会和 searchState 中的 page/pageSize 同步
      // 但为了保险起见，我们直接使用 searchState 中的值，
      // 或者依赖 ProTable 传回来的值（如果 ProTable 是完全受控的，传回来的也是正确的）

      const res = await trpcClient.artwork.list.query({
        cursor: params.current,
        pageSize: params.pageSize,
        search: searchState.title || undefined,
        artistName: searchState.artistName || undefined
      })

      return {
        data: res.items.map((item) => ({
          ...item,
          description: item.description || null, // 确保 description 至少是 null 而不是 undefined
          // 确保 createdAt 是字符串
          createdAt: new Date(item.createdAt).toLocaleString('zh-CN'),
          updatedAt: new Date(item.updatedAt).toLocaleString('zh-CN')
        })),
        total: res.total,
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
    <div className="space-y-4 p-4">
      {/* 页面标题 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 md:w-6 md:h-6" />
            作品管理
          </h1>
          <p className="text-sm md:text-base text-neutral-600 mt-1">管理作品，支持搜索、筛选和批量操作</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button
            key="export"
            variant="outline"
            size="sm"
            onClick={handleExportNoSeries}
            disabled={isExporting}
            className="flex items-center gap-2"
          >
            <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
            {isExporting ? '导出中...' : '导出无系列ID'}
          </Button>
          {(migrationState.migrating || migrationLogger.logs.length > 0) && (
            <Button key="logs" variant="ghost" size="sm" onClick={() => setLogOpen(true)}>
              查看日志
            </Button>
          )}
        </div>
      </div>

      <ProTable
        key={refreshKey}
        headerTitle="作品管理"
        rowKey="id"
        columns={columns}
        request={request}
        defaultPageSize={20}
        // 分页受控
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        searchRender={() => (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Input
              placeholder="搜索作品标题..."
              value={localSearch.title}
              onChange={(e) => setLocalSearch((prev) => ({ ...prev, title: e.target.value }))}
              className="h-8 w-full md:w-[200px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Input
              placeholder="搜索作者..."
              value={localSearch.artistName}
              onChange={(e) => setLocalSearch((prev) => ({ ...prev, artistName: e.target.value }))}
              className="h-8 w-full md:w-[150px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
              <Button variant="default" size="sm" onClick={handleSearch} className="h-8 px-3 flex-1 md:flex-none">
                <Search className="w-4 h-4 mr-1" />
                搜索
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset} className="h-8 px-3 flex-1 md:flex-none">
                <RotateCcw className="w-4 h-4 mr-1" />
                重置
              </Button>
            </div>
          </div>
        )}
        toolBarRender={() => (
          <>
            {selectedRowKeys.length > 0 && (
              <Button key="batch-delete" variant="destructive" size="sm" onClick={handleBatchDelete}>
                删除选中 ({selectedRowKeys.length})
              </Button>
            )}
            <Button
              key="migrate"
              variant="secondary"
              size="sm"
              className="gap-2"
              onClick={handleMigrationClick}
              disabled={migrationState.migrating}
            >
              {migrationState.migrating ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  迁移中...
                </span>
              ) : (
                <>
                  <FolderInput className="w-4 h-4" />
                  {selectedRowKeys.length > 0 ? `批量迁移 (${selectedRowKeys.length})` : '全量迁移'}
                </>
              )}
            </Button>
          </>
        )}
      />

      <ArtworkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        artwork={editingArtwork}
        onSuccess={() => setRefreshKey((prev) => prev + 1)}
      />

      <MigrationDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        migrationState={migrationState}
        migrationActions={migrationActions}
        migrationLogger={migrationLogger}
      />
    </div>
  )
}
