'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { SearchSuggestion, SuggestionsResponse } from '@/types'
import { Input } from './input'
import { useDebounce } from '@/hooks/useDebounce'
import { apiJson } from '@/lib/api'
import { cn } from '@/lib/utils'

// ============================================================================
// SearchBox 组件
// ============================================================================

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
  placeholder = '搜索作品、艺术家或标签...',
  onSearch,
  onSuggestionClick,
  mode = 'normal',
  className,
  disabled = false
}) => {
  const [inputValue, setInputValue] = useState(value)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(inputValue.trim(), 300)

  // 获取搜索建议
  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      try {
        setIsLoading(true)
        const url = new URL('/api/suggestions', window.location.origin)
        url.searchParams.set('q', query)
        url.searchParams.set('mode', mode)
        url.searchParams.set('limit', '8')

        const response = await apiJson<SuggestionsResponse>(url.toString())
        setSuggestions(response.suggestions || [])
        setShowSuggestions(true)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('Failed to fetch suggestions:', error)
        setSuggestions([])
        setShowSuggestions(false)
      } finally {
        setIsLoading(false)
      }
    },
    [mode]
  )

  // 防抖搜索
  useEffect(() => {
    if (isFocused && debouncedQuery) {
      fetchSuggestions(debouncedQuery)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }, [debouncedQuery, isFocused, fetchSuggestions])

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
    if (inputValue.trim().length >= 2) {
      setShowSuggestions(true)
    }
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
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        )
      case 'artwork':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )
      case 'tag':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        )
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
        <svg
          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
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

SearchBox.displayName = 'SearchBox'
