'use client'

import React, { useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Artist, EnhancedArtworksResponse, SortOption } from '@/types'
import { useAuth } from '@/components/auth'
import { ChevronLeftIcon } from 'lucide-react'
import { SortControl } from '@/components/ui/SortControl'
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
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import ClientImage from '@/components/client-image'

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取艺术家信息Hook
 */
function useArtist(artistId: string) {
  return useQuery({
    queryKey: ['artist', artistId],
    queryFn: () => apiJson<Artist>(`/api/artists/${artistId}`),
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
      const url = new URL('/api/artworks', window.location.origin)
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

/**
 * 艺术家详情页面
 */
export default function ArtistDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { isLoading: authLoading } = useAuth()

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  // 加载状态
  if (artistLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-8">
            {/* 返回按钮骨架 */}
            <div className="h-10 w-32 bg-gray-200 rounded" />

            {/* 艺术家信息骨架 */}
            <div className="bg-white rounded-lg shadow p-8">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <div className="h-24 w-24 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-4">
                  <div className="h-8 w-64 bg-gray-200 rounded" />
                  <div className="h-4 w-32 bg-gray-200 rounded" />
                  <div className="h-16 w-full max-w-2xl bg-gray-200 rounded" />
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
          <button
            onClick={() => router.back()}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronLeftIcon size={24} />
            返回
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* 返回按钮 - 绝对定位在背景图上 */}
      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center px-3 py-2 text-white bg-black bg-opacity-50 hover:bg-opacity-70 rounded-lg transition-all backdrop-blur-sm"
        >
          <ChevronLeftIcon size={24} />
          返回
        </button>
      </div>

      {/* 艺术家背景图和信息头部 */}
      <div className="relative mb-8">
        {/* 背景图容器 */}
        <div className="relative h-80 md:h-96 overflow-hidden rounded-lg">
          {/* 背景图 */}
          {artist.backgroundImg ? (
            <div className="absolute inset-0">
              <div className="relative w-full h-full">
                <img
                  src={artist.backgroundImg}
                  alt={`${artist.name} 背景图`}
                  className="w-full h-full object-cover transition-opacity duration-300"
                  loading="eager"
                />
                <div
                  className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500"
                  style={{ display: 'none' }}
                />
              </div>
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </div>
          ) : (
            /* 默认背景 */
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500">
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
            </div>
          )}

          {/* 艺术家信息覆盖层 */}
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-end gap-4">
              {/* 头像和基本信息 */}
              <div className="flex gap-4 items-end">
                <div className="relative">
                  <ArtistAvatar src={artist.avatar} size={16} className="border-4 border-white shadow-lg" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{artist.name}</p>
                  {artist.userId && <p className="text-xl text-white/90 drop-shadow">@{artist.userId}</p>}
                </div>
              </div>

              {/* 统计信息 */}
              <div className="flex flex-wrap gap-4 md:ml-auto">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"
                    />
                  </svg>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white/20 text-white backdrop-blur-sm">
                    {artist.artworksCount} 作品
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-sm text-white/80 bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm">
                    加入于 {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            </div>

            {/* 艺术家简介 - 在背景图下方 */}
            {artist.bio && <p className="text-white leading-relaxed mt-4">{artist.bio}</p>}
          </div>
        </div>
      </div>

      {/* 作品列表部分 */}
      <div className="space-y-6">
        {/* 作品列表标题和排序 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">作品集</h2>
            <p className="text-gray-600 mt-1">{artworks ? `共 ${artworks.total} 件作品` : '加载中...'}</p>
          </div>

          <SortControl value={sortBy} onChange={handleSortChange} size="md" />
        </div>

        {/* 作品网格 */}
        {artworksLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-gray-200" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-200 rounded" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"
              />
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
                const src = cover ? cover.path : null
                const imageCount = images?.filter((img) => img.mediaType === 'image').length || 0
                const videoFiles = images?.filter((img) => img.mediaType === 'video') || []
                const totalMediaSize = videoFiles.reduce((sum, file) => sum + (file.size || 0), 0)

                return (
                  <Link key={id} href={`/artworks/${id}`} className="block animate-fade-in">
                    <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow">
                      {/* 媒体预览 */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
                        {src ? (
                          <ClientImage src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
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

                // 生成页码数组
                const generatePageNumbers = () => {
                  const pageNumbers: (number | string)[] = []
                  const showPages = 5

                  if (totalPages <= showPages) {
                    // 如果总页数小于等于显示页数，显示所有页码
                    for (let i = 1; i <= totalPages; i++) {
                      pageNumbers.push(i)
                    }
                  } else {
                    // 复杂分页逻辑
                    if (page <= 3) {
                      // 当前页在前面
                      for (let i = 1; i <= 4; i++) {
                        pageNumbers.push(i)
                      }
                      pageNumbers.push('ellipsis-end')
                      pageNumbers.push(totalPages)
                    } else if (page >= totalPages - 2) {
                      // 当前页在后面
                      pageNumbers.push(1)
                      pageNumbers.push('ellipsis-start')
                      for (let i = totalPages - 3; i <= totalPages; i++) {
                        pageNumbers.push(i)
                      }
                    } else {
                      // 当前页在中间
                      pageNumbers.push(1)
                      pageNumbers.push('ellipsis-start')
                      for (let i = page - 1; i <= page + 1; i++) {
                        pageNumbers.push(i)
                      }
                      pageNumbers.push('ellipsis-end')
                      pageNumbers.push(totalPages)
                    }
                  }

                  return pageNumbers
                }

                const pageNumbers = generatePageNumbers()

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
                        {/* Pagination Component */}
                        <Pagination>
                          <PaginationContent>
                            {/* Previous Page */}
                            <PaginationItem>
                              <PaginationPrevious
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault()
                                  if (page > 1) {
                                    goto(page - 1)
                                  }
                                }}
                                className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                              >
                                上一页
                              </PaginationPrevious>
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
                                  if (page < totalPages) {
                                    goto(page + 1)
                                  }
                                }}
                                className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                              >
                                下一页
                              </PaginationNext>
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
          </>
        )}
      </div>
    </div>
  )
}
