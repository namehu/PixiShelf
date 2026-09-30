'use client'

import React from 'react'
import { MediaTypeFilter as MediaTypeFilterType } from '@/types'
import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// ============================================================================
// MediaTypeFilter 组件
// ============================================================================

export interface MediaTypeFilterProps {
  /** 触发器 id，用于关联可见标签 */
  id?: string
  /** 触发器的可访问名称 */
  'aria-label'?: string
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
const MEDIA_TYPE_OPTIONS: { value: MediaTypeFilterType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'animation', label: '动图' },
  { value: 'video', label: '视频' }
]

/**
 * 媒体类型筛选控制组件
 */
export const MediaTypeFilter: React.FC<MediaTypeFilterProps> = ({
  id,
  'aria-label': ariaLabel,
  value,
  onChange,
  size = 'md',
  className,
  disabled = false
}) => {
  return (
    <ToggleGroup
      id={id}
      aria-label={ariaLabel ?? '媒体类型'}
      type="single"
      variant="outline"
      size={size === 'md' ? 'default' : size}
      value={value}
      onValueChange={(next) => {
        const option = MEDIA_TYPE_OPTIONS.find((item) => item.value === next)
        if (option) onChange(option.value)
      }}
      disabled={disabled}
      className={cn('grid w-full grid-cols-4', className)}
    >
      {MEDIA_TYPE_OPTIONS.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="min-h-11">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export default MediaTypeFilter
