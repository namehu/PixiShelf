'use client'

import React from 'react'
import { SortOption } from '@pixishelf/shared'
import { cn } from '@/lib/utils'

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
  { value: 'images_asc', label: '图片数量 ↑' }
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
  const sizeClasses = {
    sm: 'h-8 px-2 text-xs',
    md: 'h-10 px-3 text-sm',
    lg: 'h-12 px-4 text-base'
  }

  const selectClasses = [
    'inline-flex',
    'items-center',
    'justify-between',
    'rounded-md',
    'border',
    'border-input',
    'bg-background',
    'font-medium',
    'transition-colors',
    'focus-visible:outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-ring',
    'focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed',
    'disabled:opacity-50',
    'hover:bg-accent',
    'hover:text-accent-foreground',
    sizeClasses[size]
  ]

  const currentOption = SORT_OPTIONS.find(option => option.value === value)

  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        disabled={disabled}
        className={cn(selectClasses, 'w-full appearance-none cursor-pointer pr-8')}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      
      {/* 下拉箭头 */}
      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
        <svg
          className="w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  )
}

export default SortControl