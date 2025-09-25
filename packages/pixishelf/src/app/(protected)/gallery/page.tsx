'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { EnhancedArtworksResponse, SortOption, MediaTypeFilter } from '@/types'
import { useAuth } from '@/components'
import { SortControl, SearchBox, MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from '@/components/ui/pagination'
import { apiJson } from '@/lib/api'
import { ROUTES } from '@/lib/constants'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import PNav from '@/components/layout/PNav'

// ============================================================================
// 画廊页面
// ============================================================================

/**
 * 获取作品列表Hook
 */
function useArtworks(
  page: number,
  pageSize: number,
  tags?: string[],
  search?: string,
  sortBy?: SortOption,
  mediaType?: MediaTypeFilter
) {
  const [data, setData] = useState<EnhancedArtworksResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    const fetchArtworks = async () => {
      try {
        setIsLoading(true)
        setIsError(false)

        const url = new URL('/api/v1/artworks', window.location.origin)
        url.searchParams.set('page', String(page))
        url.searchParams.set('pageSize', String(pageSize))
        if (tags && tags.length > 0) {
          url.searchParams.set('tags', tags.join(','))
        }
        if (search && search.trim()) {
          url.searchParams.set('search', search.trim())
        }
        if (sortBy && sortBy !== 'source_date_desc') {
          url.searchParams.set('sortBy', sortBy)
        }
        if (mediaType && mediaType !== 'all') {
          url.searchParams.set('mediaType', mediaType)
        }

        const result = await apiJson<EnhancedArtworksResponse>(url.toString())
        setData(result)
      } catch (error) {
        console.error('Failed to fetch artworks:', error)
        setIsError(true)
      } finally {
        setIsLoading(false)
      }
    }

    fetchArtworks()
  }, [page, pageSize, tags, search, sortBy, mediaType])

  return { data, isLoading, isError }
}

/**
 * 获取扫描状态Hook
 */
function useScanStatus() {
  const [data, setData] = useState<{ scanning: boolean; message: string | null } | null>(null)

  useEffect(() => {
    const fetchScanStatus = async () => {
      try {
        const result = await apiJson<{ scanning: boolean; message: string | null }>('/api/v1/scan/status')
        setData(result)
      } catch (error) {
        console.error('Failed to fetch scan status:', error)
      }
    }

    fetchScanStatus()

    // 如果正在扫描，定期刷新状态
    const interval = setInterval(() => {
      if (data?.scanning) {
        fetchScanStatus()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [data?.scanning])

  return { data }
}

/**
 * 画廊页面内容组件
 */
function GalleryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()

  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = 24
  const [jumpToPage, setJumpToPage] = useState('')

  // 搜索和过滤状态
  const selectedTags = searchParams.get('tags')?.split(',').filter(Boolean) || []
  const searchQuery = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'
  const mediaType = (searchParams.get('mediaType') as MediaTypeFilter) || 'all'

  const { data, isLoading, isError } = useArtworks(
    page,
    pageSize,
    selectedTags.length > 0 ? selectedTags : undefined,
    searchQuery || undefined,
    sortBy,
    mediaType
  )

  const scanStatus = useScanStatus()

  // 检查认证状态
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`${ROUTES.LOGIN}?redirect=/gallery`)
    }
  }, [isAuthenticated, authLoading, router])

  // 如果正在加载认证状态，显示加载页面
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  // 如果未认证，不渲染内容（会被重定向）
  if (!isAuthenticated) {
    return null
  }

  const goto = (p: number) => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.set('page', String(p))
    router.push(`/gallery?${newParams.toString()}`)
  }

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage, 10)
    const totalPages = data ? Math.ceil(data.total / pageSize) : 1
    if (pageNum >= 1 && pageNum <= totalPages) {
      goto(pageNum)
      setJumpToPage('')
    }
  }

  const handleJumpInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJumpToPage()
    }
  }

  const removeTag = (tagToRemove: string) => {
    const newParams = new URLSearchParams(searchParams.toString())
    const newTags = selectedTags.filter((tag) => tag !== tagToRemove)
    if (newTags.length > 0) {
      newParams.set('tags', newTags.join(','))
    } else {
      newParams.delete('tags')
    }
    newParams.set('page', '1') // 重置到第一页
    router.push(`/gallery?${newParams.toString()}`)
  }

  const clearSearch = () => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete('search')
    newParams.set('page', '1')
    router.push(`/gallery?${newParams.toString()}`)
  }

  const clearAllFilters = () => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete('search')
    newParams.delete('tags')
    newParams.delete('mediaType')
    newParams.set('page', '1')
    router.push(`/gallery?${newParams.toString()}`)
  }

  const handleSortChange = (newSortBy: SortOption) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (newSortBy === 'source_date_desc') {
      newParams.delete('sortBy') // 默认值不需要在URL中
    } else {
      newParams.set('sortBy', newSortBy)
    }
    newParams.set('page', '1') // 重置到第一页
    router.push(`/gallery?${newParams.toString()}`)
  }

  const handleMediaTypeChange = (newMediaType: MediaTypeFilter) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (newMediaType === 'all') {
      newParams.delete('mediaType') // 默认值不需要在URL中
    } else {
      newParams.set('mediaType', newMediaType)
    }
    newParams.set('page', '1') // 重置到第一页
    router.push(`/gallery?${newParams.toString()}`)
  }

  const handleSearch = (query: string) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (query.trim()) {
      newParams.set('search', query.trim())
    } else {
      newParams.delete('search')
    }
    newParams.set('page', '1') // 重置到第一页
    router.push(`/gallery?${newParams.toString()}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PNav></PNav>
      <div className="max-w-7xl mx-auto  p-4">
        <section className="space-y-8">
          {/* Header Section */}
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-neutral-900">画廊</h1>
                <p className="text-neutral-600 mt-1">探索你的艺术收藏</p>
              </div>
              {scanStatus.data?.scanning && (
                <div className="flex items-center gap-2 text-sm text-neutral-600 bg-primary-50 px-3 py-2 rounded-lg border border-primary-200">
                  <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
                  扫描中：{scanStatus.data.message || '处理中...'}
                </div>
              )}
            </div>

            {/* Search Box */}
            <div className="max-w-md">
              <SearchBox
                value={searchQuery}
                placeholder="搜索作品、艺术家或标签...."
                onSearch={handleSearch}
                mode="normal"
              />
            </div>
          </div>

          {/* Active Search and Filters Section */}
          {(searchQuery || selectedTags.length > 0 || mediaType !== 'all') && (
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.414A1 1 0 013 6.707V4z"
                      />
                    </svg>
                    <span className="text-sm font-medium text-neutral-700">活跃筛选</span>
                  </div>
                  {(searchQuery || selectedTags.length > 0 || mediaType !== 'all') && (
                    <button
                      onClick={clearAllFilters}
                      className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
                    >
                      清除全部
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* Media Type Filter */}
                  {mediaType !== 'all' && (
                    <span
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-medium group cursor-pointer transition-all hover:bg-blue-100"
                      onClick={() => handleMediaTypeChange('all')}
                    >
                      {mediaType === 'video' ? '🎬' : '🖼️'}
                      类型: {mediaType === 'video' ? '仅视频' : '仅图片'}
                      <svg
                        className="w-3 h-3 ml-1 opacity-60 group-hover:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}

                  {/* Search Query */}
                  {searchQuery && (
                    <span
                      className="inline-flex items-center gap-1 px-3 py-1 bg-accent-50 text-accent-700 border border-accent-200 rounded-full text-xs font-medium group cursor-pointer transition-all hover:bg-accent-100"
                      onClick={clearSearch}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                      搜索: "{searchQuery}"
                      <svg
                        className="w-3 h-3 ml-1 opacity-60 group-hover:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}

                  {/* Tag Filters */}
                  {selectedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-full text-xs font-medium group cursor-pointer transition-all hover:bg-primary-100"
                      onClick={() => removeTag(tag)}
                    >
                      #{tag}
                      <svg
                        className="w-3 h-3 ml-1 opacity-60 group-hover:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {Array.from({ length: pageSize }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <div className="aspect-[3/4] bg-gray-200 rounded-2xl animate-pulse" />
                    <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-gray-200 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-50 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">加载失败</h3>
              <p className="text-neutral-600 mb-4">无法加载画廊内容，请检查网络连接或确认已登录。</p>
              <button
                onClick={() => window.location.reload()}
                className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
              >
                重新加载
              </button>
            </div>
          )}

          {/* Content */}
          {data && (
            <div className="space-y-6">
              {/* Stats and Sort Control */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-lg font-semibold text-neutral-900">{data.total.toLocaleString()} 个作品</span>
                  </div>
                  {(searchQuery || selectedTags.length > 0 || mediaType !== 'all') && (
                    <div className="text-sm text-neutral-600">
                      {(() => {
                        const filters = []
                        if (searchQuery) filters.push(`搜索 "${searchQuery}"`)
                        if (selectedTags.length > 0)
                          filters.push(`标签: ${selectedTags.map((t) => `#${t}`).join(', ')}`)
                        if (mediaType !== 'all') filters.push(`类型: ${mediaType === 'video' ? '仅视频' : '仅图片'}`)
                        return filters.join(' | ')
                      })()}
                    </div>
                  )}
                </div>

                {/* Filter and Sort Controls */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">媒体类型:</span>
                    <MediaTypeFilterComponent
                      value={mediaType}
                      onChange={handleMediaTypeChange}
                      size="sm"
                      className="min-w-[120px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">排序方式:</span>
                    <SortControl value={sortBy} onChange={handleSortChange} size="sm" className="min-w-[140px]" />
                  </div>
                </div>
              </div>

              {/* Artwork Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {data.items.map((aw) => {
                  return <ArtworkCard key={aw.id} artwork={aw} />
                })}
              </div>

              {/* Pagination */}
              {data.total > pageSize &&
                (() => {
                  const totalPages = Math.ceil(data.total / pageSize)

                  // 生成页码数组
                  const generatePageNumbers = () => {
                    const pages = []
                    const showPages = 5
                    let start = Math.max(1, page - Math.floor(showPages / 2))
                    const end = Math.min(totalPages, start + showPages - 1)

                    if (end - start + 1 < showPages) {
                      start = Math.max(1, end - showPages + 1)
                    }

                    // 显示第一页
                    if (start > 1) {
                      pages.push(1)
                      if (start > 2) {
                        pages.push('ellipsis-start')
                      }
                    }

                    // 显示页码范围
                    for (let i = start; i <= end; i++) {
                      pages.push(i)
                    }

                    // 显示最后一页
                    if (end < totalPages) {
                      if (end < totalPages - 1) {
                        pages.push('ellipsis-end')
                      }
                      pages.push(totalPages)
                    }

                    return pages
                  }

                  const pageNumbers = generatePageNumbers()

                  return (
                    <div className="bg-white rounded-2xl shadow-sm p-6">
                      <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
                        {/* Stats */}
                        <div className="text-sm text-neutral-600">
                          显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.total)} 项， 共{' '}
                          {data.total.toLocaleString()} 项
                        </div>

                        {/* Pagination Controls */}
                        <div className="flex flex-col sm:flex-row items-center gap-4">
                          {/* Pagination Component */}
                          <Pagination>
                            <PaginationContent>
                              {/* Previous Page */}
                              <PaginationItem>
                                <PaginationPrevious
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    if (page > 1) goto(page - 1)
                                  }}
                                  className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                                ></PaginationPrevious>
                              </PaginationItem>

                              {/* Page Numbers */}
                              {pageNumbers.map((pageNum, index) => (
                                <PaginationItem key={`${pageNum}-${index}`}>
                                  {pageNum === 'ellipsis-start' || pageNum === 'ellipsis-end' ? (
                                    <PaginationEllipsis />
                                  ) : (
                                    <PaginationLink
                                      href="#"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        goto(pageNum as number)
                                      }}
                                      isActive={pageNum === page}
                                    >
                                      {pageNum}
                                    </PaginationLink>
                                  )}
                                </PaginationItem>
                              ))}

                              {/* Next Page */}
                              <PaginationItem>
                                <PaginationNext
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    if (page < totalPages) goto(page + 1)
                                  }}
                                  className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                                ></PaginationNext>
                              </PaginationItem>
                            </PaginationContent>
                          </Pagination>

                          {/* Jump to Page */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-neutral-600 whitespace-nowrap">跳转到</span>
                            <input
                              type="number"
                              min="1"
                              max={totalPages}
                              value={jumpToPage}
                              onChange={(e) => setJumpToPage(e.target.value)}
                              onKeyDown={handleJumpInputKeyDown}
                              className="w-16 h-9 px-2 text-sm border border-neutral-300 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                              placeholder={String(page)}
                            />
                            <button
                              onClick={handleJumpToPage}
                              disabled={
                                !jumpToPage || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages
                              }
                              className="h-9 px-3 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                            >
                              跳转
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * 画廊页面组件（带Suspense边界）
 */
export default function GalleryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      }
    >
      <GalleryPageContent />
    </Suspense>
  )
}
