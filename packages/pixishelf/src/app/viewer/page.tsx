'use client'

import { useInfiniteImages } from '@/hooks/useInfiniteImages'
import ImmersiveImageViewer from '@/components/immersive/ImmersiveImageViewer'
import { useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

/**
 * 沉浸式图片浏览页面
 * 提供类似抖音/TikTok的全屏图片浏览体验
 */
export default function ViewerPage() {
  const router = useRouter()
  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteImages(10) // 每页加载10张图片

  // 将分页数据扁平化为一个数组
  const allImages = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data])

  // 错误状态
  if (isError) {
    return (
      <main className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">加载失败</h2>
          <p className="text-sm opacity-60 mb-4">{error?.message || '无法加载图片数据，请检查网络连接'}</p>
          <div className="space-x-4">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => router.back()}
              className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </main>
    )
  }

  // 初始加载状态
  if (isLoading && !data) {
    return (
      <main className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="mb-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          </div>
          <p className="text-lg font-medium mb-2">正在加载图片...</p>
          <p className="text-sm opacity-60">请稍候</p>
        </div>
      </main>
    )
  }

  // 无数据状态
  if (!allImages.length) {
    return (
      <main className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">暂无图片</h2>
          <p className="text-sm opacity-60 mb-4">当前没有可浏览的图片内容</p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            返回
          </button>
        </div>
      </main>
    )
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
      <div className="absolute top-0 left-0 w-16 h-16 md:hidden" onClick={() => router.back()} />
    </main>
  )
}
