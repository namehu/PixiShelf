'use client'

import React from 'react'
import { Tag, Hash, Eye } from 'lucide-react'
import { TagCardProps } from '@/types/tags'
import { cn } from '@/lib/utils'

/**
 * 标签卡片组件
 * 支持多种显示模式：紧凑、详细、最小化
 */
export function TagCard({
  tag,
  mode = 'compact',
  showCount = true,
  showDescription = true,
  onClick,
  className
}: TagCardProps) {
  const handleClick = () => {
    onClick?.(tag)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick()
    }
  }

  // 获取主要名称（用于较短的显示）
  const getPrimaryName = () => tag.name

  // 获取次要名称（用于分行显示）
  const getSecondaryName = () => tag.name_zh || ''

  // 根据模式渲染不同的卡片样式
  const renderCard = () => {
    switch (mode) {
      case 'minimal':
        return (
          <div
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
              'bg-blue-50 hover:bg-blue-100 border border-blue-200',
              'text-blue-700 text-sm font-medium',
              'transition-colors duration-200',
              onClick && 'cursor-pointer hover:shadow-sm',
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={onClick ? 0 : undefined}
            role={onClick ? 'button' : undefined}
          >
            <Hash className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{getPrimaryName()}</span>
            {showCount && <span className="text-blue-600 text-xs font-normal">{tag.artworkCount}</span>}
          </div>
        )

      case 'detailed':
        return (
          <div
            className={cn(
              'p-4 rounded-lg border border-gray-200 bg-white',
              'hover:border-blue-300 hover:shadow-md',
              'transition-all duration-200',
              onClick && 'cursor-pointer',
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={onClick ? 0 : undefined}
            role={onClick ? 'button' : undefined}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Tag className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">{getPrimaryName()}</h3>
                  {getSecondaryName() && <p className="text-sm text-gray-500 mb-1">{getSecondaryName()}</p>}
                  {tag.description && <p className="text-sm text-gray-600 line-clamp-2">{tag.description}</p>}
                </div>
              </div>
              {showCount && (
                <div className="flex items-center gap-1 text-gray-500 text-sm">
                  <Eye className="w-3 h-3" />
                  <span>{tag.artworkCount}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>创建于 {new Date(tag.createdAt).toLocaleDateString()}</span>
              {tag.artworkCount > 0 && <span className="text-blue-600 font-medium">{tag.artworkCount} 个作品</span>}
            </div>
          </div>
        )

      case 'compact':
      default:
        return (
          <div
            className={cn(
              'flex items-center justify-between p-3 rounded-lg',
              'bg-gray-50 hover:bg-gray-100 border border-gray-200',
              'hover:border-blue-300 transition-all duration-200',
              onClick && 'cursor-pointer hover:shadow-sm',
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={onClick ? 0 : undefined}
            role={onClick ? 'button' : undefined}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-1.5 rounded-md bg-blue-100 flex-shrink-0">
                <Tag className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{getPrimaryName()}</h3>
                {getSecondaryName() && <p className="text-gray-500 text-xs truncate mt-0.5">{getSecondaryName()}</p>}
                {showDescription && tag.description && (
                  <p className="text-gray-500 text-sm truncate mt-0.5">{tag.description}</p>
                )}
              </div>
            </div>

            {showCount && (
              <div className="flex items-center gap-1 text-gray-500 text-sm flex-shrink-0">
                <Eye className="w-3 h-3" />
                <span className="font-medium">{tag.artworkCount}</span>
              </div>
            )}
          </div>
        )
    }
  }

  return renderCard()
}

// 导出默认组件
export default TagCard
