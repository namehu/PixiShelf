'use client'

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { parseAsString, useQueryState } from 'nuqs'
import { SearchIcon } from 'lucide-react'
import type { ArtistsQuery } from '@/types'
import { useTRPC } from '@/lib/trpc'
import useInfiniteScroll from '@/hooks/use-infinite-scroll'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PageState } from '@/components/layout/page-state'
import { Skeleton } from '@/components/ui/skeleton'
import ArtistsNavigation from './_components/artists-navigation'
import { ArtistCard } from './_components/artist-card'

function ArtistsPageContent() {
  const [searchTerm] = useQueryState('search', parseAsString.withDefault('').withOptions({ history: 'replace' }))
  const [sortBy] = useQueryState('sortBy', parseAsString.withDefault('name_asc').withOptions({ history: 'replace' }))
  const trpc = useTRPC()

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    trpc.artist.queryPage.infiniteQueryOptions(
      { search: searchTerm, sortBy: sortBy as ArtistsQuery['sortBy'] },
      {
        getNextPageParam: ({ nextCursor }) => nextCursor,
        initialCursor: 1,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000
      }
    )
  )

  const allArtists = useMemo(() => data?.pages.flatMap((page) => page.data) || [], [data])
  const totalCount = data?.pages[0]?.pagination.total || 0

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const { targetRef } = useInfiniteScroll({
    onLoadMore: handleLoadMore,
    hasMore: !!hasNextPage,
    loading: isFetchingNextPage || isLoading
  })

  return (
    <PageContainer size="gallery" className="flex flex-col gap-8 py-6 sm:py-8">
      <PageHeader
        eyebrow="创作者索引"
        title="艺术家"
        description="按名称或作品数量浏览收藏中的创作者。"
        metadata={isLoading ? '正在统计…' : `${totalCount} 位艺术家`}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="aspect-[16/9] w-full rounded-lg" />
              <Skeleton className="ml-3 h-5 w-2/3" />
              <Skeleton className="ml-3 h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <PageState
          variant="error"
          headingLevel="h2"
          title="艺术家加载失败"
          description="当前无法读取艺术家索引，请稍后重试。"
        />
      ) : allArtists.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {allArtists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </div>
      ) : (
        <PageState
          variant="empty"
          headingLevel="h2"
          icon={<SearchIcon aria-hidden="true" />}
          title={searchTerm ? '没有匹配的艺术家' : '暂无艺术家'}
          description={searchTerm ? '尝试更换关键词。' : '导入带有创作者信息的作品后，这里会建立艺术家索引。'}
        />
      )}

      {hasNextPage && (
        <div ref={targetRef} className="flex min-h-16 items-center justify-center text-sm text-muted-foreground">
          {isFetchingNextPage ? '正在加载更多…' : '继续向下浏览'}
        </div>
      )}
    </PageContainer>
  )
}

export default function Page() {
  return (
    <div className="min-h-dvh bg-background">
      <ArtistsNavigation />
      <main>
        <ArtistsPageContent />
      </main>
    </div>
  )
}
