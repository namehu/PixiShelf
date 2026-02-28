'use client'
import { useState, useCallback } from 'react'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SDropdown } from '@/components/shared/s-dropdown'
import {
  Edit,
  Trash,
  ExternalLink,
  Download,
  FolderInput,
  BarChart3,
  Plus,
  FileText,
  ChevronDown,
  ChevronUp,
  Sliders
} from 'lucide-react'
import { ArtworkDialog } from './artwork-dialog'
import { toast } from 'sonner'
import Link from 'next/link'
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { useMigration } from '../_hooks/use-migration'
import { MigrationDialog } from './migration-dialog'
import { ImageManagerDialog } from './image-manager-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useQueryStates, parseAsString, parseAsInteger, parseAsBoolean } from 'nuqs'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { useMutation } from '@tanstack/react-query'
import { RowSelectionState } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Search, RotateCcw } from 'lucide-react'
import { ProDatePicker, ProDatePickerPresets } from '@/components/shared/pro-date-picker'
import { format } from 'date-fns'
import { BatchImportDialog } from './batch-import-dialog'
import { ArtworkRescanButton } from './artwork-rescan-button'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export default function ArtworkManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [batchImportOpen, setBatchImportOpen] = useState(false)
  const [editingArtwork, setEditingArtwork] = useState<any>(null)
  const [imageManagerOpen, setImageManagerOpen] = useState(false)
  const [managingArtwork, setManagingArtwork] = useState<ArtworkResponseDto | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isPrechecking, setIsPrechecking] = useState(false)
  const [migrationSafety, setMigrationSafety] = useState({
    transferMode: 'move' as 'move' | 'copy',
    verifyAfterCopy: true,
    cleanupSource: true
  })

  // Row Selection State
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const selectedRowKeys = Object.keys(rowSelection)

  // URL Search Params Sync
  const [searchState, setSearchState] = useQueryStates({
    title: parseAsString,
    artistName: parseAsString,
    startDate: parseAsString,
    endDate: parseAsString,
    externalId: parseAsString,
    exactMatch: parseAsBoolean.withDefault(false),
    tags: parseAsString,
    mediaCountMin: parseAsInteger,
    mediaCountMax: parseAsInteger,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useQueryStates({
    advancedSearch: parseAsBoolean.withDefault(false)
  })

  // Local state for search inputs
  const [localSearch, setLocalSearch] = useState({
    title: searchState.title || '',
    artistName: searchState.artistName || '',
    startDate: searchState.startDate || '',
    endDate: searchState.endDate || '',
    externalId: searchState.externalId || '',
    exactMatch: searchState.exactMatch || false,
    tags: searchState.tags ? searchState.tags.split(',').map((tag) => ({ label: tag, value: tag })) : ([] as Option[]),
    mediaCountMin: searchState.mediaCountMin ?? '',
    mediaCountMax: searchState.mediaCountMax ?? ''
  })

  const handleSearch = () => {
    setSearchState({
      title: localSearch.title || null,
      artistName: localSearch.artistName || null,
      startDate: localSearch.startDate || null,
      endDate: localSearch.endDate || null,
      externalId: localSearch.externalId || null,
      exactMatch: localSearch.exactMatch || null,
      tags: localSearch.tags.length > 0 ? localSearch.tags.map((t) => t.value).join(',') : null,
      mediaCountMin: localSearch.mediaCountMin === '' ? null : Number(localSearch.mediaCountMin),
      mediaCountMax: localSearch.mediaCountMax === '' ? null : Number(localSearch.mediaCountMax),
      page: 1 // 重置到第一页
    })
  }

  const handleReset = () => {
    setLocalSearch({
      title: '',
      artistName: '',
      startDate: '',
      endDate: '',
      externalId: '',
      exactMatch: false,
      tags: [],
      mediaCountMin: '',
      mediaCountMax: ''
    })
    setSearchState({
      title: null,
      artistName: null,
      startDate: null,
      endDate: null,
      externalId: null,
      exactMatch: null,
      tags: null,
      mediaCountMin: null,
      mediaCountMax: null,
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

  const handleEdit = (item: any) => {
    setEditingArtwork(item)
    setDialogOpen(true)
  }

  const handleOpenImageManager = (item: ArtworkResponseDto) => {
    setManagingArtwork(item)
    setImageManagerOpen(true)
  }

  // --- Migration Handlers ---
  const buildMigrationFilters = () => {
    return {
      search: searchState.title || null,
      artistName: searchState.artistName || null,
      startDate: searchState.startDate || null,
      endDate: searchState.endDate || null,
      externalId: searchState.externalId || null,
      exactMatch: searchState.exactMatch || false
    }
  }

  const handleMigrationClick = async () => {
    if (isPrechecking) return
    const isBatch = selectedRowKeys.length > 0
    const count = selectedRowKeys.length
    const filters = buildMigrationFilters()
    const hasFilters =
      !isBatch && !!(filters.search || filters.artistName || filters.startDate || filters.endDate || filters.externalId)

    try {
      setIsPrechecking(true)
      const precheckPayload: any = {
        targetIds: isBatch ? selectedRowKeys.map(Number) : undefined
      }
      if (hasFilters) {
        precheckPayload.search = filters.search
        precheckPayload.artistName = filters.artistName
        precheckPayload.startDate = filters.startDate
        precheckPayload.endDate = filters.endDate
        precheckPayload.externalId = filters.externalId
        precheckPayload.exactMatch = filters.exactMatch
      }

      const result = await trpcClient.migration.precheck.query(precheckPayload)

      confirm({
        title: isBatch
          ? `确认迁移选中的 ${count} 个作品？`
          : hasFilters
            ? `确认按筛选条件迁移 ${result.total} 个作品？`
            : '确认执行全量迁移？',
        description: (
          <div className="text-sm text-neutral-400 mt-2 space-y-2">
            <div>
              预检结果：总数 {result.total}，可迁移 {result.eligible}，缺少艺术家 {result.missingArtist}，缺少
              ExternalId {result.missingExternalId}，无图片 {result.missingImages}
            </div>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>迁移过程中请勿关闭浏览器窗口。</li>
              {!isBatch && !hasFilters && <li>涉及大量文件移动，可能需要较长时间。</li>}
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
              safety: migrationSafety,
              onComplete
            })
          } else {
            migrationActions.startMigration({
              filters: hasFilters ? filters : undefined,
              safety: migrationSafety,
              onComplete
            })
          }
        }
      })
    } catch (error: any) {
      toast.error(error?.message || '预检失败')
    } finally {
      setIsPrechecking(false)
    }
  }

  // ProTable 列定义
  const columns: ProColumnDef<ArtworkResponseDto>[] = [
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
      header: '作品id',
      accessorKey: 'externalId',
      size: 180,
      copyable: true,
      cell: ({ row }) => (row.original as any).externalId || '-'
    },
    {
      header: '标题',
      accessorKey: 'title',
      size: 240,
      ellipsis: true,
      cell: ({ row: { original } }) => {
        const { title, metaSource = '-' } = original
        return (
          <div className="font-medium">
            <div className="truncate" title={title}>
              {title}
            </div>
            <span className="font-mono text-xs text-neutral-400 truncate max-w-[200px] block" title={metaSource!}>
              {metaSource || '-'}
            </span>
          </div>
        )
      }
    },
    {
      header: '作者',
      accessorKey: 'artist',
      cell: ({ row }) => row.original.artist?.name || '未知'
    },
    {
      header: '发布日期',
      accessorKey: 'sourceDate'
    },
    {
      header: '媒体数',
      accessorKey: 'mediaCount',
      size: 100,
      cell: ({ row }) => (
        <Button
          variant="link"
          className="h-auto font-mono hover:underline cursor-pointer"
          onClick={() => handleOpenImageManager(row.original)}
          title="管理媒体"
        >
          {row.original.mediaCount}
        </Button>
      )
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
          <ArtworkRescanButton artwork={row.original} onComplete={() => setRefreshKey((prev) => prev + 1)} />
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
      const res = await trpcClient.artwork.list.query({
        cursor: params.current,
        pageSize: params.pageSize,
        search: searchState.title,
        artistName: searchState.artistName,
        startDate: searchState.startDate,
        endDate: searchState.endDate,
        externalId: searchState.externalId,
        exactMatch: searchState.exactMatch,
        tags: searchState.tags,
        mediaCountMin: searchState.mediaCountMin,
        mediaCountMax: searchState.mediaCountMax
      })
      const { items, total } = res

      return { data: items, total, success: true }
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                迁移策略
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="space-y-3">
                <div className="text-sm font-medium text-neutral-800">传输方式</div>
                <Select
                  value={migrationSafety.transferMode}
                  onValueChange={(value) =>
                    setMigrationSafety((prev) => ({
                      ...prev,
                      transferMode: value as 'move' | 'copy'
                    }))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="选择方式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="move">移动</SelectItem>
                    <SelectItem value="copy">复制</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={migrationSafety.verifyAfterCopy}
                    onCheckedChange={(value) =>
                      setMigrationSafety((prev) => ({
                        ...prev,
                        verifyAfterCopy: !!value
                      }))
                    }
                    disabled={migrationSafety.transferMode !== 'copy'}
                  />
                  <span className="text-sm text-neutral-700">复制后校验</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={migrationSafety.cleanupSource}
                    onCheckedChange={(value) =>
                      setMigrationSafety((prev) => ({
                        ...prev,
                        cleanupSource: !!value
                      }))
                    }
                  />
                  <span className="text-sm text-neutral-700">清理源文件</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            key="create"
            variant="default"
            size="sm"
            className="gap-2"
            onClick={() => {
              setEditingArtwork(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="w-4 h-4" />
            新增作品
          </Button>

          <SDropdown
            menu={{
              items: [
                {
                  key: 'batchImport',
                  icon: <Plus className="w-4 h-4" />,
                  label: '批量导入',
                  onClick: () => setBatchImportOpen(true)
                },
                {
                  key: 'export',
                  icon: <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />,
                  label: isExporting ? '导出中...' : '导出无系列ID',
                  disabled: isExporting,
                  onClick: handleExportNoSeries
                },
                {
                  key: 'migrate',
                  icon: migrationState.migrating ? (
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  ) : (
                    <FolderInput className="w-4 h-4" />
                  ),
                  label: migrationState.migrating
                    ? '迁移中...'
                    : selectedRowKeys.length > 0
                      ? `批量迁移 (${selectedRowKeys.length})`
                      : '目录迁移',
                  disabled: migrationState.migrating,
                  onClick: handleMigrationClick
                },
                {
                  key: 'log-separator',
                  type: 'divider',
                  hidden: !(migrationState.migrating || migrationLogger.logs.length > 0)
                },
                {
                  key: 'logs',
                  icon: <FileText className="w-4 h-4" />,
                  label: '查看日志',
                  hidden: !(migrationState.migrating || migrationLogger.logs.length > 0),
                  onClick: () => setLogOpen(true)
                }
              ]
            }}
          >
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              更多操作
              <ChevronDown className="w-4 h-4" />
            </Button>
          </SDropdown>
        </div>
      </div>

      <ProTable
        key={refreshKey}
        columns={columns}
        request={request as any}
        defaultPageSize={20}
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        searchRender={() => (
          <div className="flex flex-col gap-4 w-full bg-white p-4 rounded-lg border border-neutral-200 shadow-sm">
            {/* Grid Layout for Search Filters */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              {/* Title Search */}
              <div className="col-span-12 md:col-span-4 space-y-1">
                <Label className="text-xs font-medium text-neutral-500">标题</Label>
                <Input
                  placeholder="搜索作品标题..."
                  value={localSearch.title}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, title: e.target.value }))}
                  className="h-9 w-full"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>

              {/* External ID */}
              <div className="col-span-6 md:col-span-4 space-y-1">
                <Label className="text-xs font-medium text-neutral-500">外部ID</Label>
                <Input
                  placeholder="外部ID..."
                  value={localSearch.externalId}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, externalId: e.target.value }))}
                  className="h-9 w-full"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>

              {/* Artist Search */}
              <div className="col-span-6 md:col-span-4 space-y-1">
                <Label className="text-xs font-medium text-neutral-500">作者</Label>
                <Input
                  placeholder="搜索作者..."
                  value={localSearch.artistName}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, artistName: e.target.value }))}
                  className="h-9 w-full"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>

              {/* Date Range & Buttons Group - Combined Row */}
              <div className="col-span-12 flex flex-col md:flex-row gap-4 md:items-end justify-between">
                <div className="w-full md:w-1/3 space-y-1">
                  <Label className="text-xs font-medium text-neutral-500">发布日期</Label>
                  <ProDatePicker
                    mode="range"
                    placeholder="选择日期范围"
                    value={[
                      localSearch.startDate ? new Date(localSearch.startDate) : undefined,
                      localSearch.endDate ? new Date(localSearch.endDate) : undefined
                    ]}
                    onChange={(value = []) => {
                      const [from, to] = value
                      setLocalSearch((prev) => ({
                        ...prev,
                        startDate: from ? format(from, 'yyyy-MM-dd') : '',
                        endDate: to ? format(to, 'yyyy-MM-dd') : ''
                      }))
                    }}
                    presets={ProDatePickerPresets.range}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center gap-4 h-9 w-full md:w-auto justify-between md:justify-end">
                  <div className="flex items-center space-x-2 bg-neutral-100 px-3 py-2 rounded-md h-full shrink-0">
                    <Checkbox
                      id="exactMatch"
                      checked={localSearch.exactMatch}
                      onCheckedChange={(checked) => setLocalSearch((prev) => ({ ...prev, exactMatch: !!checked }))}
                    />
                    <label
                      htmlFor="exactMatch"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 whitespace-nowrap cursor-pointer"
                    >
                      精确
                    </label>
                  </div>

                  <div className="flex gap-1">
                    <Button variant="default" size="sm" onClick={handleSearch} className="h-9 px-3 shrink-0">
                      <Search className="w-3 h-3 mr-1" />
                      搜索
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleReset} className="h-9 px-3 shrink-0">
                      <RotateCcw className="w-3 h-3 mr-1" />
                      重置
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAdvancedSearchOpen({ advancedSearch: !isAdvancedSearchOpen.advancedSearch })}
                      className={cn(
                        'h-9 px-2 shrink-0',
                        isAdvancedSearchOpen.advancedSearch && 'bg-neutral-100 text-neutral-900'
                      )}
                      title={isAdvancedSearchOpen.advancedSearch ? '收起高级搜索' : '展开高级搜索'}
                    >
                      {isAdvancedSearchOpen.advancedSearch ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* 第二行：高级搜索区域 */}
            {isAdvancedSearchOpen.advancedSearch && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 pt-4 border-t border-neutral-100 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* 媒体数量 */}
                <div className="col-span-1 lg:col-span-3 space-y-1">
                  <Label className="text-xs font-medium text-neutral-500">媒体数量</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        placeholder="最小"
                        type="number"
                        min={0}
                        value={localSearch.mediaCountMin}
                        onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMin: e.target.value }))}
                        className="h-9"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-neutral-400">个</span>
                    </div>
                    <span className="text-neutral-400">-</span>
                    <div className="relative flex-1">
                      <Input
                        placeholder="最大"
                        type="number"
                        min={0}
                        value={localSearch.mediaCountMax}
                        onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMax: e.target.value }))}
                        className="h-9"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-neutral-400">个</span>
                    </div>
                  </div>
                </div>

                {/* 标签筛选 */}
                <div className="col-span-1 lg:col-span-9 space-y-1">
                  <Label className="text-xs font-medium text-neutral-500">包含标签</Label>
                  <MultipleSelector
                    value={localSearch.tags}
                    onChange={(options) => setLocalSearch((prev) => ({ ...prev, tags: options }))}
                    onSearch={async (query) => {
                      const res = await trpcClient.tag.list.query({ query, pageSize: 20 })
                      return (res as any).items.map((tag: any) => ({
                        label: tag.name_zh ? `${tag.name} (${tag.name_zh})` : tag.name,
                        value: tag.name
                      }))
                    }}
                    triggerSearchOnFocus
                    placeholder="搜索并选择标签..."
                    emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到相关标签</p>}
                    className="bg-white min-h-[36px]"
                    badgeClassName="bg-primary/10 text-primary hover:bg-primary/20 border-transparent"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      />

      <ArtworkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        artwork={editingArtwork}
        onSuccess={(createdArtwork) => {
          setRefreshKey((prev) => prev + 1)
          if (createdArtwork && !editingArtwork) {
            handleOpenImageManager(createdArtwork)
          }
        }}
      />

      <ImageManagerDialog
        open={imageManagerOpen}
        onOpenChange={setImageManagerOpen}
        data={managingArtwork}
        onSuccess={() => setRefreshKey((prev) => prev + 1)}
      />

      <MigrationDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        migrationState={migrationState}
        migrationActions={migrationActions}
        migrationLogger={migrationLogger}
      />
      <BatchImportDialog
        open={batchImportOpen}
        onOpenChange={setBatchImportOpen}
        onSuccess={() => {
          setRefreshKey((prev) => prev + 1)
        }}
      />
    </div>
  )
}
