'use client'

import { useState, useEffect } from 'react'
import { Hash } from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import { Artwork } from '@/types/core'
import { ArtworkCard } from '@/components/ui/ArtworkCard'
import { client } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

interface ArtworkListProps {
  tagId: string
}

export function ArtworkList({ tagId }: ArtworkListProps) {
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  const pageSize = 20

  // 滚动监听
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: '200px'
  })

  // 获取作品列表
  const fetchArtworks = async (pageNum: number) => {
    try {
      setIsLoading(true)
      setIsError(false)

      const data = await client<any>(`/api/artworks?tagId=${tagId}&page=${pageNum}&pageSize=${pageSize}`)
      const newArtworks = data.items || []

      if (pageNum === 1) {
        setArtworks(newArtworks)
      } else {
        setArtworks((prev) => {
          // 简单的去重
          const newIds = new Set(newArtworks.map((i: Artwork) => i.id))
          const filteredPrev = prev.filter((p) => !newIds.has(p.id))
          return [...filteredPrev, ...newArtworks]
        })
      }

      // 计算是否还有更多数据
      const totalPages = Math.ceil(data.total / pageSize)
      setHasMore(pageNum < totalPages)
    } catch (err) {
      console.error('Failed to fetch artworks:', err)
      setIsError(true)
    } finally {
      setIsLoading(false)
    }
  }

  // 初始化数据
  useEffect(() => {
    if (tagId) {
      setPage(1)
      fetchArtworks(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId])

  // 触发下一页
  useEffect(() => {
    if (inView && !isLoading && hasMore && artworks.length > 0) {
      const nextPage = page + 1
      setPage(nextPage)
      fetchArtworks(nextPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, isLoading, hasMore, artworks.length])

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          作品列表
          <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {artworks.length}+
          </span>
        </h2>
      </div>

      <div className="min-h-[200px]">
        {artworks.length === 0 && !isLoading && !isError ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
            <div className="text-slate-300 mb-4 flex justify-center">
              <Hash className="w-16 h-16" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">暂无作品</h3>
            <p className="text-slate-500">该标签下还没有任何作品</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {artworks.map((artwork) => (
              <ArtworkCard key={`${artwork.id}-${artwork.updatedAt}`} artwork={artwork} showArtist={true} />
            ))}

            {/* Loading Skeletons */}
            {isLoading &&
              hasMore &&
              Array.from({ length: 10 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="space-y-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-xl bg-slate-200" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-3/4 bg-slate-200" />
                    <Skeleton className="h-3 w-1/2 bg-slate-200" />
                  </div>
                </div>
              ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="mb-2">加载失败</p>
            <button
              onClick={() => fetchArtworks(page)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {/* 底部触发器 */}
        <div
          ref={loadMoreRef}
          className="h-20 w-full flex items-center justify-center mt-8 opacity-0 pointer-events-none"
        />

        {!hasMore && artworks.length > 0 && (
          <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest border-t border-slate-100 mt-8">
            — End of Collection —
          </div>
        )}
      </div>
    </div>
  )
}
