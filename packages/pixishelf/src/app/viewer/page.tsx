'use client'

import { useInfiniteImages } from '@/hooks/useInfiniteImages'
import ImmersiveImageViewer from './_components/ImmersiveImageViewer'
import { useMemo } from 'react'
import { ArrowLeft, ChevronLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import CommonErrorPage from '@/components/common/CommonErrorPage'
import PageNoData from './_components/PageNoData'
import PageLoading from './_components/PageLoading'

/**
 * 沉浸式图片浏览页面
 * 提供类似抖音/TikTok的全屏图片浏览体验
 */
export default function ViewerPage() {
  const router = useRouter()
  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteImages(20) // 每页加载10张图片

  // 将分页数据扁平化为一个数组
  const allImages = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data])

  // 错误状态
  if (isError) {
    return <CommonErrorPage content={error?.message || '无法加载图片数据，请检查网络连接'}></CommonErrorPage>
  }

  // 初始加载状态
  if (isLoading && !data) {
    return <PageLoading></PageLoading>
  }

  // 无数据状态
  if (!allImages.length) {
    return <PageNoData></PageNoData>
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-black relative">
      {/* 返回按钮 - 仅在PC端显示 */}
      <button
        onClick={() => router.back()}
        className="absolute top-4 left-4 z-50 w-10 h-10 bg-black/40 text-white rounded-full flex items-center justify-center hover:bg-black/60 transition-colors md:flex hidden"
        aria-label="返回"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      {/* 沉浸式图片浏览器 */}
      <ImmersiveImageViewer
        initialImages={allImages}
        onLoadMore={fetchNextPage}
        hasMore={!!hasNextPage}
        isLoading={isLoading}
      />

      {/* 移动端返回按钮 - 手势区域 */}
      <div
        className="absolute top-0 left-0 w-16 py-4 z-50 md:hidden flex items-center justify-center"
        onClick={() => router.back()}
      >
        <ChevronLeftIcon className="w-10 h-10 text-white" />
      </div>
    </main>
  )
}
