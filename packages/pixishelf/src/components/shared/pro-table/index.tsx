'use client'

import * as React from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  PaginationState,
  RowSelectionState,
  OnChangeFn
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCcw, Copy, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// --- 类型定义 ---

/**
 * 扩展的列定义，支持 ellipsis 和 copyable
 */
export type ProColumnDef<TData, TValue = unknown> = ColumnDef<TData, TValue> & {
  /**
   * 是否自动处理超出隐藏 (text-overflow: ellipsis)
   * @default false
   */
  ellipsis?: boolean
  /**
   * 是否支持点击复制内容
   * @default false
   */
  copyable?: boolean
}

/**
 * request 函数返回的数据结构
 */
export type RequestData<T> = {
  /** 表格当前页的数据列表 */
  data: T[]
  /** 是否请求成功 */
  success: boolean
  /** 数据总条数，用于计算分页 */
  total: number
}

/**
 * 父组件可调用的 Action 方法
 */
export type ActionType = {
  /** 刷新当前页数据 */
  reload: () => void
  /** 重置分页、筛选、排序并重新请求 */
  reset: () => void
}

/**
 * ProDataTable 的 Props 定义
 */
interface ProTableProps<TData, TValue> {
  /**
   * @tanstack/react-table 的列定义 (扩展了 ellipsis/copyable)
   */
  columns: ProColumnDef<TData, TValue>[]

  /**
   * 本地数据源。
   * 如果提供了 dataSource，则组件将使用前端分页/排序/筛选，忽略 request。
   */
  dataSource?: TData[]

  /**
   * 获取数据的异步函数。
   * 组件会自动处理 loading 状态，你只需要返回 Promise<RequestData<T>>。
   * * @param params 包含分页参数 { pageSize, current } 以及其他自定义搜索参数
   * @param sort 当前的排序状态
   * @param filter 当前的筛选状态
   */
  request?: (
    params: {
      pageSize: number
      current: number
      [key: string]: any
    },
    sort: SortingState,
    filter: ColumnFiltersState
  ) => Promise<RequestData<TData>>

  /**
   * 自定义工具栏渲染，通常用于放置 "新建"、"导出" 等按钮
   */
  toolBarRender?: boolean | (() => React.ReactNode)

  /**
   * 标题
   */
  headerTitle?: React.ReactNode

  /**
   * 搜索区域渲染
   */
  searchRender?: () => React.ReactNode

  /**
   * 行选择状态
   */
  rowSelection?: RowSelectionState

  /**
   * 行选择回调
   */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>

  /**
   * 行唯一标识，默认为 "id"
   */
  rowKey?: string | ((originalRow: TData) => string)

  /**
   * 获取组件的引用，用于手动触发 reload 或 reset
   */
  actionRef?: React.MutableRefObject<ActionType | undefined>

  /**
   * 默认分页大小
   * @default 10
   */
  defaultPageSize?: number

  /**
   * 分页状态 (受控模式)
   */
  pagination?: PaginationState

  /**
   * 分页状态改变回调 (受控模式)
   */
  onPaginationChange?: OnChangeFn<PaginationState>

  /**
   * 排序状态 (受控模式)
   */
  sorting?: SortingState

  /**
   * 排序状态改变回调 (受控模式)
   */
  onSortingChange?: OnChangeFn<SortingState>

  /**
   * 自定义类名
   */
  className?: string
  /**
   * 分页切换时自动滚动到顶部
   * @default true
   */
  scrollToTopOnPageChange?: boolean

  /**
   * 分页大小选项
   * @default [10, 20, 30, 50, 100]
   */
  pageSizeOptions?: number[]
}

import { ProTablePagination } from './pagination'

export function ProTable<TData, TValue>({
  columns,
  dataSource,
  request,
  toolBarRender,
  headerTitle,
  searchRender,
  rowSelection,
  onRowSelectionChange,
  rowKey = 'id',
  actionRef,
  defaultPageSize = 10,
  pagination: controlledPagination,
  onPaginationChange: controlledOnPaginationChange,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  className,
  scrollToTopOnPageChange = true,
  pageSizeOptions
}: ProTableProps<TData, TValue>) {
  // --- 状态管理 ---
  const [internalData, setInternalData] = React.useState<TData[]>([])
  const [loading, setLoading] = React.useState<boolean>(false)
  const [internalRowCount, setInternalRowCount] = React.useState<number>(0)

  const isLocal = !!dataSource
  const data = isLocal ? dataSource || [] : internalData
  const rowCount = isLocal ? dataSource?.length || 0 : internalRowCount

  // 分页、排序、筛选状态
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize
  })

  const pagination = controlledPagination ?? internalPagination
  const onPaginationChange = controlledOnPaginationChange ?? setInternalPagination

  const [internalSorting, setInternalSorting] = React.useState<SortingState>([])
  const sorting = controlledSorting ?? internalSorting
  const onSortingChange = controlledOnSortingChange ?? setInternalSorting

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})

  // Row Selection (如果外部没有传入，则使用内部状态，或者默认为空对象)
  const [internalRowSelection, setInternalRowSelection] = React.useState<RowSelectionState>({})
  const finalRowSelection = rowSelection ?? internalRowSelection
  const finalOnRowSelectionChange = onRowSelectionChange ?? setInternalRowSelection
  // 如果外部传入了 rowSelection 或 onRowSelectionChange，则启用选择功能，否则禁用
  const enableRowSelection = !!(rowSelection || onRowSelectionChange)

  // --- 核心逻辑：数据请求 ---
  const fetchData = React.useCallback(async () => {
    if (isLocal || !request) return

    setLoading(true)
    try {
      // 构造请求参数
      // 注意：React Table 的 pageIndex 从 0 开始，通常后端 API (如 Antd 规范) current 从 1 开始
      const params = {
        current: pagination.pageIndex + 1,
        pageSize: pagination.pageSize
      }

      const response = await request(params, sorting, columnFilters)

      if (response.success) {
        setInternalData(response.data)
        setInternalRowCount(response.total)
      }
    } catch (error) {
      console.error('ProDataTable Request Failed:', error)
      // 这里可以集成你的 Toast 组件提示错误
    } finally {
      setLoading(false)
    }
  }, [pagination.pageIndex, pagination.pageSize, sorting, columnFilters, request, isLocal])

  // 监听状态变化自动触发请求 (类似 Antd Pro Table 的行为)
  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  // 暴露方法给父组件
  React.useImperativeHandle(actionRef, () => ({
    reload: () => fetchData(),
    reset: () => {
      if (controlledOnPaginationChange) {
        // 如果是受控模式，调用回调重置
        controlledOnPaginationChange({ pageIndex: 0, pageSize: defaultPageSize })
      } else {
        setInternalPagination({ pageIndex: 0, pageSize: defaultPageSize })
      }
      if (controlledOnSortingChange) {
        controlledOnSortingChange([])
      } else {
        setInternalSorting([])
      }
      setColumnFilters([])
      // 注意：如果是受控模式，pagination 的更新可能还没生效，fetchData 可能会用旧的 pagination
      // 这里可能需要优化，但目前先保持简单，依赖 useEffect 自动触发
      setTimeout(() => fetchData(), 0)
    }
  }))

  // --- TanStack Table 初始化 ---
  const table = useReactTable({
    data,
    columns,
    pageCount: isLocal ? undefined : Math.ceil(rowCount / pagination.pageSize), // 服务端分页必须计算页数
    // 开启手动模式（服务端模式），这告诉 table 不要自己在前端做分页/排序/筛选
    manualPagination: !isLocal,
    manualSorting: !isLocal,
    manualFiltering: !isLocal,
    getPaginationRowModel: isLocal ? getPaginationRowModel() : undefined,
    getSortedRowModel: isLocal ? getSortedRowModel() : undefined,
    getFilteredRowModel: isLocal ? getFilteredRowModel() : undefined,

    // 行 ID
    getRowId: (row) => {
      if (typeof rowKey === 'function') {
        return rowKey(row)
      }
      return (row as any)[rowKey]
    },

    defaultColumn: {
      // 默认关闭排序，需在 ColumnDef 中显式开启 enableSorting: true
      enableSorting: false
    },

    onPaginationChange: onPaginationChange,
    onSortingChange: onSortingChange,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: finalOnRowSelectionChange,
    enableRowSelection: enableRowSelection,
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection: finalRowSelection
    },
    getCoreRowModel: getCoreRowModel()
  })

  // --- 渲染逻辑准备 ---
  const searchContent = searchRender ? searchRender() : null
  const toolBarContent = toolBarRender && typeof toolBarRender === 'function' ? toolBarRender() : null
  // 检查是否有任何工具栏内容需要显示
  const showToolbar = !!headerTitle || !!searchContent || !!toolBarContent
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!scrollToTopOnPageChange) return
    const el = rootRef.current
    if (!el) return
    let cur: HTMLElement | null = el
    let target: HTMLElement | null = null
    while (cur) {
      const style = window.getComputedStyle(cur)
      const canScroll = cur.scrollHeight > cur.clientHeight && /(auto|scroll)/.test(style.overflowY)
      if (canScroll) {
        target = cur
        break
      }
      cur = cur.parentElement
    }
    if (target) {
      target.scrollTo({ top: 0, behavior: 'auto' })
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [pagination.pageIndex, pagination.pageSize, scrollToTopOnPageChange])

  return (
    <div ref={rootRef} className={cn('space-y-4 w-full', className)}>
      {/* 1. 工具栏区域 */}
      {showToolbar && (
        <div className="flex flex-col gap-4">
          {searchContent && <div className="w-full">{searchContent}</div>}
          {(headerTitle || toolBarContent) && (
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              {headerTitle && <h3 className="text-lg font-medium">{headerTitle}</h3>}
              <div className="flex items-center gap-2">{toolBarContent}</div>
            </div>
          )}
        </div>
      )}

      {/* 2. 表格主体 */}
      <div className="rounded-md border relative">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <div
                          className={cn(
                            'flex items-center gap-2',
                            header.column.getCanSort() && 'cursor-pointer select-none'
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <div className="flex flex-col">
                              <ChevronUp
                                className={cn(
                                  'h-3 w-3 -mb-1',
                                  header.column.getIsSorted() === 'asc' ? 'text-primary' : 'text-muted-foreground/70'
                                )}
                              />
                              <ChevronDown
                                className={cn(
                                  'h-3 w-3',
                                  header.column.getIsSorted() === 'desc' ? 'text-primary' : 'text-muted-foreground/70'
                                )}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              // 首次加载或无数据刷新时的 Loading 骨架
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <div className="flex justify-center items-center text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading data...
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => {
                    const columnDef = cell.column.columnDef as ProColumnDef<TData, TValue>
                    const content = flexRender(columnDef.cell, cell.getContext())

                    if (columnDef.ellipsis || columnDef.copyable) {
                      const value = cell.getValue()
                      const displayValue =
                        typeof value === 'string' || typeof value === 'number' ? String(value) : undefined

                      return (
                        <TableCell
                          key={cell.id}
                          style={{ maxWidth: columnDef.size !== 150 ? columnDef.size : undefined }}
                        >
                          <div className="flex items-center gap-2 max-w-full">
                            {columnDef.copyable && displayValue && (
                              <Copy
                                className="h-3 w-3 cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigator.clipboard.writeText(displayValue)
                                  toast.success('已复制')
                                }}
                              />
                            )}
                            <div
                              className={cn('flex-1', columnDef.ellipsis && 'truncate')}
                              title={columnDef.ellipsis ? displayValue : undefined}
                            >
                              {content}
                            </div>
                          </div>
                        </TableCell>
                      )
                    }

                    return <TableCell key={cell.id}>{content}</TableCell>
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* 覆盖层 Loading (当有数据但正在刷新时显示) */}
        {loading && data.length > 0 && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* 3. 分页器 */}
      <ProTablePagination
        pageIndex={table.getState().pagination.pageIndex}
        pageSize={table.getState().pagination.pageSize}
        rowCount={rowCount}
        loading={loading}
        pageSizeOptions={pageSizeOptions}
        onChange={(pageIndex, pageSize) => {
          onPaginationChange({ pageIndex, pageSize })
        }}
      />
    </div>
  )
}
