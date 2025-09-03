import React, { useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../api'
import { Artist, EnhancedArtworksResponse, SortOption, getMediaType, isVideoFile } from '@pixishelf/shared'
import SortControl from '../components/SortControl'
import VideoPreview from '../components/VideoPreview'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, User, Calendar, Palette } from 'lucide-react'

// 获取艺术家信息
function useArtist(artistId: string) {
  return useQuery({
    queryKey: ['artist', artistId],
    queryFn: async (): Promise<Artist> => {
      return apiJson<Artist>(`/api/v1/artists/${artistId}`)
    },
    enabled: !!artistId
  })
}

// 获取艺术家的作品列表
function useArtistArtworks(artistId: string, page: number, pageSize: number, sortBy?: SortOption) {
  return useQuery({
    queryKey: ['artist-artworks', artistId, page, pageSize, sortBy],
    queryFn: async (): Promise<EnhancedArtworksResponse> => {
      const url = new URL('/api/v1/artworks', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', String(pageSize))
      url.searchParams.set('artistId', artistId)
      if (sortBy && sortBy !== 'newest') {
        url.searchParams.set('sortBy', sortBy)
      }
      return apiJson<EnhancedArtworksResponse>(url.toString())
    },
    enabled: !!artistId
  })
}

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>()
  const [sp, setSp] = useSearchParams()
  const page = parseInt(sp.get('page') || '1', 10)
  const pageSize = 24
  const sortBy = (sp.get('sortBy') as SortOption) || 'newest'
  const [jumpToPage, setJumpToPage] = useState('')

  const { data: artist, isLoading: artistLoading, isError: artistError } = useArtist(id!)
  const {
    data: artworks,
    isLoading: artworksLoading,
    isError: artworksError
  } = useArtistArtworks(id!, page, pageSize, sortBy)

  const goto = (p: number) => {
    const newSp = new URLSearchParams(sp)
    newSp.set('page', String(p))
    setSp(newSp)
  }

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage, 10)
    const totalPages = artworks ? Math.ceil(artworks.total / pageSize) : 1
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

  const handleSortChange = (newSortBy: SortOption) => {
    const newSp = new URLSearchParams(sp)
    if (newSortBy === 'newest') {
      newSp.delete('sortBy')
    } else {
      newSp.set('sortBy', newSortBy)
    }
    newSp.set('page', '1')
    setSp(newSp)
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (artistLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (artistError || !artist) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">艺术家不存在</h2>
        <p className="text-gray-600 mb-6">抱歉，找不到该艺术家的信息。</p>
        <Link to="/artists">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回艺术家列表
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* 返回按钮 */}
      <div>
        <Link to="/artists">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回艺术家列表
          </Button>
        </Link>
      </div>

      {/* 艺术家信息头部 */}
      <div className="card p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          {/* 头像 */}
          <Avatar className="h-24 w-24">
            <AvatarFallback className="bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 text-2xl">
              {getInitials(artist.name)}
            </AvatarFallback>
          </Avatar>

          {/* 艺术家信息 */}
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{artist.name}</h1>
              {artist.username && <p className="text-lg text-gray-500 dark:text-gray-400">@{artist.username}</p>}
            </div>

            {artist.bio && <p className="text-gray-700 dark:text-gray-300 leading-relaxed max-w-2xl">{artist.bio}</p>}

            {/* 统计信息 */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-gray-500" />
                <Badge variant="secondary" className="text-sm">
                  {artist.artworksCount} 作品
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-500" />
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
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">作品集</h2>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {artworks ? `共 ${artworks.total} 件作品` : '加载中...'}
            </p>
          </div>

          <SortControl value={sortBy} onChange={handleSortChange} size="md" />
        </div>

        {/* 作品网格 */}
        {artworksLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card p-0 overflow-hidden animate-pulse">
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
            <Palette className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无作品</h3>
            <p className="text-gray-600 dark:text-gray-400">该艺术家还没有上传任何作品</p>
          </div>
        ) : (
          <>
            {/* 作品网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {artworks.items.map((aw) => {
                const { id, title, artist: artworkArtist, images } = aw
                const cover = images?.[0]
                const src = cover ? `/api/v1/images/${cover.path}` : null
                const imageCount = images?.filter((img) => img.mediaType === 'image').length || 0
                const videoFiles = images?.filter((img) => img.mediaType === 'video') || []
                const totalMediaSize = videoFiles.reduce((sum, file) => sum + (file.size || 0), 0)
                const isVideoCover = cover && isVideoFile(cover.path)

                return (
                  <Link key={id} to={`/artworks/${id}`} className="block animate-fade-in">
                    <div className="card p-0 overflow-hidden">
                      {/* 媒体预览 */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-neutral-100">
                        {src ? (
                          isVideoCover ? (
                            <VideoPreview src={src} title={title} className="h-full w-full object-cover" />
                          ) : (
                            <img src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
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
                        <h3 className="font-medium text-neutral-900 truncate" title={title}>
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
                  <div className="card p-6">
                    <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
                      {/* 统计信息 */}
                      <div className="text-sm text-neutral-600">
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

                          {/* 上一页 */}
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
                                        ? 'bg-primary-600 text-white shadow-lg'
                                        : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300'
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
                            className="w-10 h-10 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
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

                        {/* 跳转到指定页 */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-neutral-600">跳转到</span>
                          <input
                            type="number"
                            min="1"
                            max={totalPages}
                            value={jumpToPage}
                            onChange={(e) => setJumpToPage(e.target.value)}
                            onKeyDown={handleJumpInputKeyDown}
                            className="w-16 h-8 px-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder={String(page)}
                          />
                          <span className="text-sm text-neutral-600">页</span>
                          <button
                            onClick={handleJumpToPage}
                            disabled={
                              !jumpToPage || parseInt(jumpToPage, 10) < 1 || parseInt(jumpToPage, 10) > totalPages
                            }
                            className="px-3 py-1 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
