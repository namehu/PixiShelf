'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/components'
import { Card, CardHeader, CardTitle, CardContent, ArtistCard } from '@/components/ui'
import { VideoPreview } from '@/components/ui'
import { ROUTES } from '@/lib/constants'
import { apiJson } from '@/lib/api'
import { EnhancedArtworksResponse, Artist, isVideoFile } from '@pixishelf/shared'
import type { ArtistsResponse } from '@pixishelf/shared'
import { Button } from '@/components/ui/button'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 获取最近作品Hook
 */
function useRecentArtworks() {
  const [data, setData] = useState<EnhancedArtworksResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const response = await apiJson<EnhancedArtworksResponse>('/api/v1/artworks?page=1&pageSize=10&sortBy=newest')
        setData(response)
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取作品失败')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  return { data, isLoading, error }
}

/**
 * 获取最近艺术家Hook
 */
function useRecentArtists() {
  const [data, setData] = useState<ArtistsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const response = await apiJson<ArtistsResponse>('/api/v1/artists?page=1&pageSize=10&sortBy=artworks_desc')
        setData(response)
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取艺术家失败')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  return { data, isLoading, error }
}

/**
 * 仪表板页面组件
 */
export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, user, logout } = useAuth()
  const { data: recentArtworks, isLoading: artworksLoading, error: artworksError } = useRecentArtworks()
  const { data: recentArtists, isLoading: artistsLoading, error: artistsError } = useRecentArtists()

  /**
   * 处理登出
   */
  const handleLogout = async () => {
    await logout()
  }

  /**
   * 返回主页
   */
  const handleGoHome = () => {
    router.push('/')
  }

  // 加载状态
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  // 未认证状态
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">访问受限</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">您需要登录才能访问仪表板</p>
            <Button className="w-full" onClick={() => router.push(ROUTES.LOGIN)}>
              前往登录
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-gray-900">Pixishelf</h1>
              <span className="text-sm text-gray-500">/ 仪表板</span>
            </div>

            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{user?.username}</span>
              <Button variant="ghost" size="sm" onClick={handleGoHome}>
                主页
              </Button>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                登出
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">欢迎回来，{user?.username}！</h2>
          <p className="text-gray-600">探索最新的艺术作品和才华横溢的艺术家们</p>
        </div>

        {/* 快速操作区域 */}
        <div className="mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button onClick={() => router.push(ROUTES.GALLERY)}>浏览作品</Button>
                <Button variant="outline" onClick={() => router.push(ROUTES.ARTISTS)}>
                  发现艺术家
                </Button>
                <Button variant="outline" onClick={() => router.push(ROUTES.ADMIN)}>
                  设置管理
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 最近作品区域 */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">最新作品</h3>
              <p className="text-gray-600">发现最新上传的精彩作品</p>
            </div>
            <Link href={ROUTES.GALLERY}>
              <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
                查看全部 →
              </Button>
            </Link>
          </div>

          {artworksLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
                  <div className="aspect-[3/4] bg-gray-200"></div>
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : artworksError ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-red-600">{artworksError}</p>
              </CardContent>
            </Card>
          ) : recentArtworks && recentArtworks.items.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {recentArtworks.items.map((artwork) => {
                const cover = artwork.images?.[0]
                const src = cover ? `/api/v1/images/${encodeURIComponent(cover.path)}` : ''
                const isVideoCover = cover && isVideoFile(cover.path)
                const artistName = artwork.artist?.name

                return (
                  <Link key={artwork.id} href={`/artworks/${artwork.id}`} className="block">
                    <div className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                      {/* 作品封面 */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
                        {src ? (
                          isVideoCover ? (
                            <VideoPreview src={src} title={artwork.title} className="h-full w-full object-cover" />
                          ) : (
                            <img src={src} alt={artwork.title} className="h-full w-full object-cover" loading="lazy" />
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

                        {/* 图片数量标识 */}
                        {artwork.imageCount > 1 && (
                          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            {artwork.imageCount}
                          </div>
                        )}
                      </div>

                      {/* 作品信息 */}
                      <div className="p-4 space-y-2">
                        <h4 className="font-medium text-gray-900 truncate" title={artwork.title}>
                          {artwork.title}
                        </h4>
                        {artistName && (
                          <p className="text-sm text-gray-600 truncate" title={artistName}>
                            {artistName}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <svg
                  className="w-16 h-16 text-gray-300 mx-auto mb-4"
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
                <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
                <p className="text-gray-600 mb-4">还没有任何作品，快去发现精彩内容吧！</p>
                <Link href={ROUTES.GALLERY}>
                  <Button>浏览作品</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 最近艺术家区域 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">热门艺术家</h3>
              <p className="text-gray-600">发现才华横溢的艺术家们</p>
            </div>
            <Link href={ROUTES.ARTISTS}>
              <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
                查看全部 →
              </Button>
            </Link>
          </div>

          {artistsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-sm p-6 animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : artistsError ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-red-600">{artistsError}</p>
              </CardContent>
            </Card>
          ) : recentArtists && recentArtists.items.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentArtists.items.slice(0, 6).map((artist) => (
                <ArtistCard key={artist.id} artist={artist} onClick={() => router.push(`/artists/${artist.id}`)} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <svg
                  className="w-16 h-16 text-gray-300 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                  />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">暂无艺术家</h3>
                <p className="text-gray-600 mb-4">还没有发现任何艺术家，快去探索吧！</p>
                <Link href={ROUTES.ARTISTS}>
                  <Button>发现艺术家</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
