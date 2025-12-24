'use client'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArtistsQuery } from '@/types'
import { useCallback, useMemo, useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import PNav from '@/components/layout/PNav'

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

  // 同步 URL 参数变化到本地状态
  useEffect(() => {
    setSearchValue(currentSearch)
  }, [currentSearch])

  // 防抖处理搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
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
    <PNav>
      <div className="flex flex-1 flex-col sm:flex-row gap-4 px-4">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="搜索艺术家..."
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="hidden sm:inline">
          <Select value={currentSortBy} onValueChange={(value) => handleSort(value as ArtistsQuery['sortBy'])}>
            <SelectTrigger className="w-fit min-w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value || ''}>
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
