'use client'

import * as React from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
  PaginationState,
  RowSelectionState,
  OnChangeFn
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCcw } from 'lucide-react'

// --- 类型定义 ---

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
   * @tanstack/react-table 的列定义
   */
  columns: ColumnDef<TData, TValue>[]

  /**
   * 获取数据的异步函数。
   * 组件会自动处理 loading 状态，你只需要返回 Promise<RequestData<T>>。
   * * @param params 包含分页参数 { pageSize, current } 以及其他自定义搜索参数
   * @param sort 当前的排序状态
   * @param filter 当前的筛选状态
   */
  request: (
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
  toolBarRender?: () => React.ReactNode

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
}

export function ProTable<TData, TValue>({
  columns,
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
  onPaginationChange: controlledOnPaginationChange
}: ProTableProps<TData, TValue>) {
  // --- 状态管理 ---
  const [data, setData] = React.useState<TData[]>([])
  const [loading, setLoading] = React.useState<boolean>(false)
  const [rowCount, setRowCount] = React.useState<number>(0)

  // 分页、排序、筛选状态
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize
  })

  const pagination = controlledPagination ?? internalPagination
  const onPaginationChange = controlledOnPaginationChange ?? setInternalPagination

  const [sorting, setSorting] = React.useState<SortingState>([])
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
        setData(response.data)
        setRowCount(response.total)
      }
    } catch (error) {
      console.error('ProDataTable Request Failed:', error)
      // 这里可以集成你的 Toast 组件提示错误
    } finally {
      setLoading(false)
    }
  }, [pagination.pageIndex, pagination.pageSize, sorting, columnFilters, request])

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
      setSorting([])
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
    pageCount: Math.ceil(rowCount / pagination.pageSize), // 服务端分页必须计算页数
    // 开启手动模式（服务端模式），这告诉 table 不要自己在前端做分页/排序/筛选
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,

    // 行 ID
    getRowId: (row) => {
      if (typeof rowKey === 'function') {
        return rowKey(row)
      }
      return (row as any)[rowKey]
    },

    onPaginationChange: onPaginationChange,
    onSortingChange: setSorting,
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

  return (
    <div className="space-y-4 w-full">
      {/* 1. 工具栏区域 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 w-full lg:flex-row lg:items-center lg:w-auto">
          {headerTitle && <h3 className="text-lg font-medium hidden lg:block">{headerTitle}</h3>}
          <div className="w-full lg:w-auto">{searchRender ? searchRender() : null}</div>
        </div>
        <div className="flex items-center gap-2 justify-between lg:justify-end w-full lg:w-auto">
          <div className="flex items-center gap-2">{toolBarRender && toolBarRender()}</div>
          {/* <Button
            variant="outline"
            size="icon"
            onClick={() => fetchData()}
            disabled={loading}
            className="h-8 w-8 shrink-0"
            title="Refresh"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button> */}
        </div>
      </div>

      {/* 2. 表格主体 */}
      <div className="rounded-md border relative">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
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
      <div className="flex items-center justify-between px-2">
        <div className="flex-1 text-sm text-muted-foreground">共 {rowCount} 项</div>
        <div className="flex items-center space-x-6 lg:space-x-8">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">每页显示</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 50, 100].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-[110px] items-center justify-center text-sm font-medium">
            第 {table.getState().pagination.pageIndex + 1} 页，共 {table.getPageCount() || 1} 页
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {'<'}
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {'>'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
