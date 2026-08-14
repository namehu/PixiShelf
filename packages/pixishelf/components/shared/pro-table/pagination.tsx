'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Spinner } from '@/components/ui/spinner'

interface ProTablePaginationProps {
  pageIndex: number // 0-based
  pageSize: number
  rowCount: number
  onChange: (pageIndex: number, pageSize: number) => void
  loading?: boolean
  disabled?: boolean
  pageSizeOptions?: number[]
}

export function ProTablePagination({
  pageIndex,
  pageSize,
  rowCount,
  onChange,
  loading = false,
  disabled = false,
  pageSizeOptions = [10, 20, 30, 50, 100]
}: ProTablePaginationProps) {
  // Use media query to switch layouts
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Calculate total pages
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize))
  const currentPage = pageIndex + 1 // 1-based for display

  // Jumper state
  const [jumpPage, setJumpPage] = React.useState('')
  const [isJumpInvalid, setIsJumpInvalid] = React.useState(false)

  // Validate jumper input
  React.useEffect(() => {
    if (jumpPage === '') {
      setIsJumpInvalid(false)
      return
    }
    const page = parseInt(jumpPage, 10)
    setIsJumpInvalid(isNaN(page) || page < 1 || page > pageCount)
  }, [jumpPage, pageCount])

  // Handle page change wrapper
  const handlePageChange = (page: number) => {
    if (page < 1 || page > pageCount || page === currentPage || loading || disabled) return
    onChange(page - 1, pageSize) // Convert back to 0-based
  }

  // Handle page size change wrapper
  const handlePageSizeChange = (newSize: number) => {
    onChange(0, newSize) // Reset to first page on size change
  }

  // Handle jumper input
  const handleJump = () => {
    if (jumpPage === '') return

    const page = parseInt(jumpPage, 10)
    if (isNaN(page) || page < 1 || page > pageCount) {
      if (isMobile) {
        toast.error('页码超出范围')
      }
      return
    }
    handlePageChange(page)
    setJumpPage('')
  }

  const handleJumpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleJump()
      e.currentTarget.blur()
    }
  }

  // Hide if total <= 1 (Req 1.5, 2.4)
  if (pageCount <= 1) return null

  // --- Mobile Layout (≤ 768px) ---
  if (isMobile) {
    return (
      <div className="flex h-11 w-full items-center justify-between px-4 py-2">
        {/* Prev Button */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading || disabled}
          aria-label="上一页"
        >
          {loading ? <Spinner aria-hidden="true" /> : <ArrowLeft aria-hidden="true" />}
        </Button>

        {/* Center Info & Input */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">
            第 {currentPage} / {pageCount} 页
          </span>
          <Input
            type="number"
            inputMode="numeric"
            name="mobile-page-jump"
            autoComplete="off"
            aria-label={`跳转页码，范围 1 到 ${pageCount}`}
            min={1}
            max={pageCount}
            className="h-8 w-[60px] px-1 text-center"
            placeholder="页码"
            value={jumpPage}
            onChange={(e) => {
              const val = e.target.value.replace(/[^\d]/g, '')
              setJumpPage(val)
            }}
            onKeyDown={handleJumpKeyDown}
            disabled={loading || disabled}
          />
        </div>

        {/* Next Button */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= pageCount || loading || disabled}
          aria-label="下一页"
        >
          {loading ? <Spinner aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    )
  }

  // --- PC Layout ---
  const renderPageNumbers = () => {
    const items: (number | string)[] = []

    if (pageCount <= 7) {
      for (let i = 1; i <= pageCount; i++) items.push(i)
    } else {
      // 1 2 3 4 5 ... N
      if (currentPage < 5) {
        for (let i = 1; i <= 5; i++) items.push(i)
        items.push('…', pageCount)
      }
      // 1 ... N-4 N-3 N-2 N-1 N
      else if (currentPage >= pageCount - 3) {
        items.push(1, '…')
        for (let i = pageCount - 4; i <= pageCount; i++) items.push(i)
      }
      // 1 ... C-1 C C+1 ... N
      else {
        items.push(1, '…', currentPage - 1, currentPage, currentPage + 1, '…', pageCount)
      }
    }

    return items.map((item, index) => {
      if (item === '…') {
        return (
          <div key={`ellipsis-${index}`} className="flex size-8 items-center justify-center" aria-hidden="true">
            <MoreHorizontal className="text-muted-foreground" />
          </div>
        )
      }

      const page = item as number
      const isActive = page === currentPage

      return (
        <Button
          key={page}
          variant={isActive ? 'outline' : 'ghost'}
          size="icon"
          className={cn('size-8', isActive && 'border-primary text-primary hover:bg-background hover:text-primary')}
          onClick={() => handlePageChange(page)}
          disabled={loading || disabled}
          aria-label={`第 ${page} 页`}
          aria-current={isActive ? 'page' : undefined}
        >
          {loading && isActive ? <Spinner aria-hidden="true" /> : page}
        </Button>
      )
    })
  }

  return (
    <div className="flex w-full items-center justify-between px-2 py-2">
      {/* 1.4 Left: Total Count */}
      <div className="flex-1 text-sm text-muted-foreground">共 {rowCount} 项</div>

      {/* Right: Pagination Controls */}
      <div className="flex items-center gap-2 lg:gap-4">
        {/* Prev Button */}
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading || disabled}
          aria-label="上一页"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>

        {/* Page Numbers */}
        <div className="flex items-center gap-1">{renderPageNumbers()}</div>

        {/* Next Button */}
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= pageCount || loading || disabled}
          aria-label="下一页"
        >
          <ChevronRight aria-hidden="true" />
        </Button>

        {/* Page Size Selector */}
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => handlePageSizeChange(Number(value))}
          disabled={loading || disabled}
        >
          <SelectTrigger className="h-8 w-[100px]" aria-label="每页显示数量">
            <SelectValue placeholder={`${pageSize} 条/页`} />
          </SelectTrigger>
          <SelectContent side="top">
            <SelectGroup>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size} / 页
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* Jumper */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">跳至</span>
          <div className="relative group">
            <Input
              type="number"
              inputMode="numeric"
              name="desktop-page-jump"
              autoComplete="off"
              min={1}
              max={pageCount}
              aria-label={`跳转页码，范围 1 到 ${pageCount}`}
              aria-invalid={isJumpInvalid}
              aria-describedby={isJumpInvalid ? 'desktop-page-jump-error' : undefined}
              className={cn(
                'h-8 w-[60px] px-1 text-center',
                isJumpInvalid && 'border-destructive text-destructive focus-visible:ring-destructive'
              )}
              value={jumpPage}
              onChange={(e) => {
                const val = e.target.value.replace(/[^\d]/g, '')
                setJumpPage(val)
              }}
              onKeyDown={handleJumpKeyDown}
              disabled={loading || disabled}
            />
            {/* Tooltip for invalid input */}
            {isJumpInvalid && (
              <div
                id="desktop-page-jump-error"
                role="alert"
                className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground"
              >
                请输入 1-{pageCount}
              </div>
            )}
          </div>
          <span className="text-sm text-muted-foreground">页</span>
        </div>
      </div>
    </div>
  )
}
