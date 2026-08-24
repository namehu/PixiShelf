'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { RefreshCw, Download, Edit2, Trash, Search, RotateCcw, Plus, Sparkles } from 'lucide-react'
import type { TagManagementStats } from '@/types/tags'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateTagStatsAction, exportUntranslatedTagsAction } from '@/actions/tag-action'
import { getTranslateName } from '@/utils/tags'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { useQueryStates, parseAsString, parseAsInteger } from 'nuqs'
import { RowSelectionState, SortingState } from '@tanstack/react-table'
import { useMutation } from '@tanstack/react-query'
import { confirm } from '@/components/shared/global-confirm'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

// 导入子组件
import { TagStatsCards } from './tag-stats-cards'
import { TagDialog } from './tag-dialog'
import { PixivTagEnrichmentDialog } from './pixiv-tag-enrichment-dialog'
import { Spinner } from '@/components/ui/spinner'
import { TagCoverPreviewDialog, TagCoverThumbnail, type TagCoverTarget } from './tag-cover'

// 定义 TagListItem 类型，匹配后端返回的数据结构
interface TagListItem {
  id: number
  name: string
  isSystem: boolean
  systemKey: string | null
  name_zh: string | null
  name_en: string | null
  description: string | null
  image: string
  artworkCount: number
  createdAt: string
  updatedAt: string
  pixivEligible: boolean
  pixivSync: {
    status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA' | 'FAILED'
    lastAttemptAt: string
    lastErrorCode: string | null
    lastError: string | null
    lastSystemJobId: string | null
  } | null
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
  const [pixivDialogOpen, setPixivDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<TagListItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [previewedCover, setPreviewedCover] = useState<TagCoverTarget | null>(null)
  const loadedTagsRef = useRef(new Map<number, TagListItem>())
  const selectedTagIds = Object.keys(rowSelection).map(Number)
  const selectedTags = selectedTagIds
    .map((id) => loadedTagsRef.current.get(id))
    .filter((tag): tag is TagListItem => Boolean(tag))

  // 同步 URL 查询参数到当前列表状态
  const [searchState, setSearchState] = useQueryStates({
    name: parseAsString,
    filter: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  // 搜索输入框的本地暂存状态
  const [localSearch, setLocalSearch] = useState({
    name: searchState.name || '',
    filter: searchState.filter || 'all'
  })

  const handleSearch = () => {
    setRowSelection({})
    setSearchState({
      name: localSearch.name || null,
      filter: localSearch.filter,
      page: 1 // 重置到第一页
    })
  }

  const handleReset = () => {
    setRowSelection({})
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

  // 删除标签的 Mutation
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

  const retryPixivMutation = useMutation(
    trpc.tag.retryPixivEnrichment.mutationOptions({
      onSuccess: () => {
        toast.success('Pixiv 标签重试任务已创建')
        setRefreshKey((prev) => prev + 1)
      },
      onError: (error) => toast.error(error.message)
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
            onCheckedChange={(value) => {
              for (const row of eligibleRows) row.toggleSelected(Boolean(value))
            }}
            aria-label="选择本页所有可从 Pixiv 补全的标签"
          />
        )
      },
      cell: ({ row }) =>
        row.original.pixivEligible ? (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label={`选择标签 ${row.original.name}`}
          />
        ) : null,
      enableSorting: false,
      enableHiding: false
    },
    {
      header: '标签名称',
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link
            href={`/tags/${row.original.id}`}
            className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {row.original.name}
          </Link>
          {row.original.isSystem && (
            <Badge variant="secondary" className="text-xs font-normal">
              系统
            </Badge>
          )}
        </div>
      )
    },
    {
      header: '中文翻译',
      accessorKey: 'name_zh',
      cell: ({ row }) => {
        const record = row.original
        const tName = getTranslateName(record)
        return <div className={tName ? 'text-foreground' : 'text-muted-foreground italic'}>{tName || '未翻译'}</div>
      }
    },
    {
      header: '作品数量',
      accessorKey: 'artworkCount',
      enableSorting: true,
      size: 120
    },
    {
      id: 'cover',
      header: '封面',
      size: 112,
      cell: ({ row }) => <TagCoverThumbnail tag={row.original} onPreview={setPreviewedCover} />
    },
    {
      id: 'pixivSync',
      header: 'Pixiv 补全',
      size: 120,
      cell: ({ row }) => <PixivSyncBadge tag={row.original} />
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
      size: 160,
      cell: ({ row }) => {
        const record = row.original

        return (
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => handleEdit(record)}
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label={`编辑标签 ${record.name}`}
            >
              <Edit2 aria-hidden="true" />
            </Button>
            {record.pixivEligible && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-foreground"
                disabled={retryPixivMutation.isPending}
                onClick={() => retryPixivMutation.mutate({ tagId: record.id })}
                aria-label={`重新从 Pixiv 补全标签 ${record.name}`}
                title="重新从 Pixiv 补全"
              >
                {retryPixivMutation.isPending && retryPixivMutation.variables?.tagId === record.id ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
              </Button>
            )}
            {!record.isSystem && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleDelete(record.id, record.artworkCount)}
                aria-label={`删除标签 ${record.name}`}
              >
                <Trash aria-hidden="true" />
              </Button>
            )}
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

      for (const tag of res.data.tags) loadedTagsRef.current.set(tag.id, tag)

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
    // 兼容 React Table 的 updater 模式（支持函数更新）
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
    <div className="flex min-w-0 flex-col gap-6">
      <div
        className="flex w-full flex-wrap justify-end gap-2 border-b border-border pb-4"
        role="toolbar"
        aria-label="标签维护操作"
      >
        <Button
          onClick={() => setPixivDialogOpen(true)}
          className="flex flex-1 items-center justify-center gap-2 md:flex-none"
        >
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          {selectedTagIds.length ? `补全已选 ${selectedTagIds.length} 项` : '从 Pixiv 补全'}
        </Button>
        <Button
          variant="outline"
          onClick={handleExportUntranslated}
          disabled={isExporting}
          className="flex-1 md:flex-none flex items-center justify-center gap-2"
        >
          <Download
            data-icon="inline-start"
            className={isExporting ? 'animate-bounce' : undefined}
            aria-hidden="true"
          />
          {isExporting ? '导出中…' : '导出未翻译'}
        </Button>
        <Button
          variant="outline"
          onClick={handleUpdateStats}
          disabled={isUpdatingStats}
          className="flex-1 md:flex-none flex items-center justify-center gap-2"
        >
          <RefreshCw
            data-icon="inline-start"
            className={isUpdatingStats ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          {isUpdatingStats ? '更新中…' : '更新统计'}
        </Button>
      </div>

      {/* 统计卡片 */}
      <TagStatsCards stats={stats} isLoading={false} />

      {/* 高级表格 */}
      <ProTable
        key={refreshKey}
        rowKey="id"
        headerTitle="标签列表"
        toolBarRender={() =>
          selectedTagIds.length ? (
            <>
              <span className="text-sm text-muted-foreground">已选择 {selectedTagIds.length} 项</span>
              <Button size="sm" onClick={() => setPixivDialogOpen(true)}>
                <Sparkles data-icon="inline-start" aria-hidden="true" />
                补全已选
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
                清除选择
              </Button>
            </>
          ) : null
        }
        columns={columns}
        request={request}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        defaultPageSize={20}
        // 分页参数受控，由 URL 同步来源（避免翻页状态丢失）
        pagination={{
          pageIndex: (searchState.page || 1) - 1,
          pageSize: searchState.pageSize || 20
        }}
        onPaginationChange={handlePaginationChange}
        searchRender={() => (
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Input
              name="tag-search"
              aria-label="搜索标签名称"
              autoComplete="off"
              placeholder="搜索标签名称…"
              value={localSearch.name}
              onChange={(e) => setLocalSearch((prev) => ({ ...prev, name: e.target.value }))}
              className="h-8 w-full md:w-[200px]"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Select
              value={localSearch.filter}
              onValueChange={(value) => setLocalSearch((prev) => ({ ...prev, filter: value }))}
            >
              <SelectTrigger className="h-8 w-full md:w-[120px]" aria-label="筛选翻译状态">
                <SelectValue placeholder="翻译状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="translated">已翻译</SelectItem>
                  <SelectItem value="untranslated">未翻译</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
              <Button variant="default" size="sm" onClick={handleSearch} className="h-8 px-3 flex-1 md:flex-none">
                <Search data-icon="inline-start" aria-hidden="true" />
                搜索
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset} className="h-8 px-3 flex-1 md:flex-none">
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                重置
              </Button>
              <Button variant="default" size="sm" className="ml-auto" onClick={handleCreate}>
                <Plus data-icon="inline-start" aria-hidden="true" />
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
      <PixivTagEnrichmentDialog
        open={pixivDialogOpen}
        onOpenChange={(open) => {
          setPixivDialogOpen(open)
          if (!open) setRefreshKey((prev) => prev + 1)
        }}
        selectedTags={selectedTags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          image: tag.image,
          checked: Boolean(tag.pixivSync)
        }))}
        onBatchStarted={() => {
          setRowSelection({})
          setRefreshKey((prev) => prev + 1)
        }}
        onStatusChanged={() => {
          setRefreshKey((prev) => prev + 1)
        }}
      />
      <TagCoverPreviewDialog tag={previewedCover} onOpenChange={(open) => !open && setPreviewedCover(null)} />
    </div>
  )
}

function PixivSyncBadge({ tag }: { tag: TagListItem }) {
  if (!tag.pixivEligible) return <span className="text-muted-foreground">—</span>
  if (!tag.pixivSync) return <Badge variant="outline">未检查</Badge>
  const presentation = {
    SUCCESS: { label: '成功', variant: 'success' as const },
    PARTIAL: { label: '部分成功', variant: 'warning' as const },
    NO_DATA: { label: '无数据', variant: 'muted' as const },
    FAILED: { label: '失败', variant: 'destructive' as const }
  }[tag.pixivSync.status]
  return (
    <Badge variant={presentation.variant} title={tag.pixivSync.lastError || undefined}>
      {presentation.label}
    </Badge>
  )
}
