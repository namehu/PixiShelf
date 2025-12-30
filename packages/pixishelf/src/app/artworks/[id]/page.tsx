'use client'

import React, { useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/components/auth'
import { client } from '@/lib/api'
import { AlertCircleIcon, ChevronLeftIcon, FullscreenIcon } from 'lucide-react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { Button } from '@/components/ui/button'
import TagArea from './_components/TagArea'
import MediaCounter from './_components/MediaCounter'
import { useArtworkStore } from '@/store/useArtworkStore' // 引入 store
import LazyMedia from './_components/LazyMedia'
import ArtworkDes from './_components/ArtworkDes'
import { getMediaInfo } from '../../../../lib/media'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'

export default function ArtworkDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const { isLoading: authLoading } = useAuth()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['artwork', id],
    queryFn: () => client<ArtworkResponseDto>(`/api/artworks/${id}`),
    enabled: !!id
  })

  const setTotal = useArtworkStore((state) => state.setTotal)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const setImages = useArtworkStore((state) => state.setImages)

  // 1. 初始化数据到 Store
  useEffect(() => {
    if (data?.images) {
      setTotal(data.images.length)
      setCurrentIndex(0)
    }
  }, [data, setTotal, setCurrentIndex])

  // 2. 确保页面滚动顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  const { ext, isVideo } = useMemo(() => getMediaInfo(data?.images?.[0]?.path || ''), [data])

  if (authLoading) return <div className="min-h-screen flex items-center justify-center">...</div>
  if (!data && isLoading) return <LoadingSkeleton /> // 简化加载逻辑
  if (isError) return <Error />
  if (!data) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto pt-16 lg:px-8">
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

                <MediaCounter hasVideo={isVideo} ext={ext} />

                <button
                  onClick={() => {
                    setImages(data.images)
                    router.push('/artworks/preview')
                  }}
                  className="w-16 flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <FullscreenIcon size={24} className="text-gray-600" />
                </button>
              </div>
            </div>
          </div>

          {/* 主内容 */}
          <div className="max-w-full overflow-hidden">
            {/* Header */}
            <div className="mt-6 px-6">
              {/* Title and Artist */}
              <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight break-words">
                  {data.title}
                </h1>
                {data.artist && (
                  <div
                    className="flex items-center gap-2 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/artists/${data.artist!.id}`)}
                  >
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
            <ArtworkDes description={data.description} className="mt-6 px-6" />

            {/* Images */}
            <div className="mt-6 mb-15 px-4 w-full">
              {data.images.map((img, index) => (
                <LazyMedia key={img.id} src={img.path} index={index} />
              ))}
            </div>
          </div>
        </div>
      </main>
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
