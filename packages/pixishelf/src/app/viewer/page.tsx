'use client'

import { useInfiniteImages } from '@/hooks/useInfiniteImages'
import ImmersiveImageViewer from './_components/ImmersiveImageViewer'
import { useMemo, useEffect } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import PageNoData from './_components/PageNoData'
import PageLoading from './_components/PageLoading'
import PageError from './_components/PageError'
import { useViewerStore, hasViewerCache } from '@/store/viewerStore'

/**
 * 沉浸式图片浏览页面
 * 提供类似抖音/TikTok的全屏图片浏览体验
 * 集成状态管理，支持浏览位置恢复
 */
export default function ViewerPage() {
  const router = useRouter()

  // 状态管理
  const { images: cachedImages, hasFetchedOnce, verticalIndex, setImages } = useViewerStore()

  // 检查是否有缓存状态，启用状态恢复模式
  const enableStateRecovery = hasViewerCache()
  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteImages(20, enableStateRecovery)

  // 将分页数据扁平化为一个数组
  const allImages = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data])

  // 状态同步：当获取到新数据时，更新状态管理
  useEffect(() => {
    if (allImages.length > 0) {
      setImages(allImages)
    }
  }, [allImages, setImages])

  // 优先使用缓存的图片数据，如果没有缓存则使用新获取的数据
  const displayImages = useMemo(() => {
    if (hasFetchedOnce && cachedImages.length > 0) {
      return cachedImages
    }
    return allImages
  }, [hasFetchedOnce, cachedImages, allImages])

  // 错误状态
  if (isError) {
    return <PageError content={error?.message || '无法加载图片数据，请检查网络连接'}></PageError>
  }

  // 初始加载状态 - 只有在没有缓存数据时才显示加载状态
  if (isLoading && !data && !hasFetchedOnce) {
    return <PageLoading></PageLoading>
  }

  // 无数据状态
  if (!displayImages.length) {
    return <PageNoData></PageNoData>
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-black relative">
      {/* 返回按钮 - 仅在PC端显示 */}
      <button
        className="absolute top-0 left-0 w-16 py-4 z-50 cursor-pointer bg-black/40 text-white rounded-full items-center justify-center hover:bg-black/60 transition-colors md:flex hidden"
        onClick={() => router.back()}
      >
        <ChevronLeftIcon className="w-5 h-5" />
      </button>

      {/* 移动端返回按钮 - 手势区域 */}
      <div
        className="absolute top-0 left-0 w-16 py-4 z-50 md:hidden flex items-center justify-center"
        onClick={() => router.back()}
      >
        <ChevronLeftIcon className="w-10 h-10 text-white" />
      </div>

      {/* 沉浸式图片浏览器 */}
      <ImmersiveImageViewer
        initialImages={displayImages}
        initialIndex={verticalIndex}
        onLoadMore={fetchNextPage}
        hasMore={!!hasNextPage}
        isLoading={isLoading}
      />
    </main>
  )
}
