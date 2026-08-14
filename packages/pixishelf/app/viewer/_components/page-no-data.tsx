'use client'

import { ImageOffIcon, SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSafeBack } from '@/hooks/use-safe-back'

interface PageNoDataProps {
  hasActiveFilters?: boolean
  onAdjustFilters?: () => void
  onClearFilters?: () => void
}

export default function PageNoData({ hasActiveFilters, onAdjustFilters, onClearFilters }: PageNoDataProps) {
  const safeBack = useSafeBack()

  return (
    <div className="flex h-full w-full items-center justify-center bg-black px-6 text-white">
      <div className="max-w-sm text-center">
        <ImageOffIcon className="mx-auto mb-4 size-10 opacity-60" aria-hidden="true" />
        <h2 className="text-xl font-semibold">暂无可浏览作品</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">
          {hasActiveFilters ? '没有作品符合当前筛选条件。' : '当前收藏中没有可用于沉浸浏览的媒体。'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onAdjustFilters && (
            <Button variant="secondary" onClick={onAdjustFilters}>
              <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
              调整筛选
            </Button>
          )}
          {hasActiveFilters && onClearFilters ? (
            <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={onClearFilters}>
              清空筛选
            </Button>
          ) : (
            <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={safeBack}>
              返回
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
