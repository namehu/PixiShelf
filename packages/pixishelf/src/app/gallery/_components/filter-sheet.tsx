'use client'

import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { SortOption, MediaTypeFilter } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SSheet } from '@/components/shared/s-sheet'
import { SortControl } from '@/components/ui/SortControl'
import { MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui/MediaTypeFilter'

interface FilterSheetProps {
  open: boolean
  currentTags: string[]
  currentMediaType: MediaTypeFilter
  currentSortBy: SortOption
  onOpenChange: (open: boolean) => void
  onApply: (filters: { tags: string[]; mediaType: MediaTypeFilter; sortBy: SortOption }) => void
}

export function FilterSheet(props: FilterSheetProps) {
  const { open, onOpenChange, currentTags, currentMediaType, currentSortBy, onApply } = props

  const [localTags, setLocalTags] = useState<string[]>([])
  const [localMediaType, setLocalMediaType] = useState<MediaTypeFilter>('all')
  const [localSortBy, setLocalSortBy] = useState<SortOption>('source_date_desc')

  // 当 Sheet 打开时，同步外部状态到本地
  useEffect(() => {
    if (open) {
      setLocalTags(currentTags)
      setLocalMediaType(currentMediaType)
      setLocalSortBy(currentSortBy)
    } else {
      handleReset()
    }
  }, [open, currentTags, currentMediaType, currentSortBy])

  // 处理标签移除
  const handleRemoveTag = (tagToRemove: string) => {
    setLocalTags((prev) => prev.filter((tag) => tag !== tagToRemove))
  }

  // 处理清除所有标签
  const handleClearTags = () => {
    setLocalTags([])
  }

  // 处理应用更改
  const handleApply = () => {
    onApply({
      tags: localTags,
      mediaType: localMediaType,
      sortBy: localSortBy
    })
    onOpenChange(false)
  }

  function handleReset() {
    setLocalTags([])
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
        {/* 活跃的标签 (Tag Chips) */}
        {localTags.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">已选标签</h3>
            <div className="flex flex-wrap gap-2">
              {localTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="px-3 py-1 gap-1 hover:bg-red-50 hover:text-red-600 cursor-pointer transition-colors"
                  onClick={() => handleRemoveTag(tag)}
                >
                  #{tag}
                  <X className="w-3 h-3" />
                </Badge>
              ))}
              <Button variant="ghost" size="sm" className="h-6 text-xs text-neutral-400" onClick={handleClearTags}>
                清除标签
              </Button>
            </div>
          </div>
        )}

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
