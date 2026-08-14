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
  OnChangeFn,
  ExpandedState,
  getExpandedRowModel
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Copy, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
  /**
   * 自定义复制内容；未提供时复制 accessor 的显示值
   */
  copyValue?: (row: TData) => string | null | undefined
  /**
   * 自定义表头 className
   */
  headerClassName?: string
  /**
   * 自定义单元格 className
   */
  cellClassName?: string
}

/**
 * 请求函数返回的数据结构
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

  /**
   * 展开行内容；提供后表格自动增加展开按钮列
   */
  renderExpandedRow?: (row: TData) => React.ReactNode

  /**
   * 控制某一行是否允许展开
   */
  getRowCanExpand?: (row: TData) => boolean
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
  pageSizeOptions,
  renderExpandedRow,
  getRowCanExpand
}: ProTableProps<TData, TValue>) {
  // --- 状态管理 ---
  const [internalData, setInternalData] = React.useState<TData[]>([])
  const [loading, setLoading] = React.useState<boolean>(false)
  const [requestError, setRequestError] = React.useState<string | null>(null)
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
  const [expanded, setExpanded] = React.useState<ExpandedState>({})

  // 行选择：外部未传入时使用内部状态，否则默认为空对象。
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
      setRequestError(null)
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
      } else {
        setRequestError('数据请求未成功，请检查筛选条件后重试。')
      }
    } catch (error) {
      console.error('ProDataTable Request Failed:', error)
      setRequestError('数据加载失败，请检查连接后重试。')
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

  const finalColumns = React.useMemo<ProColumnDef<TData, TValue>[]>(() => {
    if (!renderExpandedRow) return columns
    return [
      {
        id: '__expand',
        size: 44,
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={row.getToggleExpandedHandler()}
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={row.getIsExpanded() ? '收起预览' : '展开预览'}
            >
              {row.getIsExpanded() ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </Button>
          ) : null
      },
      ...columns
    ]
  }, [columns, renderExpandedRow])

  // --- TanStack Table 初始化 ---
  const table = useReactTable({
    data,
    columns: finalColumns,
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
    onExpandedChange: setExpanded,
    enableRowSelection: enableRowSelection,
    getRowCanExpand: (row) => Boolean(renderExpandedRow && (getRowCanExpand ? getRowCanExpand(row.original) : true)),
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection: finalRowSelection,
      expanded
    },
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: renderExpandedRow ? getExpandedRowModel() : undefined
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
    <div ref={rootRef} className={cn('flex w-full min-w-0 flex-col gap-4', className)}>
      {/* 1. 工具栏区域 */}
      {showToolbar && (
        <div className="flex flex-col gap-4">
          {searchContent && <div className="w-full">{searchContent}</div>}
          {(headerTitle || toolBarContent) && (
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              {headerTitle && <h2 className="text-lg font-medium">{headerTitle}</h2>}
              <div className="flex items-center gap-2">{toolBarContent}</div>
            </div>
          )}
        </div>
      )}

      {requestError && data.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>表格刷新失败</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{requestError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchData()}>
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 2. 表格主体 */}
      <div className="relative overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const columnDef = header.column.columnDef as ProColumnDef<TData, TValue>
                  return (
                    <TableHead
                      key={header.id}
                      className={columnDef.headerClassName}
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : header.column.getCanSort()
                              ? 'none'
                              : undefined
                      }
                    >
                      {header.isPlaceholder ? null : (
                        header.column.getCanSort() ? (
                          <button
                            type="button"
                            className="inline-flex min-h-8 max-w-full select-none items-center gap-2 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <div className="flex flex-col">
                              <ChevronUp
                                className={cn(
                                  '-mb-1 size-3',
                                  header.column.getIsSorted() === 'asc' ? 'text-primary' : 'text-muted-foreground/70'
                                )}
                                aria-hidden="true"
                              />
                              <ChevronDown
                                className={cn(
                                  'size-3',
                                  header.column.getIsSorted() === 'desc' ? 'text-primary' : 'text-muted-foreground/70'
                                )}
                                aria-hidden="true"
                              />
                            </div>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">{flexRender(header.column.columnDef.header, header.getContext())}</div>
                        )
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {requestError && data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-3" role="alert">
                    <div>
                      <p className="text-sm font-medium text-destructive">表格加载失败</p>
                      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{requestError}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => fetchData()}>
                      重新加载
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : loading && data.length === 0 ? (
              // 首次加载或无数据刷新时的 Loading 骨架
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="h-24 text-center">
                  <div className="flex justify-center items-center text-muted-foreground">
                    <Spinner className="mr-2" aria-hidden="true" /> 正在加载数据…
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => {
                      const columnDef = cell.column.columnDef as ProColumnDef<TData, TValue>
                      const content = flexRender(columnDef.cell, cell.getContext())

                      if (columnDef.ellipsis || columnDef.copyable) {
                        const value = cell.getValue()
                        const displayValue =
                          typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
                        const copyValue = columnDef.copyValue
                          ? columnDef.copyValue(row.original)
                          : displayValue

                        return (
                          <TableCell
                            key={cell.id}
                            className={columnDef.cellClassName}
                            style={{ maxWidth: columnDef.size !== 150 ? columnDef.size : undefined }}
                          >
                            <div className="flex items-center gap-2 max-w-full">
                              {columnDef.copyable && copyValue && (
                                <button
                                  type="button"
                                  className="inline-flex size-7 shrink-0 select-none items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                                  aria-label={`复制 ${copyValue}`}
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    try {
                                      await navigator.clipboard.writeText(copyValue)
                                      toast.success('已复制')
                                    } catch {
                                      toast.error('复制失败，请直接选择表格内容复制。')
                                    }
                                  }}
                                >
                                  <Copy className="size-3.5" aria-hidden="true" />
                                </button>
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

                      return (
                        <TableCell key={cell.id} className={columnDef.cellClassName}>
                          {content}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  {row.getIsExpanded() && renderExpandedRow && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={row.getVisibleCells().length} className="bg-muted/10 p-0">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={finalColumns.length} className="h-24 text-center">
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* 覆盖层 Loading (当有数据但正在刷新时显示) */}
        {loading && data.length > 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50" role="status">
            <Spinner className="size-6 text-primary" aria-label="正在刷新表格…" />
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
