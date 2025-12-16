'use client'

import React, { useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { EnhancedArtwork, isVideoFile } from '@/types'
import { useAuth } from '@/components/auth'
import { apiJson } from '@/lib/api'
import { AlertCircleIcon, ChevronLeftIcon, FileTextIcon } from 'lucide-react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { Button } from '@/components/ui/button'
import TagArea from './_components/TagArea'
import MediaCounter from './_components/MediaCounter'
import { useArtworkStore } from '@/store/useArtworkStore' // 引入 store
import LazyMedia from './_components/LazyMedia'

// ... useArtwork hook 保持不变 ...
function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async (): Promise<EnhancedArtwork> => {
      return apiJson<EnhancedArtwork>(`/api/artworks/${id}`)
    },
    enabled: !!id
  })
}

export default function ArtworkDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { isLoading: authLoading } = useAuth()
  const id = params.id as string
  const { data, isLoading, isError } = useArtwork(id)

  // Zustand Actions
  const setTotal = useArtworkStore((state) => state.setTotal)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)

  // 1. 初始化数据到 Store
  useEffect(() => {
    if (data?.images) {
      setTotal(data.images.length)
      setCurrentIndex(0)
    }
    return () => {
      setTotal(0)
      setCurrentIndex(0)
    }
  }, [data, setTotal, setCurrentIndex])

  // 2. 确保页面滚动顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // 3. 计算是否存在视频 (用于传给 Counter 的图标显示)
  const hasVideo = useMemo(() => {
    return data?.images?.some((item) => isVideoFile(item.path)) ?? false
  }, [data])

  const handleArtistClick = () => {
    if (data?.artist?.id) {
      router.push(`/artists/${data.artist.id}`)
    }
  }

  if (authLoading) return <div className="min-h-screen flex items-center justify-center">...</div>
  if (!data && isLoading) return <LoadingSkeleton /> // 简化加载逻辑
  if (isError) return <Error />
  if (!data) return null

  return (
    <div className="bg-white max-w-2xl mx-auto">
      {/* 导航栏 */}
      <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => router.back()}
              className="w-16 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ChevronLeftIcon size={24} />
              <span className="hidden sm:inline">返回</span>
            </button>

            <MediaCounter hasVideo={hasVideo} />

            {/* 占位符 */}
            <div className="w-16" />
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-full overflow-hidden">
        <div className="animate-fade-in">
          {/* Header */}
          <div className="mt-6 px-4 sm:px-6">
            {/* Title and Artist */}
            <div className="space-y-3">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight break-words">
                {data.title}
              </h1>
              {data.artist?.userId && (
                <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={handleArtistClick}>
                  <ArtistAvatar src={data.artist.avatar} name={data.artist.name} />
                  <div className="text-base sm:text-lg text-blue-600 hover:text-blue-800 font-medium truncate transition-colors duration-200  underline-offset-2 hover:underline">
                    {data.artist.name}
                  </div>
                </div>
              )}
            </div>
            {/* Tags */}
            <TagArea tags={data.tags} className="mt-6" />
          </div>

          {/* Description */}
          {data.description && (
            <div className="mt-6 px-4 sm:px-6">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileTextIcon />
                描述
              </h3>
              <div className="bg-white rounded-lg text-gray-700 leading-relaxed max-w-full overflow-hidden">
                <p className="whitespace-pre-wrap break-words">{data.description}</p>
              </div>
            </div>
          )}

          {/* Images */}
          <div className="mt-6 w-full">
            {data.images.map((img, index) => (
              <LazyMedia key={img.id} src={img.path} index={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 px-4 sm:px-6 py-8">
      {/* Header skeleton */}
      <div className="space-y-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-gray-200 rounded-full animate-pulse" />
          <div className="h-6 w-20 bg-gray-200 rounded-full animate-pulse" />
          <div className="h-6 w-18 bg-gray-200 rounded-full animate-pulse" />
        </div>
      </div>

      {/* Images skeleton */}
      <div className="max-w-4xl mx-auto space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] bg-gray-200 rounded-2xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function Error() {
  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="bg-white rounded-lg text-center w-full mx-auto">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircleIcon className="text-red-500 w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h3>
        <p className="text-gray-600 mb-4">无法加载作品详情，请稍后重试。</p>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    </div>
  )
}
