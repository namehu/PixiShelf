'use client'

import ImmersiveImageViewer from './_components/ImmersiveImageViewer'
import { useEffect, useMemo, useRef } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import PageNoData from './_components/PageNoData'
import PageLoading from './_components/PageLoading'
import PageError from './_components/PageError'
import { useViewerStore } from '@/store/viewerStore'
import { useShallow } from 'zustand/react/shallow'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { EMediaType } from '@/enums/EMediaType'

type ViewerSource = 'all' | 'artist' | 'tag'
type ViewerMode = 'ordered' | 'random'

const viewerQueryParsers = {
  source: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
  sourceId: parseAsInteger,
  mode: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace', clearOnDefault: true }),
  randomSeed: parseAsInteger,
  search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  mediaType: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  startDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  endDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
}

/**
 * 沉浸式图片浏览页面
 * 提供类似抖音/TikTok的全屏图片浏览体验
 * 集成状态管理，支持浏览位置恢复
 */
export default function ViewerPage() {
  const router = useRouter()
  const [viewerQuery] = useQueryStates(viewerQueryParsers)
  const trpc = useTRPC()
  const defaultRandomSeedRef = useRef(Math.floor(Math.random() * 1000000))

  // 状态管理
  const { images, setImages, resetViewerState, maxImageCount, mediaType, hasHydrated, setChromeHidden } =
    useViewerStore(
      useShallow((state) => ({
        images: state.images,
        setImages: state.setImages,
        resetViewerState: state.resetViewerState,
        maxImageCount: state.maxImageCount,
        mediaType: state.mediaType,
        hasHydrated: state.hasHydrated,
        setChromeHidden: state.setChromeHidden
      }))
    )

  const feedInput = useMemo(() => {
    const rawSource = viewerQuery.source
    const sourceId = viewerQuery.sourceId ?? undefined
    const hasValidSourceId = typeof sourceId === 'number' && Number.isFinite(sourceId) && sourceId > 0
    const source: ViewerSource =
      rawSource === 'artist' || rawSource === 'tag' ? (hasValidSourceId ? rawSource : 'all') : 'all'
    const requestedMode = viewerQuery.mode
    const mode: ViewerMode =
      requestedMode === 'ordered' || requestedMode === 'random'
        ? requestedMode
        : source === 'all'
          ? 'random'
          : 'ordered'
    const randomSeed = viewerQuery.randomSeed ?? defaultRandomSeedRef.current
    const requestedMediaType = viewerQuery.mediaType
    const effectiveMediaType = Object.values(EMediaType).includes(requestedMediaType as EMediaType)
      ? (requestedMediaType as EMediaType)
      : mediaType

    return {
      source,
      sourceId: source === 'all' ? undefined : sourceId,
      mode,
      sortBy: viewerQuery.sortBy || 'source_date_desc',
      randomSeed: mode === 'random' && Number.isFinite(randomSeed) ? randomSeed : undefined,
      search: viewerQuery.search || undefined,
      mediaType: effectiveMediaType,
      startDate: viewerQuery.startDate || undefined,
      endDate: viewerQuery.endDate || undefined,
      mediaCountMax: maxImageCount,
      pageSize: 20
    }
  }, [maxImageCount, mediaType, viewerQuery])

  const feedKey = useMemo(() => JSON.stringify(feedInput), [feedInput])

  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteQuery(
    trpc.artwork.viewerFeed.infiniteQueryOptions(
      feedInput,
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
    resetViewerState()
  }, [feedKey, resetViewerState])

  useEffect(() => {
    // 将分页数据扁平化为一个数组
    const imgs = data?.pages.flatMap((page) => page.items) ?? []
    setImages(imgs)
  }, [data, setImages])

  useEffect(() => {
    setChromeHidden(false)
    return () => setChromeHidden(false)
  }, [setChromeHidden])

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
