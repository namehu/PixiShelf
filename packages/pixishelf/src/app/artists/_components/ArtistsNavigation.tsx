'use client'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArtistsQuery } from '@/types'
import { useCallback, useMemo, useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import PNav from '@/components/layout/PNav'
import { Search, ArrowUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 艺术家页面的导航和筛选组件
 */
const ArtistsNavigation = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 从 URL 读取初始状态，而不是使用内部的 useState
  const currentSearch = searchParams.get('search') || ''
  const currentSortBy = (searchParams.get('sortBy') as ArtistsQuery['sortBy']) || 'name_asc'

  // 本地搜索状态用于输入框
  const [searchValue, setSearchValue] = useState(currentSearch)
  const [isFocused, setIsFocused] = useState(false)

  // 同步 URL 参数变化到本地状态
  useEffect(() => {
    setSearchValue(currentSearch)
  }, [currentSearch])

  // 防抖处理搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const currentSearchInUrl = params.get('search') || ''

      // 如果搜索值与 URL 中的一致，则不进行导航
      if (searchValue === currentSearchInUrl) {
        return
      }

      if (searchValue) {
        params.set('search', searchValue)
      } else {
        params.delete('search')
      }
      router.replace(`${pathname}?${params.toString()}`)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchValue, searchParams, pathname, router])

  // 处理搜索输入变化
  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value)
  }, [])

  // 清空搜索
  const handleClearSearch = useCallback(() => {
    setSearchValue('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('search')
    router.replace(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  // 处理排序变化
  const handleSort = useCallback(
    (option: ArtistsQuery['sortBy']) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('sortBy', option!)
      router.replace(`${pathname}?${params.toString()}`)
    },
    [searchParams, pathname, router]
  )

  // 排序选项
  const sortOptions: { value: ArtistsQuery['sortBy']; label: string }[] = useMemo(
    () => [
      { value: 'name_asc', label: '名称 A-Z' },
      { value: 'name_desc', label: '名称 Z-A' },
      { value: 'artworks_desc', label: '作品数量 多-少' },
      { value: 'artworks_asc', label: '作品数量 少-多' }
    ],
    []
  )

  return (
    <PNav showUserMenu={false}>
      <div className="flex items-center gap-2 md:gap-3 w-full pr-2 md:pr-4">
        {/* 搜索框区域 */}
        <div
          className={cn(
            'relative transition-all duration-300 ease-in-out',
            isFocused ? 'flex-[100%] w-full' : 'flex-1'
          )}
        >
          <div className="relative group">
            <div
              className={cn(
                'absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200',
                isFocused ? 'text-primary' : 'text-gray-400'
              )}
            >
              <Search className="w-4.5 h-4.5" />
            </div>
            <Input
              type="text"
              placeholder="搜索艺术家..."
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className="w-full pl-10 pr-10 h-10 bg-gray-100/50 dark:bg-gray-900/50 border-transparent focus:bg-white dark:focus:bg-gray-900 focus:border-primary/20 focus:ring-4 focus:ring-primary/5 transition-all rounded-full text-[14px]"
            />
            {searchValue && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 排序选择器 */}
        <div
          className={cn(
            'flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden',
            isFocused ? 'w-0 opacity-0 scale-95 md:w-auto md:opacity-100 md:scale-100' : 'w-auto opacity-100 scale-100'
          )}
        >
          <Select value={currentSortBy} onValueChange={(value) => handleSort(value as ArtistsQuery['sortBy'])}>
            <SelectTrigger className="w-[120px] md:w-[160px] h-10 rounded-full border-transparent bg-gray-100/50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-900 focus:ring-4 focus:ring-gray-100 dark:focus:ring-gray-800 transition-all text-[13px] px-3">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300 overflow-hidden">
                <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <SelectValue className="truncate" />
              </div>
            </SelectTrigger>
            <SelectContent
              align="end"
              className="rounded-xl border-gray-100 dark:border-gray-800 shadow-xl min-w-[160px] p-1"
            >
              {sortOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value || ''}
                  className="rounded-lg cursor-pointer py-2 px-3 text-[13px] focus:bg-gray-50 dark:focus:bg-gray-800/50"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </PNav>
  )
}

export default ArtistsNavigation
