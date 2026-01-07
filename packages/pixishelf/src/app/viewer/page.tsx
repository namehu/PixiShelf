'use client'

import ImmersiveImageViewer from './_components/ImmersiveImageViewer'
import { useEffect } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import PageNoData from './_components/PageNoData'
import PageLoading from './_components/PageLoading'
import PageError from './_components/PageError'
import { useViewerStore } from '@/store/viewerStore'
import { useShallow } from 'zustand/react/shallow'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { EMediaType } from '@/enums/EMediaType'

/**
 * 沉浸式图片浏览页面
 * 提供类似抖音/TikTok的全屏图片浏览体验
 * 集成状态管理，支持浏览位置恢复
 */
export default function ViewerPage() {
  const router = useRouter()
  const trpc = useTRPC()

  // 状态管理
  const { images, setImages, maxImageCount, mediaType, hasHydrated } = useViewerStore(
    useShallow((state) => ({
      images: state.images,
      setImages: state.setImages,
      maxImageCount: state.maxImageCount,
      mediaType: state.mediaType,
      hasHydrated: state.hasHydrated
    }))
  )

  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteQuery(
    trpc.artwork.random.infiniteQueryOptions(
      {
        count: maxImageCount,
        mediaType: mediaType as EMediaType,
        pageSize: 20
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
        initialCursor: 1, // 初始页码
        // 缓存配置 - 根据是否启用状态恢复调整缓存时间
        staleTime: 10 * 60 * 1000, // 状态恢复模式：10分钟内数据保持新鲜
        gcTime: 15 * 60 * 1000, // 状态恢复模式：15分钟后清理缓存
        retry: 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        // 仅在持久化设置完成复原后才进行首次请求，避免“默认值 → 持久化值”触发的双请求
        enabled: hasHydrated
      }
    )
  )

  useEffect(() => {
    // 将分页数据扁平化为一个数组
    const imgs = data?.pages.flatMap((page) => page.items) ?? []
    if (!imgs.length) {
      return
    }
    setImages(imgs)
  }, [data])

  // 错误状态
  if (isError) {
    return <PageError content={error?.message || '无法加载图片数据，请检查网络连接'} />
  }

  // 初始加载状态 - 只有在没有缓存数据时才显示加载状态
  if (isLoading && !data) {
    return <PageLoading />
  }

  // 无数据状态
  if (!images.length) {
    return <PageNoData />
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
        initialImages={images}
        onLoadMore={fetchNextPage}
        hasMore={!!hasNextPage}
        isLoading={isLoading}
      />
    </main>
  )
}
