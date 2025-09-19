'use client'

import React, { useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Artist, EnhancedArtworksResponse, SortOption, isVideoFile } from '@pixishelf/shared'
import { useAuth } from '@/components'
import { SortControl, VideoPreview } from '@/components/ui'
import { apiJson } from '@/lib/api'

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取艺术家信息Hook
 */
function useArtist(artistId: string) {
  return useQuery({
    queryKey: ['artist', artistId],
    queryFn: async (): Promise<Artist> => {
      return apiJson<Artist>(`/api/v1/artists/${artistId}`)
    },
    enabled: !!artistId
  })
}

/**
 * 获取艺术家的作品列表Hook
 */
function useArtistArtworks(artistId: string, page: number, pageSize: number, sortBy?: SortOption) {
  return useQuery({
    queryKey: ['artist-artworks', artistId, page, pageSize, sortBy],
    queryFn: async (): Promise<EnhancedArtworksResponse> => {
      const url = new URL('/api/v1/artworks', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', String(pageSize))
      url.searchParams.set('artistId', artistId)
      if (sortBy && sortBy !== 'source_date_desc') {
        url.searchParams.set('sortBy', sortBy)
      }
      return apiJson<EnhancedArtworksResponse>(url.toString())
    },
    enabled: !!artistId
  })
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取姓名首字母
 */
function getInitials(name: string) {
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 艺术家详情页面
 */
export default function ArtistDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  
  const id = params.id as string
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = 24
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'
  const [jumpToPage, setJumpToPage] = useState('')

  const { data: artist, isLoading: artistLoading, isError: artistError } = useArtist(id)
  const {
    data: artworks,
    isLoading: artworksLoading,
    isError: artworksError
  } = useArtistArtworks(id, page, pageSize, sortBy)

  // 页面跳转函数
  const goto = (p: number) => {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.set('page', String(p))
    router.push(`/artists/${id}?${newParams.toString()}`)
  }

  // 处理跳转到指定页
  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage, 10)
    const totalPages = artworks ? Math.ceil(artworks.total / pageSize) : 1
    if (pageNum >= 1 && pageNum <= totalPages) {
      goto(pageNum)
      setJumpToPage('')
    }
  }

  // 处理跳转输入框回车事件
  const handleJumpInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJumpToPage()
    }
  }

  // 处理排序变化
  const handleSortChange = (newSortBy: SortOption) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (newSortBy === 'source_date_desc') {
      newParams.delete('sortBy')
    } else {
      newParams.set('sortBy', newSortBy)
    }
    newParams.set('page', '1')
    router.push(`/artists/${id}?${newParams.toString()}`)
  }

  // 认证检查
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  // 加载状态
  if (artistLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-8">
            {/* 返回按钮骨架 */}
            <div className="h-10 w-32 bg-gray-200 rounded"></div>
            
            {/* 艺术家信息骨架 */}
            <div className="bg-white rounded-lg shadow p-8">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <div className="h-24 w-24 bg-gray-200 rounded-full"></div>
                <div className="flex-1 space-y-4">
                  <div className="h-8 w-64 bg-gray-200 rounded"></div>
                  <div className="h-4 w-32 bg-gray-200 rounded"></div>
                  <div className="h-16 w-full max-w-2xl bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 错误状态
  if (artistError || !artist) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">艺术家不存在</h2>
          <p className="text-gray-600 mb-6">抱歉，找不到该艺术家的信息。</p>
          <Link href="/gallery">
            <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回画廊
            </button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* 返回按钮 */}
        <div>
          <Link href="/gallery">
            <button className="inline-flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回画廊
            </button>
          </Link>
        </div>

        {/* 艺术家信息头部 */}
        <div className="bg-white rounded-lg shadow p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            {/* 头像 */}
            <div className="h-24 w-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold">
              {getInitials(artist.name)}
            </div>

            {/* 艺术家信息 */}
            <div className="flex-1 space-y-4">
              <div>
                <h1 className="text-4xl font-bold text-gray-900 mb-2">{artist.name}</h1>
                {artist.username && <p className="text-lg text-gray-500">@{artist.username}</p>}
              </div>

              {artist.bio && <p className="text-gray-700 leading-relaxed max-w-2xl">{artist.bio}</p>}

              {/* 统计信息 */}
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z" />
                  </svg>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                    {artist.artworksCount} 作品
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-gray-500">
                    加入于 {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 作品列表部分 */}
        <div className="space-y-6">
          {/* 作品列表标题和排序 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">作品集</h2>
              <p className="text-gray-600 mt-1">
                {artworks ? `共 ${artworks.total} 件作品` : '加载中...'}
              </p>
            </div>

            <SortControl value={sortBy} onChange={handleSortChange} size="md" />
          </div>

          {/* 作品网格 */}
          {artworksLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg shadow overflow-hidden animate-pulse">
                  <div className="aspect-[3/4] bg-gray-200"></div>
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : artworksError ? (
            <div className="text-center py-12">
              <p className="text-gray-600">加载作品时出错，请稍后重试。</p>
            </div>
          ) : !artworks || artworks.items.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
              <p className="text-gray-600">该艺术家还没有上传任何作品</p>
            </div>
          ) : (
            <>
              {/* 作品网格 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {artworks.items.map((aw) => {
                  const { id, title, images } = aw
                  const cover = images?.[0]
                  const src = cover ? `/api/v1/images/${encodeURIComponent(cover.path)}` : null
                  const imageCount = images?.filter((img) => img.mediaType === 'image').length || 0
                  const videoFiles = images?.filter((img) => img.mediaType === 'video') || []
                  const totalMediaSize = videoFiles.reduce((sum, file) => sum + (file.size || 0), 0)
                  const isVideoCover = cover && isVideoFile(cover.path)

                  return (
                    <Link key={id} href={`/artworks/${id}`} className="block animate-fade-in">
                      <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow">
                        {/* 媒体预览 */}
                        <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
                          {src ? (
                            isVideoCover ? (
                              <VideoPreview src={src} title={title} className="h-full w-full object-cover" />
                            ) : (
                              <img src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
                            )
                          ) : (
                            <div className="h-full w-full bg-gray-200 flex items-center justify-center">
                              <svg
                                className="w-8 h-8 text-gray-400"
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

                          {/* 媒体数量标识 */}
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
                                {(totalMediaSize / (1024 * 1024)).toFixed(1)}MB
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 内容 */}
                        <div className="p-4 space-y-2">
                          <h3 className="font-medium text-gray-900 truncate" title={title}>
                            {title}
                          </h3>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>

              {/* 分页 */}
              {artworks.total > pageSize &&
                (() => {
                  const totalPages = Math.ceil(artworks.total / pageSize)
                  return (
                    <div className="bg-white rounded-lg shadow p-6">
                      <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
                        {/* 统计信息 */}
                        <div className="text-sm text-gray-600">
                          显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, artworks.total)} 项，共{' '}
                          {artworks.total.toLocaleString()} 项
                        </div>

                        {/* 分页控件 */}
                        <div className="flex flex-col sm:flex-row items-center gap-4">
                          {/* 导航按钮 */}
                          <div className="flex items-center gap-1">
                            {/* 首页 */}
                            <button
                              disabled={page <= 1}
                              onClick={() => goto(1)}
                              className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
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

                            {/* 上一页 */}
                            <button
                              disabled={page <= 1}
                              onClick={() => goto(page - 1)}
                              className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                              title="上一页"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                            </button>

                            {/* 页码 */}
                            <div className="flex items-center gap-1 mx-2">
                              {(() => {
                                const pages = []
                                const showPages = 5
                                let start = Math.max(1, page - Math.floor(showPages / 2))
                                const end = Math.min(totalPages, start + showPages - 1)

                                if (end - start + 1 < showPages) {
                                  start = Math.max(1, end - showPages + 1)
                                }

                                for (let i = start; i <= end; i++) {
                                  pages.push(
                                    <button
                                      key={i}
                                      onClick={() => goto(i)}
                                      className={`w-10 h-10 rounded-xl transition-all duration-200 text-sm font-medium ${
                                        i === page
                                          ? 'bg-blue-600 text-white shadow-lg'
                                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                                      }`}
                                    >
                                      {i}
                                    </button>
                                  )
                                }
                                return pages
                              })()}
                            </div>

                            {/* 下一页 */}
                            <button
                              disabled={page >= totalPages}
                              onClick={() => goto(page + 1)}
                              className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                              title="下一页"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>

                            {/* 末页 */}
                            <button
                              disabled={page >= totalPages}
                              onClick={() => goto(totalPages)}
                              className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
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

                          {/* 跳转到指定页 */}
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">跳转到</span>
                            <input
                              type="number"
                              min="1"
                              max={totalPages}
                              value={jumpToPage}
                              onChange={(e) => setJumpToPage(e.target.value)}
                              onKeyDown={handleJumpInputKeyDown}
                              className="w-16 h-8 px-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder={String(page)}
                            />
                            <span className="text-sm text-gray-600">页</span>
                            <button
                              onClick={handleJumpToPage}
                              disabled={
                                !jumpToPage || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages
                              }
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              跳转
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}