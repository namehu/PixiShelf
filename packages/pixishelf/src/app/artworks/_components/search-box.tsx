'use client'

import React, { useState, useEffect, useRef } from 'react'
import { SearchSuggestion } from '@/types'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { ImageIcon, SearchIcon, TagIcon, UserIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTRPC } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'

export interface SearchBoxProps {
  /** 搜索值 */
  value?: string
  /** 占位符文本 */
  placeholder?: string
  /** 搜索回调 */
  onSearch?: (query: string) => void
  /** 建议点击回调 */
  onSuggestionClick?: (suggestion: SearchSuggestion) => void
  /** 搜索模式 */
  mode?: 'normal' | 'tag'
  /** 自定义样式 */
  className?: string
  /** 是否禁用 */
  disabled?: boolean
}

/**
 * 搜索框组件，支持搜索建议
 */
export const SearchBox: React.FC<SearchBoxProps> = ({
  value = '',
  placeholder = '搜索作品、艺术家...',
  onSearch,
  onSuggestionClick,
  mode = 'normal',
  className,
  disabled = false
}) => {
  const [inputValue, setInputValue] = useState(value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(inputValue.trim(), 300)
  
  const trpc = useTRPC()

  const { data, isLoading } = useQuery({
    ...trpc.search.suggestions.queryOptions({
      q: debouncedQuery,
      mode,
      limit: 8
    }),
    enabled: !!debouncedQuery && debouncedQuery.length >= 2 && isFocused
  })

  const suggestions = data?.suggestions || []

  // 控制建议显示
  useEffect(() => {
    if (suggestions.length > 0 && isFocused) {
      setShowSuggestions(true)
    } else {
      setShowSuggestions(false)
    }
  }, [suggestions.length, isFocused])

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
  }

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        handleSearch()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          const suggestion = suggestions[selectedIndex]
          if (suggestion) {
            handleSuggestionClick(suggestion)
          }
        } else {
          handleSearch()
        }
        break
      case 'Escape':
        setShowSuggestions(false)
        setSelectedIndex(-1)
        inputRef.current?.blur()
        break
    }
  }

  // 处理搜索
  const handleSearch = () => {
    const query = inputValue.trim()
    if (query) {
      onSearch?.(query)
      setShowSuggestions(false)
      setSelectedIndex(-1)
    }
  }

  // 处理建议点击
  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    setInputValue(suggestion.value)
    setShowSuggestions(false)
    setSelectedIndex(-1)

    if (onSuggestionClick) {
      onSuggestionClick(suggestion)
    } else {
      onSearch?.(suggestion.value)
    }
  }

  // 处理焦点
  const handleFocus = () => {
    setIsFocused(true)
  }

  const handleBlur = () => {
    // 延迟隐藏建议，允许点击建议项
    setTimeout(() => {
      setIsFocused(false)
      setShowSuggestions(false)
      setSelectedIndex(-1)
    }, 200)
  }

  // 获取建议项图标
  const getSuggestionIcon = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'artist':
        return <UserIcon className="w-4 h-4" />
      case 'artwork':
        return <ImageIcon className="w-4 h-4" />
      case 'tag':
        return <TagIcon className="w-4 h-4" />
      default:
        return null
    }
  }

  // 获取建议项类型标签
  const getTypeLabel = (type: SearchSuggestion['type']) => {
    switch (type) {
      case 'artist':
        return '艺术家'
      case 'artwork':
        return '作品'
      case 'tag':
        return '标签'
      default:
        return ''
    }
  }

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={`pl-10 ${isLoading ? 'pr-10' : ''}`}
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <div className="w-4 h-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          </div>
        )}
      </div>

      {/* 搜索建议下拉列表 */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.type}-${suggestion.value}-${index}`}
              className={cn(
                'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors',
                'hover:bg-gray-50',
                selectedIndex === index && 'bg-blue-50 border-l-2 border-blue-500'
              )}
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {/* 图标 */}
              <div
                className={cn(
                  'flex-shrink-0 text-gray-400',
                  suggestion.type === 'artist' && 'text-blue-500',
                  suggestion.type === 'artwork' && 'text-green-500',
                  suggestion.type === 'tag' && 'text-purple-500'
                )}
              >
                {getSuggestionIcon(suggestion.type)}
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{suggestion.label}</span>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      suggestion.type === 'artist' && 'bg-blue-100 text-blue-700',
                      suggestion.type === 'artwork' && 'bg-green-100 text-green-700',
                      suggestion.type === 'tag' && 'bg-purple-100 text-purple-700'
                    )}
                  >
                    {getTypeLabel(suggestion.type)}
                  </span>
                </div>

                {/* 元数据 */}
                {suggestion.metadata && (
                  <div className="text-sm text-gray-500 mt-1">
                    {suggestion.metadata.artistName && <span>作者: {suggestion.metadata.artistName}</span>}
                    {suggestion.metadata.imageCount !== undefined && (
                      <span>{suggestion.metadata.imageCount} 张图片</span>
                    )}
                    {suggestion.metadata.artworkCount !== undefined && (
                      <span>{suggestion.metadata.artworkCount} 个作品</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
