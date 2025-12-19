'use client'
import React, { useState, useMemo, useEffect } from 'react'
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
  const pageSize = 24
  let url = ''

  // 1. 构建 URL 和参数
  if (query) {
    // A. 搜索模式
    const params = new URLSearchParams({
      q: query,
      page: pageParam.toString(),
      limit: pageSize.toString(),
      sort: 'relevance',
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else if (mode === 'popular') {
    // B. 热门模式
    const params = new URLSearchParams({
      page: pageParam.toString(),
      limit: pageSize.toString(),
      sort: 'artworkCount',
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else {
    // C. 随机模式
    const params = new URLSearchParams({
      limit: pageSize.toString(),
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

  // 2. 适配返回数据给 React Query
  const tags = result.data.data || []
  const pagination = result.data.pagination

  // 特殊处理随机模式的分页逻辑
  if (mode === 'random' && !query) {
    return {
      tags: tags,
      // 随机模式下，只要有数据返回，就允许加载下一页 (无限滚动体验)
      nextPage: tags.length > 0 ? pageParam + 1 : undefined
    }
  }

  // 标准分页逻辑 (搜索/热门)
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
  const queryClient = useQueryClient()

  // Intersection Observer 用于无限滚动
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0.1,
    rootMargin: '200px' // 提前加载优化体验
  })

  // React Query 无限查询
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching } = useInfiniteQuery({
    queryKey: ['tags', currentTab, searchQuery],
    queryFn: ({ pageParam }) => fetchTagsApi({ pageParam, mode: currentTab, query: searchQuery }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    // 保持数据新鲜度，避免频繁刷新 (5分钟)
    staleTime: 1000 * 60 * 5,
    // 切换 Tab 时不保留旧数据，避免闪烁混杂
    gcTime: 1000 * 60 * 10
  })

  // 扁平化所有页面的标签数据
  const allTags = useMemo(() => {
    return data?.pages.flatMap((page) => page.tags) ?? []
  }, [data])

  // 触发无限加载
  useEffect(() => {
    // 仅在网格视图下启用无限滚动
    if (inView && hasNextPage && !isFetchingNextPage && viewMode === 'grid') {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, viewMode, fetchNextPage])

  const handleRefresh = () => {
    // 强制刷新当前视图的数据
    queryClient.invalidateQueries({ queryKey: ['tags'] })
  }

  // 监听 Tab 切换，自动重置搜索框（可选）
  useEffect(() => {
    setSearchQuery('')
  }, [currentTab])

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-blue-100 flex flex-col">
      {/* --- Header 区域 --- */}
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-slate-200/50 bg-white/80 px-4 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
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

      {/* --- Main Content --- */}
      <main className="flex-1 flex flex-col relative z-10">
        {/* 顶部 Tab 切换 */}
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

        {/* 内容展示区 */}
        <div className="flex-1 flex flex-col min-h-[500px]">
          <AnimatePresence mode="wait">
            {viewMode === 'universe' ? (
              // 宇宙视图 (3D球体)
              <motion.div
                key="universe"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full flex-1 flex items-center justify-center overflow-hidden"
              >
                {/* 仅传递前 100 个标签给 3D 视图以保证性能 */}
                <TagUniverseView tags={allTags.slice(0, 100)} onTagClick={(tag) => router.push(`/tags/${tag.id}`)} />
              </motion.div>
            ) : (
              // 网格视图
              <motion.div
                key="grid"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="max-w-screen-xl mx-auto px-4 py-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4 w-full"
              >
                {allTags.map((tag, idx) => (
                  <motion.div
                    // 使用组合 key 增加唯一性，防止不同页可能出现的重复 id (虽然 random 接口已尽量避免)
                    key={`${tag.id}-${idx}`}
                    className="flex justify-center"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (idx % 24) * 0.01 }}
                  >
                    <TagItem tag={tag} onClick={() => router.push(`/tags/${tag.id}`)} />
                  </motion.div>
                ))}

                {/* 底部加载状态指示器 */}
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

          {/* 初始加载时的全局 Loading */}
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

      {/* --- Footer --- */}
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
