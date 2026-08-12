'use client'

import { ImageOffIcon, SlidersHorizontal } from 'lucide-react'
import { useSafeBack } from '@/hooks/use-safe-back'

interface PageNoDataProps {
  hasActiveFilters?: boolean
  onAdjustFilters?: () => void
  onClearFilters?: () => void
}

export default function PageNoData({ hasActiveFilters, onAdjustFilters, onClearFilters }: PageNoDataProps) {
  const safeBack = useSafeBack()

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <div className="text-center text-white">
        <ImageOffIcon className="mx-auto mb-4 size-16 opacity-40" />
        <h2 className="mb-2 text-xl font-semibold">暂无图片</h2>
        <p className="mb-4 text-sm opacity-60">
          {hasActiveFilters ? '没有作品符合当前筛选条件' : '当前没有可浏览的图片内容'}
        </p>
        <div className="flex justify-center gap-2">
          {onAdjustFilters && (
            <button
              type="button"
              onClick={onAdjustFilters}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-black transition-colors hover:bg-gray-200"
            >
              <SlidersHorizontal className="size-4" />
              调整筛选
            </button>
          )}
          {hasActiveFilters && onClearFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-lg bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
            >
              清空筛选
            </button>
          ) : (
            <button
              type="button"
              onClick={safeBack}
              className="rounded-lg bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
            >
              返回
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
