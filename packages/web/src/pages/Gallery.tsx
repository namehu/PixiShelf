import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../api'
import { ArtworksResponse } from '@pixishelf/shared'

function useArtworks(page: number, pageSize: number, tags?: string[]) {
  return useQuery({
    queryKey: ['artworks', page, pageSize, tags],
    queryFn: async (): Promise<ArtworksResponse> => {
      const url = new URL('/api/v1/artworks', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', String(pageSize))
      if (tags && tags.length > 0) {
        url.searchParams.set('tags', tags.join(','))
      }
      return apiJson<ArtworksResponse>(url.toString())
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

  // 标签过滤状态
  const selectedTags = sp.get('tags')?.split(',').filter(Boolean) || []

  const { data, isLoading, isError } = useArtworks(page, pageSize, selectedTags.length > 0 ? selectedTags : undefined)

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

      {/* Active Filters Section */}
      {selectedTags.length > 0 && (
        <div className="card p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
              <span className="text-sm font-medium text-neutral-700">活跃过滤器</span>
            </div>
            <div className="flex flex-wrap gap-2">
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
          {/* Stats */}
          <div className="flex items-center justify-between">
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
              {selectedTags.length > 0 && (
                <div className="text-sm text-neutral-600">筛选结果: {selectedTags.map((t) => `#${t}`).join(', ')}</div>
              )}
            </div>
          </div>

          {/* Artwork Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {data.items.map((aw) => {
              const id = aw.id
              const cover = aw.images?.[0]
              const src = cover ? `/api/v1/images/${encodeURIComponent(cover.path)}` : ''
              const artistName = aw.artist?.name as string | undefined
              const imageCount = aw.imageCount || aw.images?.length || 0

              return (
                <Link key={id} to={`/artworks/${id}`} className="block animate-fade-in">
                  <div className="card p-0 overflow-hidden">
                    {/* Image */}
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-100">
                      {src ? (
                        <img src={src} alt={aw.title} className="h-full w-full object-cover" loading="lazy" />
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

                      {/* Image count badge */}
                      {imageCount > 1 && (
                        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium">
                          {imageCount}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-2">
                      <h3 className="font-medium text-neutral-900 truncate" title={aw.title}>{aw.title}</h3>
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
          {data.total > pageSize && (() => {
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
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
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
                                <span key="start-ellipsis" className="px-2 text-neutral-400">…</span>
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
                                <span key="end-ellipsis" className="px-2 text-neutral-400">…</span>
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
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
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
                        disabled={!jumpToPage || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages}
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
