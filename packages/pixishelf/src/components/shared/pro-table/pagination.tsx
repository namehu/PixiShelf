'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal, Loader2, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useMediaQuery } from '@/hooks/use-media-query'

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
      <div className="flex w-full h-11 items-center justify-between px-4 py-2 select-none">
        {/* Prev Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading || disabled}
          className="h-8 w-8"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
        </Button>

        {/* Center Info & Input */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">
            第 {currentPage} / {pageCount} 页
          </span>
          <Input
            type="text"
            className="h-8 w-[60px] text-center px-1"
            placeholder="Go"
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
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= pageCount || loading || disabled}
          className="h-8 w-8"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
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
        items.push('...', pageCount)
      }
      // 1 ... N-4 N-3 N-2 N-1 N
      else if (currentPage >= pageCount - 3) {
        items.push(1, '...')
        for (let i = pageCount - 4; i <= pageCount; i++) items.push(i)
      }
      // 1 ... C-1 C C+1 ... N
      else {
        items.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', pageCount)
      }
    }

    return items.map((item, index) => {
      if (item === '...') {
        return (
          <div key={`ellipsis-${index}`} className="flex h-8 w-8 items-center justify-center">
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
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
          className={cn('h-8 w-8', isActive && 'border-primary text-primary hover:bg-background hover:text-primary')}
          onClick={() => handlePageChange(page)}
          disabled={loading || disabled}
        >
          {loading && isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : page}
        </Button>
      )
    })
  }

  return (
    <div className="flex items-center justify-between px-2 py-2 select-none w-full">
      {/* 1.4 Left: Total Count */}
      <div className="flex-1 text-sm text-muted-foreground">共 {rowCount} 项</div>

      {/* Right: Pagination Controls */}
      <div className="flex items-center space-x-2 lg:space-x-4">
        {/* Prev Button */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1 || loading || disabled}
          aria-label="Previous Page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Page Numbers */}
        <div className="flex items-center space-x-1">{renderPageNumbers()}</div>

        {/* Next Button */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= pageCount || loading || disabled}
          aria-label="Next Page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Page Size Selector */}
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => handlePageSizeChange(Number(value))}
          disabled={loading || disabled}
        >
          <SelectTrigger className="h-8 w-[100px]">
            <SelectValue placeholder={`${pageSize} 条/页`} />
          </SelectTrigger>
          <SelectContent side="top">
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={`${size}`}>
                {size} / 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Jumper */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">跳至</span>
          <div className="relative group">
            <Input
              type="text"
              className={cn(
                'h-8 w-[60px] px-1 text-center',
                isJumpInvalid && 'border-red-500 focus-visible:ring-red-500 text-red-500'
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
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded whitespace-nowrap">
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
