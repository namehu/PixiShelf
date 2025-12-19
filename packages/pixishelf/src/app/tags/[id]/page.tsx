'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Hash, Grid, List, TagIcon, WallpaperIcon, Loader2 } from 'lucide-react'
import { Artwork } from '@/types/core'
import { ArtworkCard } from '@/components/ui/ArtworkCard'
import { cn } from '@/lib/utils'
import { getTranslateName } from '@/utils/tags'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { AvatarFallback } from '@radix-ui/react-avatar'
import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api'
import { TTagResponseDto } from '@/schemas/tag.dto'
import { motion, AnimatePresence } from 'framer-motion'

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
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <Hash className="w-12 h-12 mx-auto" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">加载失败</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-100 flex flex-col">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-slate-200/50 bg-white/80 px-4 h-16">
        <div className="max-w-screen-xl h-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBack}
              className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {data && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2"
              >
                <span className="font-bold text-lg tracking-tight text-slate-800 line-clamp-1">{data.name}</span>
              </motion.div>
            )}
          </div>

          {/* 视图切换 */}
          <div className="flex items-center gap-1">
            <div className="bg-slate-100/50 p-1 rounded-lg flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 rounded-md transition-all',
                  viewMode === 'grid'
                    ? 'bg-white shadow-sm text-blue-600'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                )}
                title="网格视图"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-1.5 rounded-md transition-all',
                  viewMode === 'list'
                    ? 'bg-white shadow-sm text-blue-600'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                )}
                title="列表视图"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-screen-xl mx-auto px-4 py-8">
        {/* 标签信息 Hero 区域 */}
        {data && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-10 flex flex-col md:flex-row items-start md:items-center gap-6"
          >
            <div className="relative group shrink-0">
              <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-xl shadow-blue-900/5 ring-4 ring-white bg-white">
                <Avatar className="w-full h-full">
                  <AvatarImage src={data.image ?? ''} className="object-cover" />
                  <AvatarFallback className="flex items-center justify-center w-full h-full bg-blue-50 text-blue-500">
                    <TagIcon className="w-10 h-10" />
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">{data.name}</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold border border-blue-100">
                  {getTranslateName(data)}
                </span>
              </div>

              {data.description && <p className="text-slate-500 max-w-2xl leading-relaxed">{data.description}</p>}

              <div className="flex items-center gap-4 pt-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200/60 px-3 py-1 rounded-full shadow-sm">
                  <WallpaperIcon className="w-4 h-4 text-slate-400" />
                  <span>{data.artworkCount} 作品</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 作品列表 */}
        <div className="min-h-[200px]">
          {artworks.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
              <div className="text-slate-300 mb-4 flex justify-center">
                <Hash className="w-16 h-16" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">暂无作品</h3>
              <p className="text-slate-500">该标签下还没有任何作品</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {/* 网格视图 */}
              {viewMode === 'grid' && (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                >
                  {artworks.map((artwork, idx) => (
                    <motion.div
                      key={artwork.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(idx * 0.05, 0.5) }}
                    >
                      <ArtworkCard artwork={artwork} showArtist={true} />
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* 列表视图 */}
              {viewMode === 'list' && (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4 max-w-4xl mx-auto"
                >
                  {artworks.map((artwork, idx) => (
                    <motion.div
                      key={artwork.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.05, 0.5) }}
                    >
                      <ArtworkCard artwork={artwork} showArtist={true} layout="horizontal" />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* 加载更多按钮 */}
          {hasMore && artworks.length > 0 && (
            <div className="flex justify-center mt-12 mb-8">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="group flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-full hover:border-blue-400 hover:text-blue-600 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>加载中...</span>
                  </>
                ) : (
                  <>
                    <span>加载更多</span>
                    <ArrowLeft className="w-4 h-4 rotate-[-90deg] group-hover:translate-y-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default TagDetailPage
