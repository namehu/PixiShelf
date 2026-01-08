'use client'

import { useState, useEffect } from 'react'
import { SortOption, MediaTypeFilter } from '@/types'
import { Button } from '@/components/ui/button'
import { SSheet } from '@/components/shared/s-sheet'
import { SortControl } from '@/components/ui/SortControl'
import { MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui/MediaTypeFilter'

interface FilterSheetProps {
  open: boolean
  currentMediaType: MediaTypeFilter
  currentSortBy: SortOption
  onOpenChange: (open: boolean) => void
  onApply: (filters: { mediaType: MediaTypeFilter; sortBy: SortOption }) => void
}

export function FilterSheet(props: FilterSheetProps) {
  const { open, onOpenChange, currentMediaType, currentSortBy, onApply } = props

  const [localMediaType, setLocalMediaType] = useState<MediaTypeFilter>('all')
  const [localSortBy, setLocalSortBy] = useState<SortOption>('source_date_desc')

  // 当 Sheet 打开时，同步外部状态到本地
  useEffect(() => {
    if (open) {
      setLocalMediaType(currentMediaType)
      setLocalSortBy(currentSortBy)
    } else {
      handleReset()
    }
  }, [open, currentMediaType, currentSortBy])

  // 处理应用更改
  const handleApply = () => {
    onApply({
      mediaType: localMediaType,
      sortBy: localSortBy
    })
    onOpenChange(false)
  }

  function handleReset() {
    setLocalMediaType('all')
    setLocalSortBy('source_date_desc')
  }

  return (
    <SSheet
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      className="rounded-t-[20px] sm:max-w-md sm:rounded-none sm:side-right h-[85vh] sm:h-full"
      title="筛选与显示"
      description="调整选项以精确查找内容"
      footer={
        <div className="flex w-full gap-2 ">
          <Button variant="outline" className="flex-1" onClick={handleReset}>
            重置
          </Button>
          <Button className="flex-1" onClick={handleApply}>
            确定
          </Button>
        </div>
      }
    >
      {/* 5. 中间主要内容区域 (会自动处理滚动) */}
      <div className="space-y-8">
        {/* 排序控制 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">排序方式</h3>
          <SortControl value={localSortBy} onChange={setLocalSortBy} className="w-full" />
        </div>

        {/* 媒体类型 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">媒体类型</h3>
          <MediaTypeFilterComponent
            value={localMediaType}
            onChange={setLocalMediaType}
            className="w-full justify-start"
          />
        </div>
      </div>
    </SSheet>
  )
}
