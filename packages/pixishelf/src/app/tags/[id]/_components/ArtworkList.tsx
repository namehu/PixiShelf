'use client'

import React, { useState, useEffect } from 'react'
import { Hash, Grid, List, Loader2, ArrowLeft } from 'lucide-react'
import { Artwork } from '@/types/core'
import { ArtworkCard } from '@/components/ui/ArtworkCard'
import { cn } from '@/lib/utils'
import { client } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'

interface ArtworkListProps {
  tagId: string
}

export function ArtworkList({ tagId }: ArtworkListProps) {
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(true)

  const pageSize = 20

  // 获取作品列表
  const fetchArtworks = async (pageNum = 1, append = false) => {
    try {
      if (pageNum === 1) {
        setIsLoading(true)
      } else {
        setLoadingMore(true)
      }

      const data = await client<any>(`/api/artworks?tagId=${tagId}&page=${pageNum}&pageSize=${pageSize}`)

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
      setIsLoading(false)
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <Hash className="w-12 h-12 mx-auto" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">加载失败</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => fetchArtworks(1)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* 视图切换工具栏 */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          作品列表
          <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {artworks.length}+
          </span>
        </h2>
        <div className="bg-white border border-slate-200 p-1 rounded-lg flex items-center gap-1 shadow-sm">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded-md transition-all',
              viewMode === 'grid'
                ? 'bg-slate-100 text-blue-600 font-medium'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
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
                ? 'bg-slate-100 text-blue-600 font-medium'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            )}
            title="列表视图"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

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
    </div>
  )
}
