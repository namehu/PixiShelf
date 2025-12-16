'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'
import Image from 'next/image'
import { EnhancedArtwork, isVideoFile } from '@/types'
import { useAuth } from '@/components/auth'

import { VideoPlayer } from '@/components/ui/VideoPlayer'
import { apiJson } from '@/lib/api'
import { AlertCircleIcon, ChevronLeftIcon, FileTextIcon } from 'lucide-react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { Button } from '@/components/ui/button'
import TagArea from './_components/TagArea'

/**
 * 获取作品详情Hook
 */
function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async (): Promise<EnhancedArtwork> => {
      return apiJson<EnhancedArtwork>(`/api/artworks/${id}`)
    },
    enabled: !!id
  })
}

/**
 * 懒加载媒体组件（支持图片和视频）
 */
function LazyMedia({
  src,
  alt,
  index,
  onInView,
  isVideo = false
}: {
  src: string
  alt: string
  index: number
  onInView: (index: number, inView: boolean) => void
  isVideo?: boolean
}) {
  const { ref: viewRef, inView: isInViewport } = useInView({
    threshold: 0.5, // 当媒体50%可见时认为是当前媒体
    rootMargin: '0px'
  })

  useEffect(() => {
    onInView(index, isInViewport)
  }, [isInViewport, index, onInView])

  return (
    <div ref={viewRef} className="overflow-hidden bg-neutral-100 flex items-center justify-center min-h-[200px]">
      {isVideo ? (
        <VideoPlayer src={`/api/v1/images/${encodeURIComponent(src)}`} className="w-full h-auto" preload="metadata" />
      ) : (
        <Image
          src={src}
          alt={alt}
          priority={index <= 3}
          loading={index <= 3 ? 'eager' : 'lazy'}
          width={0}
          height={0}
          sizes="100vw"
          style={{ width: '100%', height: 'auto' }}
        />
      )}
    </div>
  )
}

/**
 * 媒体序号指示器组件
 */
function MediaCounter({ data, currentImageIndex }: { data: EnhancedArtwork; currentImageIndex: number }) {
  if (!data || !data.images || data.images.length === 0) {
    return null
  }

  const currentMedia = data.images[currentImageIndex]
  const isCurrentVideo = currentMedia && isVideoFile(currentMedia.path)

  return (
    <div className="flex items-center gap-1 sm:gap-2 text-neutral-500 max-w-full overflow-hidden">
      <div className="flex items-center gap-1 min-w-0">
        {isCurrentVideo ? (
          <svg
            className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        ) : (
          <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
        <span className="font-mono text-xs sm:text-sm whitespace-nowrap">
          <span className="text-neutral-900 font-medium">{currentImageIndex + 1}</span>
          <span className="mx-0.5 sm:mx-1 text-neutral-400">/</span>
          <span className="text-neutral-600">{data.images.length}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * 作品详情页面
 */
export default function ArtworkDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { isLoading: authLoading } = useAuth()

  const id = params.id as string
  const { data, isLoading, isError } = useArtwork(id)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [visibleImages, setVisibleImages] = useState<Set<number>>(new Set())

  // 处理艺术家点击事件
  const handleArtistClick = () => {
    if (data?.artist?.id) {
      router.push(`/artists/${data.artist.id}`)
    }
  }

  // 确保页面加载时滚动到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id]) // 当id变化时也滚动到顶部

  // 处理图片进入/离开视口
  const handleImageInView = useCallback((index: number, inView: boolean) => {
    setVisibleImages((prev) => {
      const newSet = new Set(prev)
      if (inView) {
        newSet.add(index)
      } else {
        newSet.delete(index)
      }
      return newSet
    })

    // 更新当前图片索引为最小的可见图片索引
    if (inView) {
      setCurrentImageIndex(index)
    }
  }, [])

  // 认证检查
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="bg-white max-w-2xl mx-auto">
      {/* 导航栏 */}
      <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200   z-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ChevronLeftIcon size={24} />
              <span className="hidden sm:inline">返回</span>
            </button>

            {/* 媒体计数器 */}
            {data && <MediaCounter data={data} currentImageIndex={currentImageIndex} />}

            {/* 占位符 */}
            <div className="w-16" />
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-full overflow-hidden">
        {isLoading && <LoadingSkeleton />}
        {isError && <Error />}

        {/* Content */}
        {data && (
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
              {(data.images || []).map((img, index: number) => {
                const isVideo = isVideoFile(img.path)
                return (
                  <LazyMedia
                    key={img.id}
                    src={img.path}
                    alt={`${data.title} - ${isVideo ? '视频' : '图片'} ${index + 1}`}
                    index={index}
                    onInView={handleImageInView}
                    isVideo={isVideo}
                  />
                )
              })}
            </div>
          </div>
        )}
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
