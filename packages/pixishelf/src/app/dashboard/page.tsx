'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/components'
import { Card, CardHeader, CardTitle, CardContent, ArtistCard } from '@/components/ui'
import { VideoPreview } from '@/components/ui'
import { ROUTES } from '@/lib/constants'
import { apiJson } from '@/lib/api'
import { EnhancedArtworksResponse, Artist, isVideoFile } from '@/types'
import type { ArtistsResponse } from '@/types'
import { Button } from '@/components/ui/button'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink
} from '@/components/ui/navigation-menu'
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator
} from '@/components/ui/menubar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { User, Settings, LogOut, Image, Users, RefreshCw } from 'lucide-react'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 获取推荐作品Hook
 */
function useRecommendedArtworks() {
  const [data, setData] = useState<EnhancedArtworksResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const response = await apiJson<EnhancedArtworksResponse>('/api/v1/artworks/recommendations')
        setData(response)
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取推荐作品失败')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [refreshKey])

  return { data, isLoading, error, refresh }
}

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
  const { data: recommendedArtworks, isLoading: recommendedLoading, error: recommendedError, refresh: refreshRecommended } = useRecommendedArtworks()
  const { data: recentArtworks, isLoading: artworksLoading, error: artworksError } = useRecentArtworks()
  const { data: recentArtists, isLoading: artistsLoading, error: artistsError } = useRecentArtists()

  /**
   * 处理登出
   */
  const handleLogout = async () => {
    await logout()
  }

  /**
   * 用户菜单组件
   */
  const UserMenu = () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger className="flex items-center space-x-2 cursor-pointer">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-gray-700">{user?.username}</span>
        </MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => router.push(ROUTES.CHANGE_PASSWORD)}>
            <User className="mr-2 h-4 w-4" />
            个人资料
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            登出
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )

  /**
   * 主导航菜单组件
   */
  const MainNavigation = () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>
            <Image className="mr-2 h-4 w-4" />
            作品
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink
                className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
                onClick={() => router.push(ROUTES.GALLERY)}
              >
                <div className="text-sm font-medium leading-none">浏览作品</div>
                <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">探索精彩的艺术作品集合</p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>
            <Users className="mr-2 h-4 w-4" />
            艺术家
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink
                className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
                onClick={() => router.push(ROUTES.ARTISTS)}
              >
                <div className="text-sm font-medium leading-none">发现艺术家</div>
                <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">认识才华横溢的艺术家们</p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>
            <Settings className="mr-2 h-4 w-4" />
            管理
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid gap-3 p-4 w-[400px]">
              <NavigationMenuLink
                className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer"
                onClick={() => router.push(ROUTES.ADMIN)}
              >
                <div className="text-sm font-medium leading-none">设置管理</div>
                <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">系统设置和管理功能</p>
              </NavigationMenuLink>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )

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
            <div className="flex items-center space-x-6">
              <h1 className="text-xl font-bold text-gray-900">Pixishelf</h1>
              <span className="text-sm text-gray-500">/ 仪表板</span>
              <MainNavigation />
            </div>

            <div className="flex items-center">
              <UserMenu />
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* 推荐作品区域 */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">推荐作品</h3>
              <p className="text-gray-600">为您精心挑选的优质作品</p>
            </div>
            <Button 
              variant="ghost" 
              className="text-blue-600 hover:text-blue-700 flex items-center gap-2"
              onClick={refreshRecommended}
              disabled={recommendedLoading}
            >
              <RefreshCw className={`h-4 w-4 ${recommendedLoading ? 'animate-spin' : ''}`} />
              刷新推荐
            </Button>
          </div>

          {recommendedLoading ? (
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
          ) : recommendedError ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-red-600">{recommendedError}</p>
              </CardContent>
            </Card>
          ) : recommendedArtworks && recommendedArtworks.items.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {recommendedArtworks.items.map((artwork) => {
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

                        {/* 推荐标识 */}
                        <div className="absolute top-3 left-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2 py-1 rounded-lg text-xs font-medium">
                          推荐
                        </div>
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
                <h3 className="text-lg font-medium text-gray-900 mb-2">暂无推荐作品</h3>
                <p className="text-gray-600 mb-4">系统正在为您准备精彩内容</p>
                <Button onClick={refreshRecommended}>刷新推荐</Button>
              </CardContent>
            </Card>
          )}
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
