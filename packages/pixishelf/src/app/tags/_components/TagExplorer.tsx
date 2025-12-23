'use client'
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Shuffle, TrendingUp, Grid, Sparkles, RefreshCw, Loader2 } from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { TagUniverseView } from './TagUniverseView'
import { TagItem } from './TagItem'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '.'
import { PaginatedResponse, Tag } from '@/types'
import { useRouter } from 'next/navigation'

export type ViewMode = 'universe' | 'grid'

// --- API 请求逻辑 ---
const fetchTagsApi = async ({ pageParam = 1, mode = 'popular', query = '' }) => {
  const pageSize = 48
  let url = ''

  if (query) {
    const params = new URLSearchParams({
      q: query,
      page: pageParam.toString(),
      pageSize: pageSize.toString(),
      sort: 'relevance',
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else if (mode === 'popular') {
    const params = new URLSearchParams({
      page: pageParam.toString(),
      pageSize: pageSize.toString(),
      sort: 'artworkCount',
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else {
    const params = new URLSearchParams({
      pageSize: pageSize.toString(),
      minCount: '0',
      excludeEmpty: 'false',
      page: pageParam.toString()
    })
    url = `/api/tags/random?${params.toString()}`
  }

  const response = await fetch(url)
  const result: PaginatedResponse<Tag> = await response.json()

  if (!result.success) {
    throw new Error('获取标签失败')
  }

  const tags = result.data.data || []
  const pagination = result.data.pagination

  if (mode === 'random' && !query) {
    return {
      tags: tags,
      nextPage: tags.length > 0 ? pageParam + 1 : undefined
    }
  }

  return {
    tags: tags,
    nextPage: pagination.hasNextPage ? pagination.page + 1 : undefined
  }
}

// --- 组件实现 ---

const TagExplorer: React.FC = () => {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<ViewMode>('universe')
  const [currentTab, setCurrentTab] = useState<'popular' | 'random'>('popular')
  const [searchQuery, setSearchQuery] = useState('')

  // 控制无限滚动激活状态
  const [enableInfiniteScroll, setEnableInfiniteScroll] = useState(false)

  // 引入 Ref 记录上次请求时间，用于节流
  const lastFetchTimeRef = useRef<number>(0)

  const queryClient = useQueryClient()

  // Intersection Observer
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0.1,
    rootMargin: '100px'
  })

  // React Query
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching } = useInfiniteQuery({
    queryKey: ['tags', currentTab, searchQuery],
    queryFn: ({ pageParam }) => fetchTagsApi({ pageParam, mode: currentTab, query: searchQuery }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10
  })

  const allTags = useMemo(() => {
    return data?.pages.flatMap((page) => page.tags) ?? []
  }, [data])

  // 🔥 修复核心 1: 监听所有可能导致列表重置的状态（视图、Tab、搜索）
  // 之前的代码漏掉了 currentTab 和 searchQuery，导致切换 Tab 时“锁”没关上
  useEffect(() => {
    if (viewMode === 'grid') {
      // 1. 立即锁定滚动加载，防止旧的 inView 状态触发请求
      setEnableInfiniteScroll(false)

      // 2. 强制滚动回顶部！这是解决 Tab 切换误触的关键
      // 如果不滚动，切换 Tab 时滚动条还在底部，哨兵直接可见，就会触发下一页
      window.scrollTo({ top: 0, behavior: 'instant' })

      lastFetchTimeRef.current = Date.now()

      // 3. 延迟解锁 (500ms 等待动画和 DOM 稳定)
      const timer = setTimeout(() => {
        setEnableInfiniteScroll(true)
      }, 500)
      return () => clearTimeout(timer)
    }
    setEnableInfiniteScroll(false)
  }, [viewMode, currentTab, searchQuery]) // ✅ 必须包含这些依赖

  // 触发逻辑增加 1000ms 节流阀
  useEffect(() => {
    if (
      inView &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isLoading && // ✅ 增加 isLoading 检查，防止初始加载时触发
      viewMode === 'grid' &&
      enableInfiniteScroll &&
      allTags.length > 0
    ) {
      const now = Date.now()
      if (now - lastFetchTimeRef.current > 1000) {
        // oxlint-disable-next-line no-console
        console.log('🚀 触发加载更多:', { currentCount: allTags.length })
        fetchNextPage()
        lastFetchTimeRef.current = now
      }
    }
  }, [
    inView,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    viewMode,
    fetchNextPage,
    enableInfiniteScroll,
    allTags.length
  ])

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tags'] })
  }

  // 监听 Tab 切换，自动重置搜索框
  useEffect(() => {
    if (currentTab) {
      setSearchQuery('')
    }
  }, [currentTab])

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-100 flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-slate-200/50 bg-white/80 px-4 h-16">
        <div className="max-w-screen-xl h-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0" onClick={() => router.push('/dashboard')}>
            <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/10">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-lg tracking-tight hidden xs:block">标签宇宙</span>
          </div>

          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder="搜索灵感..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100/80 border-none rounded-xl py-2 pl-9 pr-3 text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode(viewMode === 'universe' ? 'grid' : 'universe')}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              title={viewMode === 'universe' ? '切换到网格' : '切换到宇宙'}
            >
              {viewMode === 'universe' ? <Grid className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              title="刷新"
            >
              <RefreshCw className={cn('w-5 h-5', (isLoading || isRefetching) && 'animate-spin')} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative z-10">
        <div className="max-w-screen-xl mx-auto w-full px-4 pt-6 flex flex-col items-center">
          <Tabs value={currentTab} onValueChange={(v: any) => setCurrentTab(v)}>
            <TabsList className="bg-slate-200/50 p-1 rounded-xl">
              <TabsTrigger value="popular" className="flex items-center gap-1.5 px-6 py-2">
                <TrendingUp className="w-3.5 h-3.5" />
                热门
              </TabsTrigger>
              <TabsTrigger value="random" className="flex items-center gap-1.5 px-6 py-2">
                <Shuffle className="w-3.5 h-3.5" />
                随机
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 flex flex-col min-h-[500px]">
          <AnimatePresence mode="wait">
            {viewMode === 'universe' ? (
              <motion.div
                key="universe"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full flex-1 flex items-center justify-center overflow-hidden"
              >
                <TagUniverseView tags={allTags} onTagClick={(tag) => router.push(`/tags/${tag.id}`)} />
              </motion.div>
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="max-w-screen-xl mx-auto px-4 py-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4 w-full"
              >
                {allTags.map((tag, idx) => (
                  <motion.div
                    key={`${tag.id}-${idx}`}
                    className="flex justify-center"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (idx % 24) * 0.01 }}
                  >
                    <TagItem tag={tag} onClick={() => router.push(`/tags/${tag.id}`)} />
                  </motion.div>
                ))}

                <div
                  ref={loadMoreRef}
                  className="col-span-full py-10 flex justify-center items-center gap-2 text-slate-400"
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                      <span className="text-sm">正在加载更多...</span>
                    </>
                  ) : hasNextPage ? (
                    <span className="text-xs uppercase tracking-widest opacity-30">向上滑动探索更多</span>
                  ) : (
                    <span className="text-xs uppercase tracking-widest opacity-30">我也是有底线的</span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isLoading && !allTags.length && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
              <div className="bg-white px-6 py-4 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span className="text-sm font-bold text-slate-600">加载中...</span>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-8 px-4 border-t border-slate-100 bg-white">
        <div className="max-w-screen-xl mx-auto flex flex-col items-center gap-4">
          <div className="flex gap-10">
            <div className="text-center">
              <p className="text-xl font-black text-slate-900">{allTags.length}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-tighter">发现标签</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-slate-900">∞</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-tighter">无限可能</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default TagExplorer
