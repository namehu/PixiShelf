'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ArrowUpDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { SSearch } from './s-search'
import { SPagination } from './s-pagination'
import { STableProps, STableRequestParams, STableResponse } from './types'

export * from './types'

export function STable<T extends Record<string, any>>({
  columns,
  request,
  rowKey,
  headerTitle,
  toolBarRender,
  mobileRender,
  defaultPageSize = 10,
  loading: externalLoading,
  className,
  rowSelection,
}: STableProps<T>) {
  // 状态管理
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  
  // 分页状态
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  
  // 搜索和排序状态
  const [searchParams, setSearchParams] = useState<Record<string, any>>({})
  const [sortParams, setSortParams] = useState<Record<string, 'asc' | 'desc'>>({})

  // 数据请求函数
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params: STableRequestParams = {
        current,
        pageSize,
        ...searchParams,
      }
      
      const response = await request(params, sortParams)
      
      if (response) {
        setData(response.data)
        setTotal(response.total)
      }
    } catch (error) {
      console.error('STable fetch data error:', error)
    } finally {
      setLoading(false)
    }
  }, [current, pageSize, searchParams, sortParams, request])

  // 监听依赖变化触发请求
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 处理搜索
  const handleSearch = (values: Record<string, any>) => {
    setSearchParams(values)
    setCurrent(1) // 重置到第一页
    // 清空选择
    if (rowSelection) {
      rowSelection.onChange([], [])
    }
  }

  // 处理重置
  const handleReset = () => {
    setSearchParams({})
    setSortParams({})
    setCurrent(1)
    if (rowSelection) {
      rowSelection.onChange([], [])
    }
  }

  // 处理排序
  const handleSort = (key: string) => {
    setSortParams((prev) => {
      const currentSort = prev[key]
      let nextSort: 'asc' | 'desc' | undefined

      if (!currentSort) nextSort = 'asc'
      else if (currentSort === 'asc') nextSort = 'desc'
      else nextSort = undefined

      // 目前只支持单列排序，如果需要多列可修改此处逻辑
      return nextSort ? { [key]: nextSort } : {}
    })
  }

  const isLoading = loading || externalLoading

  // 获取 RowKey
  const getRowKey = (record: T): string => {
    if (typeof rowKey === 'function') {
      return rowKey(record)
    }
    return record[rowKey] as string
  }

  // 行选择逻辑
  const handleSelectAll = (checked: boolean) => {
    if (!rowSelection) return

    if (checked) {
      const allKeys = data.map(getRowKey)
      rowSelection.onChange(allKeys, data)
    } else {
      rowSelection.onChange([], [])
    }
  }

  const handleSelectRow = (checked: boolean, record: T) => {
    if (!rowSelection) return

    const key = getRowKey(record)
    const selectedKeys = [...rowSelection.selectedRowKeys]
    
    if (checked) {
      selectedKeys.push(key)
    } else {
      const index = selectedKeys.indexOf(key)
      if (index > -1) {
        selectedKeys.splice(index, 1)
      }
    }

    // 计算新的选中行数据
    // 注意：这里只能获取当前页的选中行数据，如果需要跨页选择，需要上层业务处理数据缓存
    const selectedRows = data.filter(item => selectedKeys.includes(getRowKey(item)))
    rowSelection.onChange(selectedKeys, selectedRows)
  }

  const isAllSelected = data.length > 0 && data.every(item => rowSelection?.selectedRowKeys.includes(getRowKey(item)))
  const isIndeterminate = data.some(item => rowSelection?.selectedRowKeys.includes(getRowKey(item))) && !isAllSelected

  // 渲染移动端卡片列表
  const renderMobileList = () => {
    if (data.length === 0) {
      return <div className="p-8 text-center text-neutral-500">暂无数据</div>
    }

    return (
      <div className="space-y-4">
        {data.map((record, index) => {
          const key = getRowKey(record)
          const isSelected = rowSelection?.selectedRowKeys.includes(key)

          if (mobileRender) {
            return (
              <div key={key} className="relative">
                 {rowSelection && (
                  <div className="absolute top-4 right-4 z-10">
                     <Checkbox 
                      checked={isSelected}
                      onCheckedChange={(checked) => handleSelectRow(!!checked, record)}
                    />
                  </div>
                )}
                {mobileRender(record, index)}
              </div>
            )
          }

          // 默认移动端渲染：卡片式
          // 取第一个非隐藏列作为标题，其余作为内容
          const visibleColumns = columns.filter((col) => !col.hideInMobile && !col.hideInTable)
          const titleCol = visibleColumns[0]
          const contentCols = visibleColumns.slice(1)

          return (
            <div key={key} className={cn(
              "bg-white p-4 rounded-lg border space-y-3 transition-colors",
              isSelected ? "border-blue-500 bg-blue-50" : "border-neutral-200"
            )}>
              <div className="flex items-start justify-between gap-3">
                {titleCol && (
                  <div className="font-medium text-neutral-900 flex-1">
                    {titleCol.render 
                      ? titleCol.render(record[titleCol.dataIndex as keyof T], record, index)
                      : record[titleCol.dataIndex as keyof T]}
                  </div>
                )}
                {rowSelection && (
                   <Checkbox 
                    checked={isSelected}
                    onCheckedChange={(checked) => handleSelectRow(!!checked, record)}
                  />
                )}
              </div>
              
              <div className="space-y-2 text-sm border-t pt-2 mt-2">
                {contentCols.map((col) => (
                  <div key={col.key || col.dataIndex as string} className="flex justify-between">
                    <span className="text-neutral-500">{col.title}:</span>
                    <span className="text-neutral-900 text-right">
                      {col.render 
                        ? col.render(record[col.dataIndex as keyof T], record, index)
                        : record[col.dataIndex as keyof T]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn('w-full space-y-4', className)}>
      {/* 搜索区域 */}
      <SSearch 
        columns={columns} 
        onSearch={handleSearch} 
        onReset={handleReset} 
      />

      {/* 表格区域 */}
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        {/* 工具栏 */}
        {(headerTitle || toolBarRender || rowSelection) && (
          <div className="p-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              {headerTitle && <div className="font-medium text-lg">{headerTitle}</div>}
              {rowSelection && rowSelection.selectedRowKeys.length > 0 && (
                <div className="text-sm text-neutral-500 bg-blue-50 px-3 py-1 rounded-md border border-blue-100">
                  已选择 <span className="font-medium text-blue-600">{rowSelection.selectedRowKeys.length}</span> 项
                </div>
              )}
            </div>
            {toolBarRender && <div className="flex items-center gap-2 flex-wrap">{toolBarRender()}</div>}
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {rowSelection && (
                      <TableHead className="w-[50px]">
                        <Checkbox 
                          checked={isAllSelected}
                          // indeterminate={isIndeterminate} // shadcn checkbox 不支持 indeterminate prop，需要 ref 设置
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                        />
                      </TableHead>
                    )}
                    {columns.filter(col => !col.hideInTable).map((col) => (
                      <TableHead 
                        key={col.key || col.dataIndex as string}
                        style={{ width: col.width }}
                        className={col.className}
                      >
                        <div className="flex items-center gap-1">
                          {col.title}
                          {col.sorter && (
                            <ArrowUpDown 
                              className={cn(
                                "w-4 h-4 cursor-pointer hover:text-neutral-900 transition-colors",
                                sortParams[col.key || col.dataIndex as string] ? "text-blue-600" : "text-neutral-400"
                              )}
                              onClick={() => handleSort(col.key || col.dataIndex as string)}
                            />
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length > 0 ? (
                    data.map((record, index) => (
                      <TableRow key={getRowKey(record)}>
                        {rowSelection && (
                          <TableCell>
                            <Checkbox 
                              checked={rowSelection.selectedRowKeys.includes(getRowKey(record))}
                              onCheckedChange={(checked) => handleSelectRow(!!checked, record)}
                            />
                          </TableCell>
                        )}
                        {columns.filter(col => !col.hideInTable).map((col) => (
                          <TableCell key={col.key || col.dataIndex as string} className={col.className}>
                            {col.render 
                              ? col.render(record[col.dataIndex as keyof T], record, index)
                              : record[col.dataIndex as keyof T]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={columns.length + (rowSelection ? 1 : 0)} className="h-24 text-center">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile View */}
            <div className="md:hidden p-4">
              {renderMobileList()}
            </div>
          </>
        )}
      </div>

      {/* 分页区域 */}
      <SPagination
        current={current}
        pageSize={pageSize}
        total={total}
        onPageChange={setCurrent}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setCurrent(1)
        }}
      />
    </div>
  )
}
