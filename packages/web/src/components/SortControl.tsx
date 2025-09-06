import React from 'react'
import { SortOption } from '@pixishelf/shared'

/**
 * 排序选项定义
 */
interface SortOptionDefinition {
  value: SortOption
  label: string
  group: string
}

/**
 * 排序控件属性
 */
export interface SortControlProps {
  value: SortOption
  onChange: (sortBy: SortOption) => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * 所有可用的排序选项
 */
const sortOptions: SortOptionDefinition[] = [
  { value: 'source_date_desc', label: '创建时间 新-旧', group: '时间' },
  { value: 'source_date_asc', label: '创建时间 旧-新', group: '时间' },
  { value: 'title_asc', label: '名称 A-Z', group: '名称' },
  { value: 'title_desc', label: '名称 Z-A', group: '名称' },
  { value: 'artist_asc', label: '艺术家 A-Z', group: '名称' },
  { value: 'artist_desc', label: '艺术家 Z-A', group: '名称' },
  { value: 'images_desc', label: '图片数量 多-少', group: '数量' },
  { value: 'images_asc', label: '图片数量 少-多', group: '数量' }
]

/**
 * 按组分类排序选项
 */
const groupedOptions = sortOptions.reduce((groups, option) => {
  if (!groups[option.group]) {
    groups[option.group] = []
  }
  groups[option.group].push(option)
  return groups
}, {} as Record<string, SortOptionDefinition[]>)

/**
 * 排序控件组件
 */
export const SortControl: React.FC<SortControlProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
  size = 'md'
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  
  // 获取当前选中选项的标签
  const currentOption = sortOptions.find(option => option.value === value)
  const currentLabel = currentOption?.label || '创建时间 新-旧'
  
  // 处理选项点击
  const handleOptionClick = (sortBy: SortOption) => {
    onChange(sortBy)
    setIsOpen(false)
  }
  
  // 处理键盘事件
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        setIsOpen(!isOpen)
        break
      case 'Escape':
        setIsOpen(false)
        break
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
        }
        break
    }
  }
  
  // 点击外部关闭下拉菜单
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])
  
  // 尺寸样式
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3'
  }
  
  const iconSizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  }
  
  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`
          ${sizeClasses[size]}
          flex items-center justify-between gap-2
          bg-white border border-neutral-200 rounded-lg
          hover:border-neutral-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-200
          transition-colors duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isOpen ? 'border-primary-500 ring-2 ring-primary-200' : ''}
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="选择排序方式"
      >
        <span className="font-medium text-neutral-700 truncate">
          {currentLabel}
        </span>
        <svg
          className={`${iconSizeClasses[size]} text-neutral-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
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
      </button>
      
      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {Object.entries(groupedOptions).map(([groupName, options]) => (
            <div key={groupName} className="py-1">
              {/* 分组标题 */}
              <div className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide border-b border-neutral-100">
                {groupName}
              </div>
              
              {/* 分组选项 */}
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleOptionClick(option.value)}
                  className={`
                    w-full px-3 py-2 text-left text-sm
                    hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none
                    transition-colors duration-150
                    ${
                      option.value === value
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-neutral-700'
                    }
                  `}
                  role="option"
                  aria-selected={option.value === value}
                >
                  <div className="flex items-center justify-between">
                    <span>{option.label}</span>
                    {option.value === value && (
                      <svg
                        className="w-4 h-4 text-primary-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SortControl