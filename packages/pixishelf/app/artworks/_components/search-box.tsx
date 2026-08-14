'use client'

import React, { useState, useEffect, useRef } from 'react'
import type { SearchSuggestion } from '@/schemas/search.dto'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'
import { ImageIcon, SearchIcon, TagIcon, UserIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'

export interface SearchBoxProps {
  /** 搜索值 */
  value?: string
  /** 占位符文本 */
  placeholder?: string
  /** 搜索回调 */
  onSearch?: (query: string) => void
  /** 输入值变化回调 */
  onValueChange?: (value: string) => void
  /** 建议点击回调 */
  onSuggestionClick?: (suggestion: SearchSuggestion) => void
  /** 搜索模式 */
  mode?: 'normal' | 'tag'
  /** 自定义样式 */
  className?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 输入框 id，用于关联可见标签 */
  inputId?: string
  /** 输入框名称 */
  inputName?: string
  /** 输入框的可访问名称 */
  ariaLabel?: string
}

/**
 * 搜索框组件，支持搜索建议
 */
export const SearchBox: React.FC<SearchBoxProps> = ({
  value = '',
  placeholder = '搜索作品、艺术家...',
  onSearch,
  onValueChange,
  onSuggestionClick,
  mode = 'normal',
  className,
  disabled = false,
  inputId,
  inputName = 'artwork-search',
  ariaLabel = '搜索作品、艺术家或标签'
}) => {
  const [inputValue, setInputValue] = useState(value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLUListElement>(null)
  const suggestionsId = React.useId()
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

  useEffect(() => {
    setInputValue(value)
  }, [value])

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
    onValueChange?.(newValue)
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
    onSearch?.(query)
    setShowSuggestions(false)
    setSelectedIndex(-1)
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
          id={inputId}
          name={inputName}
          autoComplete="off"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={showSuggestions && suggestions.length > 0}
          aria-controls={suggestionsId}
          aria-activedescendant={selectedIndex >= 0 ? `${suggestionsId}-${selectedIndex}` : undefined}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={cn('pl-10', isLoading && 'pr-10')}
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <Spinner className="size-4 text-muted-foreground" aria-label="正在加载搜索建议" />
          </div>
        )}
      </div>

      {/* 搜索建议下拉列表 */}
      {showSuggestions && suggestions.length > 0 && (
        <ul
          id={suggestionsId}
          ref={suggestionsRef}
          role="listbox"
          aria-label="搜索建议"
          className="absolute top-full left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.type}-${suggestion.value}-${index}`} role="presentation">
              <button
                id={`${suggestionsId}-${index}`}
                type="button"
                role="option"
                aria-selected={selectedIndex === index}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent',
                  selectedIndex === index && 'border-primary bg-accent'
                )}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {/* 图标 */}
                <div className="flex-shrink-0 text-primary">{getSuggestionIcon(suggestion.type)}</div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{suggestion.label}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {getTypeLabel(suggestion.type)}
                    </span>
                  </div>

                  {/* 元数据 */}
                  {suggestion.metadata && (
                    <div className="mt-1 text-sm text-muted-foreground">
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
