'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SPaginationProps {
  current: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/**
 * 通用分页组件
 * 
 * 基于原 TagPagination 改造，支持响应式布局
 */
export function SPagination({ 
  current, 
  pageSize, 
  total, 
  onPageChange, 
  onPageSizeChange 
}: SPaginationProps) {
  const totalPages = Math.ceil(total / pageSize)

  // 生成页码数组
  const generatePageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisiblePages = 7

    if (totalPages <= maxVisiblePages) {
      // 如果总页数小于等于最大显示页数，显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // 复杂的分页逻辑
      if (current <= 4) {
        // 当前页在前面
        for (let i = 1; i <= 5; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (current >= totalPages - 3) {
        // 当前页在后面
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        // 当前页在中间
        pages.push(1)
        pages.push('...')
        for (let i = current - 1; i <= current + 1; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  const pageNumbers = generatePageNumbers()
  const startItem = (current - 1) * pageSize + 1
  const endItem = Math.min(current * pageSize, total)

  if (totalPages <= 0) {
    return null
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* 显示信息 */}
        <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4">
          {/* Mobile Info */}
          <div className="md:hidden text-sm text-neutral-600">
            第 {current} / {totalPages} 页 · 共 {total} 条
          </div>

          {/* Desktop Info */}
          <div className="hidden md:block text-sm text-neutral-600">
            显示 {startItem} - {endItem} 条，共 {total} 条
          </div>

          {/* 每页显示数量选择 - Desktop only */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-sm text-neutral-600">每页显示</span>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-neutral-600">条</span>
          </div>
        </div>

        {/* 分页控件 */}
        <div className="flex items-center justify-between w-full md:w-auto gap-2">
          {/* 首页 - Desktop only */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={current === 1}
            className="p-2 hidden md:flex"
          >
            <ChevronsLeft className="w-4 h-4" />
          </Button>

          {/* 上一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(current - 1)}
            disabled={current === 1}
            className="p-2 flex-1 md:flex-none"
          >
            <ChevronLeft className="w-4 h-4 md:mr-0 mr-1" />
            <span className="md:hidden">上一页</span>
          </Button>

          {/* 页码 - Desktop only */}
          <div className="hidden md:flex items-center gap-1">
            {pageNumbers.map((page, index) => (
              <React.Fragment key={index}>
                {page === '...' ? (
                  <span className="px-3 py-2 text-neutral-400">...</span>
                ) : (
                  <Button
                    variant={current === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPageChange(page as number)}
                    className={`min-w-[40px] ${
                      current === page
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {page}
                  </Button>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* 下一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(current + 1)}
            disabled={current === totalPages}
            className="p-2 flex-1 md:flex-none"
          >
            <span className="md:hidden">下一页</span>
            <ChevronRight className="w-4 h-4 md:ml-0 ml-1" />
          </Button>

          {/* 末页 - Desktop only */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={current === totalPages}
            className="p-2 hidden md:flex"
          >
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
