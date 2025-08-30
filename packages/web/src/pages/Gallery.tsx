import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../api'
import { EnhancedArtworksResponse, SortOption, getMediaType, isVideoFile } from '@pixishelf/shared'
import SortControl from '../components/SortControl'
import VideoPreview from '../components/VideoPreview'

function useArtworks(page: number, pageSize: number, tags?: string[], search?: string, sortBy?: SortOption) {
  return useQuery({
    queryKey: ['artworks', page, pageSize, tags, search, sortBy],
    queryFn: async (): Promise<EnhancedArtworksResponse> => {
      const url = new URL('/api/v1/artworks', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', String(pageSize))
      if (tags && tags.length > 0) {
        url.searchParams.set('tags', tags.join(','))
      }
      if (search && search.trim()) {
        url.searchParams.set('search', search.trim())
      }
      if (sortBy && sortBy !== 'newest') {
        url.searchParams.set('sortBy', sortBy)
      }
      return apiJson<EnhancedArtworksResponse>(url.toString())
    }
  })
}

function useScanStatus() {
  return useQuery({
    queryKey: ['scanStatus'],
    queryFn: async () => {
      return apiJson<{ scanning: boolean; message: string | null }>('/api/v1/scan/status')
    },
    refetchInterval: (q) => {
      const data = q.state.data as any
      return data?.scanning ? 1000 : false
    }
  })
}

export default function Gallery() {
  const [sp, setSp] = useSearchParams()
  const page = parseInt(sp.get('page') || '1', 10)
  const pageSize = 24
  const [jumpToPage, setJumpToPage] = useState('')

  // 搜索和过滤状态
  const selectedTags = sp.get('tags')?.split(',').filter(Boolean) || []
  const searchQuery = sp.get('search') || ''
  const sortBy = (sp.get('sortBy') as SortOption) || 'newest'

  const { data, isLoading, isError } = useArtworks(
    page,
    pageSize,
    selectedTags.length > 0 ? selectedTags : undefined,
    searchQuery || undefined,
    sortBy
  )

  const scanStatus = useScanStatus()

  const goto = (p: number) => {
    const newSp = new URLSearchParams(sp)
    newSp.set('page', String(p))
    setSp(newSp)
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
    const newSp = new URLSearchParams(sp)
    const newTags = selectedTags.filter((tag) => tag !== tagToRemove)
    if (newTags.length > 0) {
      newSp.set('tags', newTags.join(','))
    } else {
      newSp.delete('tags')
    }
    newSp.set('page', '1') // 重置到第一页
    setSp(newSp)
  }

  const clearSearch = () => {
    const newSp = new URLSearchParams(sp)
    newSp.delete('search')
    newSp.set('page', '1')
    setSp(newSp)
  }

  const clearAllFilters = () => {
    const newSp = new URLSearchParams(sp)
    newSp.delete('search')
    newSp.delete('tags')
    newSp.set('page', '1')
    setSp(newSp)
  }

  const handleSortChange = (newSortBy: SortOption) => {
    const newSp = new URLSearchParams(sp)
    if (newSortBy === 'newest') {
      newSp.delete('sortBy') // 默认值不需要在URL中
    } else {
      newSp.set('sortBy', newSortBy)
    }
    newSp.set('page', '1') // 重置到第一页
    setSp(newSp)
  }

  return (
    <section className="space-y-8">
      {/* Header Section */}
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

      {/* Active Search and Filters Section */}
      {(searchQuery || selectedTags.length > 0) && (
        <div className="card p-4">
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
              {(searchQuery || selectedTags.length > 0) && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  清除全部
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
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
                  className="tag tag-primary group cursor-pointer transition-all hover:bg-primary-100"
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
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-4 w-24" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {Array.from({ length: pageSize }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-[3/4] skeleton rounded-2xl" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="card p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-error-50 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-error-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <button onClick={() => window.location.reload()} className="btn-primary">
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
              {(searchQuery || selectedTags.length > 0) && (
                <div className="text-sm text-neutral-600">
                  {searchQuery && selectedTags.length > 0
                    ? `搜索 "${searchQuery}" 并筛选标签: ${selectedTags.map((t) => `#${t}`).join(', ')}`
                    : searchQuery
                      ? `搜索结果: "${searchQuery}"`
                      : `筛选结果: ${selectedTags.map((t) => `#${t}`).join(', ')}`}
                </div>
              )}
            </div>

            {/* Sort Control */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">排序方式:</span>
              <SortControl value={sortBy} onChange={handleSortChange} size="sm" className="min-w-[140px]" />
            </div>
          </div>

          {/* Artwork Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {data.items.map((aw) => {
              const id = aw.id
              const cover = aw.images?.[0]
              const src = cover ? `/api/v1/images/${encodeURIComponent(cover.path)}` : ''
              const artistName = aw.artist?.name as string | undefined
              const imageCount = aw.imageCount || 0
              const totalMediaSize = aw.totalMediaSize || 0

              // 检查封面是否为视频
              const isVideoCover = cover && isVideoFile(cover.path)

              return (
                <Link key={id} to={`/artworks/${id}`} className="block animate-fade-in">
                  <div className="card p-0 overflow-hidden">
                    {/* Media Preview */}
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-100">
                      {src ? (
                        isVideoCover ? (
                          <VideoPreview src={src} title={aw.title} className="h-full w-full object-cover" />
                        ) : (
                          <img src={src} alt={aw.title} className="h-full w-full object-cover" loading="lazy" />
                        )
                      ) : (
                        <div className="h-full w-full bg-neutral-200 flex items-center justify-center">
                          <svg
                            className="w-8 h-8 text-neutral-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </div>
                      )}

                      {/* Media count badges */}
                      <div className="absolute top-3 right-3 flex flex-col gap-1">
                        {imageCount > 1 && (
                          <div className="bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            {imageCount}
                          </div>
                        )}
                        {totalMediaSize > 0 && (
                          <div className="bg-red-600/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                            {/* {videoCount} */}
                            {(totalMediaSize / (1024 * 1024)).toFixed(1)}MB
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-2">
                      <h3 className="font-medium text-neutral-900 truncate" title={aw.title}>
                        {aw.title}
                      </h3>
                      {artistName && (
                        <p className="text-sm text-neutral-600 truncate" title={artistName}>
                          {artistName}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {/* Pagination */}
          {data.total > pageSize &&
            (() => {
              const totalPages = Math.ceil(data.total / pageSize)
              return (
                <div className="card p-6">
                  <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
                    {/* Stats */}
                    <div className="text-sm text-neutral-600">
                      显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.total)} 项， 共{' '}
                      {data.total.toLocaleString()} 项
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      {/* Navigation Buttons */}
                      <div className="flex items-center gap-1">
                        {/* First Page */}
                        <button
                          disabled={page <= 1}
                          onClick={() => goto(1)}
                          className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                          title="首页"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                            />
                          </svg>
                        </button>

                        {/* Previous Page */}
                        <button
                          disabled={page <= 1}
                          onClick={() => goto(page - 1)}
                          className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                          title="上一页"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>

                        {/* Page Numbers */}
                        <div className="flex items-center gap-1 mx-2">
                          {(() => {
                            const pages = []
                            const showPages = 5
                            let start = Math.max(1, page - Math.floor(showPages / 2))
                            const end = Math.min(totalPages, start + showPages - 1)

                            if (end - start + 1 < showPages) {
                              start = Math.max(1, end - showPages + 1)
                            }

                            // Show first page if not in range
                            if (start > 1) {
                              pages.push(
                                <button
                                  key={1}
                                  onClick={() => goto(1)}
                                  className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-all duration-200 text-sm font-medium"
                                >
                                  1
                                </button>
                              )
                              if (start > 2) {
                                pages.push(
                                  <span key="start-ellipsis" className="px-2 text-neutral-400">
                                    …
                                  </span>
                                )
                              }
                            }

                            // Show page range
                            for (let i = start; i <= end; i++) {
                              pages.push(
                                <button
                                  key={i}
                                  onClick={() => goto(i)}
                                  className={`w-10 h-10 rounded-xl text-sm font-medium transition-all duration-200 ${
                                    i === page
                                      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25 border-primary-600'
                                      : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300'
                                  }`}
                                >
                                  {i}
                                </button>
                              )
                            }

                            // Show last page if not in range
                            if (end < totalPages) {
                              if (end < totalPages - 1) {
                                pages.push(
                                  <span key="end-ellipsis" className="px-2 text-neutral-400">
                                    …
                                  </span>
                                )
                              }
                              pages.push(
                                <button
                                  key={totalPages}
                                  onClick={() => goto(totalPages)}
                                  className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-all duration-200 text-sm font-medium"
                                >
                                  {totalPages}
                                </button>
                              )
                            }

                            return pages
                          })()}
                        </div>

                        {/* Next Page */}
                        <button
                          disabled={page >= totalPages}
                          onClick={() => goto(page + 1)}
                          className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                          title="下一页"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>

                        {/* Last Page */}
                        <button
                          disabled={page >= totalPages}
                          onClick={() => goto(totalPages)}
                          className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                          title="末页"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 5l7 7-7 7M5 5l7 7-7 7"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* Jump to Page */}
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-neutral-600 whitespace-nowrap">跳转到</span>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            max={totalPages}
                            value={jumpToPage}
                            onChange={(e) => setJumpToPage(e.target.value)}
                            onKeyDown={handleJumpInputKeyDown}
                            placeholder={String(page)}
                            className="w-16 h-8 px-2 text-center text-sm border border-neutral-200 rounded-lg focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-colors"
                          />
                        </div>
                        <span className="text-neutral-600">页</span>
                        <button
                          onClick={handleJumpToPage}
                          disabled={
                            !jumpToPage || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages
                          }
                          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  )
}
