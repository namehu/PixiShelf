'use client'

import React from 'react'
import { MediaTypeFilter as MediaTypeFilterType } from '@/types'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ============================================================================
// MediaTypeFilter 组件
// ============================================================================

export interface MediaTypeFilterProps {
  /** 当前媒体类型筛选值 */
  value: MediaTypeFilterType
  /** 媒体类型变化回调 */
  onChange: (mediaType: MediaTypeFilterType) => void
  /** 组件尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 自定义类名 */
  className?: string
  /** 是否禁用 */
  disabled?: boolean
}

/**
 * 媒体类型筛选选项配置
 */
const MEDIA_TYPE_OPTIONS: { value: MediaTypeFilterType; label: string; icon: string }[] = [
  { value: 'all', label: '全部类型', icon: '🎨' },
  { value: 'image', label: '仅图片', icon: '🖼️' },
  { value: 'video', label: '仅视频', icon: '🎬' }
]

/**
 * 媒体类型筛选控制组件
 */
export const MediaTypeFilter: React.FC<MediaTypeFilterProps> = ({
  value,
  onChange,
  size = 'md',
  className,
  disabled = false
}) => {
  // 将自定义尺寸映射到 shadcn Select 的尺寸
  const selectSize = size === 'lg' ? 'default' : size === 'sm' ? 'sm' : 'default'

  const currentOption = MEDIA_TYPE_OPTIONS.find((option) => option.value === value)

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn('w-fit min-w-[120px]', className)} size={selectSize}>
        <SelectValue>
          {currentOption ? (
            <span className="flex items-center gap-2">
              <span>{currentOption.icon}</span>
              <span>{currentOption.label}</span>
            </span>
          ) : (
            '请选择类型'
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {MEDIA_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                <span>{option.icon}</span>
                <span>{option.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export default MediaTypeFilter
