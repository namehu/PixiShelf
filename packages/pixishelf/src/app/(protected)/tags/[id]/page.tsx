'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Hash, Grid, List, TagIcon, WallpaperIcon } from 'lucide-react'
import { Artwork } from '@/types/core'
import { ArtworkCard } from '@/components/ui/ArtworkCard'
import { cn } from '@/lib/utils'
import { getTranslateName } from '@/utils/tags'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { AvatarFallback } from '@radix-ui/react-avatar'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api'
import { TTagResponseDto } from '@/schemas/tag.dto'

/**
 * 标签详情页面
 *
 * 功能：
 * - 显示标签基本信息
 * - 展示该标签下的所有作品
 * - 支持网格和列表视图切换
 * - 分页加载作品
 */
function TagDetailPage() {
  const params = useParams()
  const router = useRouter()
  const tagId = params.id as string

  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['tag', tagId],
    queryFn: () => client<TTagResponseDto>(`/api/tags/${tagId}`),
    enabled: !!tagId
  })

  // 获取作品列表
  const fetchArtworks = async (pageNum = 1, append = false) => {
    try {
      if (pageNum === 1) {
        //
      } else {
        setLoadingMore(true)
      }

      const response = await fetch(
        `/api/artworks?tagId=${tagId}&page=${pageNum}&pageSize=${pageSize}&sortBy=source_date_desc`
      )

      if (!response.ok) {
        throw new Error('获取作品列表失败')
      }

      const data = await response.json()

      // API 返回格式: { items: [], total: number, page: number, pageSize: number }
      const newArtworks = data.items || []

      if (append) {
        setArtworks((prev) => [...prev, ...newArtworks])
      } else {
        setArtworks(newArtworks)
      }

      // 计算是否还有更多数据
      const totalPages = Math.ceil(data.total / pageSize)
      setHasMore(pageNum < totalPages)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取作品列表失败')
    } finally {
      setLoadingMore(false)
    }
  }

  // 加载更多作品
  const loadMore = () => {
    if (!loadingMore && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      fetchArtworks(nextPage, true)
    }
  }

  // 初始化数据
  useEffect(() => {
    if (tagId) {
      fetchArtworks(1)
    }
  }, [tagId])

  // 返回按钮
  const handleBack = () => {
    router.back()
  }

  if (isLoading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-neutral-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <Hash className="w-12 h-12 mx-auto" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900 mb-2">加载失败</h2>
          <p className="text-neutral-600 mb-4">{error}</p>
          <button onClick={handleBack} className="btn-primary">
            返回
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* 顶部导航 */}
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="px-2">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button onClick={handleBack} className="btn-ghost p-2 rounded-lg hover:bg-neutral-100">
                <ArrowLeft className="w-5 h-5" />
              </button>

              {data && (
                <div className="flex items-center gap-3">
                  <div className="bg-blue-100 rounded-lg">
                    <Avatar className="size-10 w-10 h-10 rounded-lg">
                      <AvatarImage src={data.image ?? ''} />
                      <AvatarFallback className="flex items-center justify-center w-full">
                        <TagIcon className="w-5 h-5 text-blue-600" />
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold text-neutral-900">
                      <span>{data.name}</span>
                    </h1>
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                      <span className="flex items-center gap-1  text-sm text-neutral-500">
                        <WallpaperIcon className="w-4 h-4" />
                        <span>{data.artworkCount}</span>
                      </span>

                      <span>{getTranslateName(data)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 视图切换 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-neutral-500 hover:bg-neutral-100'
                )}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-2 rounded-lg transition-colors',
                  viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-neutral-500 hover:bg-neutral-100'
                )}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 标签描述 */}
      {data?.description && (
        <div className="bg-white border-b border-neutral-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <p className="text-neutral-600">{data.description}</p>
          </div>
        </div>
      )}

      {/* 作品列表 */}
      <div className=" py-6">
        {artworks.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-neutral-400 mb-4">
              <Hash className="w-12 h-12 mx-auto" />
            </div>
            <h3 className="text-lg font-medium text-neutral-900 mb-2">暂无作品</h3>
            <p className="text-neutral-500">该标签下还没有任何作品</p>
          </div>
        ) : (
          <>
            {/* 网格视图 */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {artworks.map((artwork) => (
                  <ArtworkCard key={artwork.id} artwork={artwork} showArtist={true} />
                ))}
              </div>
            )}

            {/* 列表视图 */}
            {viewMode === 'list' && (
              <div className="space-y-4">
                {artworks.map((artwork) => (
                  <ArtworkCard key={artwork.id} artwork={artwork} showArtist={true} layout="horizontal" />
                ))}
              </div>
            )}

            {/* 加载更多按钮 */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TagDetailPage
