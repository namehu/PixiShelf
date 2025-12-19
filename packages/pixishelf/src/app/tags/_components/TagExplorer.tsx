'use client'
import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Shuffle, TrendingUp, Grid, Sparkles, RefreshCw, Loader2 } from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { TagUniverseView } from './TagUniverseView'
import { TagItem } from './TagItem'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '.' // 假设这是你的 UI 组件路径
import { PaginatedResponse } from '@/types'
import { useRouter } from 'next/navigation'

export type ViewMode = 'universe' | 'grid'

// 标签数据类型 (根据你的实际 Prisma 模型调整)
export interface Tag {
  id: number
  name: string
  name_zh?: string
  name_en?: string
  description?: string
  artworkCount: number
  // ... 其他字段
}

// --- API 请求逻辑 ---

const fetchTagsApi = async ({ pageParam = 1, mode = 'popular', query = '' }) => {
  const pageSize = 24
  let url = ''

  // 1. 构建 URL 和参数
  if (query) {
    // 搜索模式
    const params = new URLSearchParams({
      q: query,
      page: pageParam.toString(),
      limit: pageSize.toString(),
      sort: 'relevance',
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else if (mode === 'popular') {
    // 热门模式
    const params = new URLSearchParams({
      page: pageParam.toString(),
      limit: pageSize.toString(),
      sort: 'artworkCount', // 热门按作品数排序
      order: 'desc'
    })
    url = `/api/tags/search?${params.toString()}`
  } else {
    // 随机模式 (随机接口的响应结构可能不同，这里假设它也遵循或做适配)
    // 随机模式通常不需要分页概念，或者每次都是第一页
    const params = new URLSearchParams({
      count: pageSize.toString(),
      minCount: '0',
      excludeEmpty: 'false'
    })
    url = `/api/tags/random?${params.toString()}`
  }

  const response = await fetch(url)
  const result: PaginatedResponse<Tag> = await response.json()

  if (!result.success) {
    throw new Error('获取标签失败') // result.error 在类型定义里可能没有，视 apiHandler 实际返回而定
  }

  // 2. 适配返回数据给 React Query

  // 特殊处理：随机模式
  if (mode === 'random' && !query) {
    // 假设随机接口返回的数据结构稍有不同，这里做宽容处理
    // 如果 random 接口直接返回 { data: Tag[] }
    const randomTags = (result.data as any).tags || result.data.data || []
    return {
      tags: randomTags,
      // 随机模式始终允许下一页 (模拟无限滚动)，或者你可以设为 null 禁止滚动
      nextPage: pageParam + 1
    }
  }

  // 标准搜索/热门模式
  return {
    tags: result.data.data,
    nextPage: result.data.pagination.hasNextPage ? result.data.pagination.page + 1 : undefined
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
    rootMargin: '100px' // 提前加载
  })

  // React Query 无限查询
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching, refetch } = useInfiniteQuery({
    queryKey: ['tags', currentTab, searchQuery],
    queryFn: ({ pageParam }) => fetchTagsApi({ pageParam, mode: currentTab, query: searchQuery }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    // 保持数据新鲜度，避免频繁刷新
    staleTime: 1000 * 60 * 5
  })

  // 扁平化所有页面的标签数据
  const allTags = useMemo(() => {
    return data?.pages.flatMap((page) => page.tags) ?? []
  }, [data])

  // 触发无限加载
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage && viewMode === 'grid') {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, viewMode, fetchNextPage])

  const handleRefresh = () => {
    // 使当前查询失效并重新获取
    queryClient.invalidateQueries({ queryKey: ['tags'] })
    // refetch 会触发重新获取第一页
  }

  // 搜索防抖 (可选，简单起见这里直接用)
  // 如果输入频繁，建议使用 useDebounce

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
                    key={`${tag.id}-${idx}`} // 使用组合 key 防止潜在的 id 重复渲染问题
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
                <span className="text-sm font-bold text-slate-600">灵感加载中...</span>
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
