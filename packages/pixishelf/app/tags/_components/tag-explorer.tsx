'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'
import { GridIcon, RefreshCwIcon, SearchIcon, ShuffleIcon, SparklesIcon, TrendingUpIcon } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import type { Tag } from '@/types'
import { getTranslateName } from '@/utils/tags'
import { cn } from '@/lib/utils'
import PageToolbar from '@/components/layout/page-toolbar'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PageState } from '@/components/layout/page-state'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TagUniverseView } from './tag-universe-view'
import { TagItem } from './tag-item'

export type ViewMode = 'universe' | 'grid'

function SearchResultRow({ tag }: { tag: Tag }) {
  const translatedName = getTranslateName(tag)

  return (
    <article className="grid gap-2 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">
          <Link href={`/tags/${tag.id}`} className="outline-none hover:text-primary focus-visible:text-primary">
            {tag.name}
          </Link>
        </h2>
        {translatedName && <p className="mt-1 text-xs text-muted-foreground">{translatedName}</p>}
        {tag.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{tag.description}</p>
        )}
      </div>
      <span className="font-utility text-xs text-muted-foreground">{tag.artworkCount} 件作品</span>
    </article>
  )
}

export default function TagExplorer() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('universe')
  const [currentTab, setCurrentTab] = useState<'popular' | 'random'>('popular')
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim()
  const isSearching = normalizedSearchQuery.length > 0
  const [enableInfiniteScroll, setEnableInfiniteScroll] = useState(false)
  const lastFetchTimeRef = useRef(0)
  const { ref: loadMoreRef, inView } = useInView({ threshold: 0.1, rootMargin: '100px' })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching, isError, refetch } =
    useInfiniteQuery(
      trpc.tag.list.infiniteQueryOptions(
        isSearching ? { pageSize: 100, query: normalizedSearchQuery } : { pageSize: 100, mode: currentTab },
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          initialCursor: 1,
          staleTime: 1000 * 60 * 5,
          gcTime: 1000 * 60 * 10
        }
      )
    )

  const allTags = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  useEffect(() => {
    if (isSearching || viewMode === 'grid') {
      setEnableInfiniteScroll(false)
      window.scrollTo({ top: 0, behavior: 'instant' })
      lastFetchTimeRef.current = Date.now()
      const timer = setTimeout(() => setEnableInfiniteScroll(true), 500)
      return () => clearTimeout(timer)
    }
    setEnableInfiniteScroll(false)
  }, [currentTab, isSearching, normalizedSearchQuery, viewMode])

  useEffect(() => {
    if (
      inView &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isLoading &&
      (isSearching || viewMode === 'grid') &&
      enableInfiniteScroll &&
      allTags.length > 0 &&
      Date.now() - lastFetchTimeRef.current > 1000
    ) {
      fetchNextPage()
      lastFetchTimeRef.current = Date.now()
    }
  }, [
    allTags.length,
    enableInfiniteScroll,
    fetchNextPage,
    hasNextPage,
    inView,
    isFetchingNextPage,
    isLoading,
    isSearching,
    viewMode
  ])

  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar
        containerSize="gallery"
        actions={
          <>
            {!isSearching && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setViewMode(viewMode === 'universe' ? 'grid' : 'universe')}
                aria-label={viewMode === 'universe' ? '切换到标签网格' : '切换到标签流'}
              >
                {viewMode === 'universe' ? (
                  <GridIcon data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <SparklesIcon data-icon="inline-start" aria-hidden="true" />
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: trpc.tag.list.queryKey() })}
              aria-label="刷新标签"
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn((isLoading || isRefetching) && 'animate-spin')}
                aria-hidden="true"
              />
            </Button>
          </>
        }
      >
        <InputGroup className="max-w-xl">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            name="tag-search"
            autoComplete="off"
            placeholder="搜索标签…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="搜索标签"
          />
        </InputGroup>
      </PageToolbar>

      <main>
        <PageContainer size="gallery" className="flex flex-col gap-7 py-6 sm:py-8">
          <PageHeader
            eyebrow="收藏分类"
            title="标签"
            description="从高频主题进入作品，也可以切换为流动索引随机探索。"
            metadata={`当前已加载 ${allTags.length} 个标签`}
            actions={
              !isSearching ? (
                <Tabs value={currentTab} onValueChange={(value) => setCurrentTab(value as 'popular' | 'random')}>
                  <TabsList>
                    <TabsTrigger value="popular">
                      <TrendingUpIcon aria-hidden="true" />
                      热门
                    </TabsTrigger>
                    <TabsTrigger value="random">
                      <ShuffleIcon aria-hidden="true" />
                      随机
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : undefined
            }
          />

          {isLoading && allTags.length === 0 ? (
            <PageState variant="loading" headingLevel="h2" title="正在整理标签" description="正在建立收藏分类索引。" />
          ) : isError ? (
            <PageState
              variant="error"
              headingLevel="h2"
              title="标签加载失败"
              description="当前无法读取标签索引，请稍后重试。"
              action={
                <Button type="button" variant="outline" onClick={() => refetch()}>
                  重试
                </Button>
              }
            />
          ) : isSearching ? (
            <section className="mx-auto w-full max-w-reading">
              <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-utility text-xs font-medium tracking-[0.08em] text-primary uppercase">搜索结果</p>
                  <p className="mt-1 break-all text-lg font-semibold text-foreground">{normalizedSearchQuery}</p>
                </div>
                <span className="font-utility text-xs text-muted-foreground">{allTags.length} 个结果</span>
              </header>

              {allTags.length > 0 ? (
                allTags.map((tag) => <SearchResultRow key={tag.id} tag={tag} />)
              ) : (
                <PageState
                  variant="empty"
                  compact
                  headingLevel="h2"
                  title="没有匹配的标签"
                  description="尝试更换关键词。"
                />
              )}
              <div
                ref={loadMoreRef}
                className="flex min-h-16 items-center justify-center text-sm text-muted-foreground"
              >
                {isFetchingNextPage
                  ? '正在加载更多…'
                  : hasNextPage
                    ? '继续向下浏览'
                    : allTags.length
                      ? '已显示全部结果'
                      : null}
              </div>
            </section>
          ) : allTags.length === 0 ? (
            <PageState
              variant="empty"
              headingLevel="h2"
              title="暂无标签"
              description="导入带有标签信息的作品后，这里会建立分类索引。"
            />
          ) : viewMode === 'universe' ? (
            <section
              aria-label="流动标签索引"
              className="min-h-[clamp(26rem,60dvh,44rem)] overflow-hidden border-y border-border"
            >
              <TagUniverseView tags={allTags} />
            </section>
          ) : (
            <section
              aria-label="标签网格"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              {allTags.map((tag) => (
                <TagItem key={tag.id} tag={tag} />
              ))}
              <div
                ref={loadMoreRef}
                className="col-span-full flex min-h-16 items-center justify-center text-sm text-muted-foreground"
              >
                {isFetchingNextPage ? '正在加载更多…' : hasNextPage ? '继续向下浏览' : '已显示全部标签'}
              </div>
            </section>
          )}
        </PageContainer>
      </main>
    </div>
  )
}
