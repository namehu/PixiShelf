'use client'

import React from 'react'
import { SortOption } from '@/types'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ============================================================================
// SortControl 组件
// ============================================================================

export interface SortControlProps {
  /** 当前排序值 */
  value: SortOption
  /** 排序变化回调 */
  onChange: (sortBy: SortOption) => void
  /** 组件尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 自定义类名 */
  className?: string
  /** 是否禁用 */
  disabled?: boolean
}

/**
 * 排序选项配置
 */
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'source_date_desc', label: '创建时间 ↓' },
  { value: 'source_date_asc', label: '创建时间 ↑' },
  { value: 'title_asc', label: '标题 A-Z' },
  { value: 'title_desc', label: '标题 Z-A' },
  { value: 'artist_asc', label: '艺术家 A-Z' },
  { value: 'artist_desc', label: '艺术家 Z-A' },
  { value: 'images_desc', label: '图片数量 ↓' },
  { value: 'images_asc', label: '图片数量 ↑' },
  { value: 'random', label: '随机排序' }
]

/**
 * 排序控制组件
 */
export const SortControl: React.FC<SortControlProps> = ({
  value,
  onChange,
  size = 'md',
  className,
  disabled = false
}) => {
  // 将自定义尺寸映射到 shadcn Select 的尺寸
  const selectSize = size === 'lg' ? 'default' : size === 'sm' ? 'sm' : 'default'

  const currentOption = SORT_OPTIONS.find((option) => option.value === value)

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn('w-fit min-w-[140px]', className)} size={selectSize}>
        <SelectValue>{currentOption?.label || '请选择排序'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default SortControl
