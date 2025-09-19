'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'
import { EnhancedArtwork, isVideoFile } from '@pixishelf/shared'
import { useAuth } from '@/components'
import { VideoPlayer } from '@/components/ui'
import { apiJson } from '@/lib/api'

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取作品详情Hook
 */
function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: async (): Promise<EnhancedArtwork> => {
      return apiJson<EnhancedArtwork>(`/api/v1/artworks/${id}`)
    },
    enabled: !!id
  })
}

// ============================================================================
// 组件
// ============================================================================

/**
 * 懒加载图片组件
 */
function LazyImage({
  src,
  alt,
  index,
  onInView
}: {
  src: string
  alt: string
  index: number
  onInView: (index: number, inView: boolean) => void
}) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: '200px 0px', // 预加载：提前200px开始加载
    triggerOnce: true
  })

  const { ref: viewRef, inView: isInViewport } = useInView({
    threshold: 0.5, // 当图片50%可见时认为是当前图片
    rootMargin: '0px'
  })

  // 使用useCallback优化ref合并函数
  const setRefs = useCallback((node: HTMLDivElement | null) => {
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref && typeof ref === 'object' && ref !== null && 'current' in ref) {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    }
    
    if (typeof viewRef === 'function') {
      viewRef(node)
    } else if (viewRef && typeof viewRef === 'object' && viewRef !== null && 'current' in viewRef) {
      (viewRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    }
  }, [ref, viewRef])

  useEffect(() => {
    onInView(index, isInViewport)
  }, [isInViewport, index, onInView])

  return (
    <div
      ref={setRefs}
      className="overflow-hidden bg-neutral-100 flex items-center justify-center"
    >
      {inView ? (
        <img src={src} alt={alt} loading="lazy" className="w-full h-auto object-contain" />
      ) : (
        <div className="w-full h-96 bg-neutral-200 animate-pulse flex items-center justify-center">
          <svg className="w-12 h-12 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  )
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
    <div ref={viewRef} className="overflow-hidden bg-neutral-100 flex items-center justify-center">
      {isVideo ? (
        <VideoPlayer
          src={src}
          alt={alt}
          className="w-full h-auto"
          preload="metadata"
          controls={true}
          muted={false}
        />
      ) : (
        <LazyImage
          src={src}
          alt={alt}
          index={index}
          onInView={() => {}} // LazyImage内部已处理视口检测
        />
      )}
    </div>
  )
}

/**
 * 媒体序号指示器组件
 */
function MediaCounter({ 
  data, 
  currentImageIndex 
}: { 
  data: EnhancedArtwork
  currentImageIndex: number 
}) {
  if (!data || !data.images || data.images.length === 0) return null

  const imageCount = data.images.filter((img) => !isVideoFile(img.path)).length
  const videoCount = data.images.filter((img) => isVideoFile(img.path)).length
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

// ============================================================================
// 主组件
// ============================================================================

/**
 * 作品详情页面
 */
export default function ArtworkDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* 返回按钮 */}
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">返回</span>
            </button>

            {/* 媒体计数器 */}
            {data && <MediaCounter data={data} currentImageIndex={currentImageIndex} />}

            {/* 占位符 */}
            <div className="w-16"></div>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="max-w-full overflow-hidden">
        {/* Loading State */}
        {isLoading && (
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
        )}

        {/* Error State */}
        {isError && (
          <div className="px-4 sm:px-6 py-8">
            <div className="bg-white rounded-lg shadow p-8 text-center max-w-md mx-auto">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-50 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">加载失败</h3>
              <p className="text-gray-600 mb-4">无法加载作品详情，请稍后重试。</p>
              <button 
                onClick={() => window.location.reload()} 
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                重新加载
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {data && (
          <div className="animate-fade-in">
            {/* Images */}
            <div className="space-y-6">
              {/* Media Gallery */}
              <div className="w-full max-w-[768px] mx-auto">
                {(data.images || []).map((img, index: number) => {
                  const isVideo = isVideoFile(img.path)
                  return (
                    <LazyMedia
                      key={img.id}
                      src={`/api/v1/images/${encodeURIComponent(img.path)}`}
                      alt={`${data.title} - ${isVideo ? '视频' : '图片'} ${index + 1}`}
                      index={index}
                      onInView={handleImageInView}
                      isVideo={isVideo}
                    />
                  )
                })}
              </div>
            </div>

            {/* Header */}
            <div className="space-y-6 sm:space-y-8 mt-8 px-4 sm:px-6">
              {/* Title and Artist */}
              <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight break-words">
                  {data.title}
                </h1>
                {data.artist?.name && (
                  <div className="flex items-center gap-2 min-w-0">
                    <svg
                      className="w-5 h-5 text-gray-500 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <button
                      onClick={handleArtistClick}
                      className="text-base sm:text-lg text-blue-600 hover:text-blue-800 font-medium truncate transition-colors duration-200 cursor-pointer underline-offset-2 hover:underline"
                    >
                      {data.artist.name}
                    </button>
                  </div>
                )}
              </div>

              {/* Tags */}
              {data.tags && data.tags.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-4 h-4 text-gray-500 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900">标签</h3>
                  </div>
                  <div className="flex flex-wrap gap-2 max-w-full">
                    {data.tags.map((tag: string, index: number) => (
                      <span key={index} className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 break-all">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            {data.description && (
              <div className="mt-6 sm:mt-8 px-4 sm:px-6 pb-8">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-gray-500 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  描述
                </h3>
                <div className="bg-white rounded-lg shadow p-4 sm:p-6 lg:p-8 text-gray-700 leading-relaxed max-w-full overflow-hidden">
                  <p className="whitespace-pre-wrap break-words">{data.description}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}