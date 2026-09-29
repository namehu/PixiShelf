'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { BookOpenCheckIcon } from 'lucide-react'
import ArtworkCard from '@/components/artwork/artwork-card'
import { useAuthUser } from '@/components/auth'
import { PageContainer } from '@/components/layout/page-container'
import PageToolbar from '@/components/layout/page-toolbar'
import { PageState } from '@/components/layout/page-state'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTRPCClient } from '@/lib/trpc'
import type { ReadingHistoryCursor } from '@pixishelf/db/reading-contract'

export default function ReadingHistoryPage() {
  const ownerUserId = useAuthUser()?.id ?? null
  const trpcClient = useTRPCClient()
  const history = useInfiniteQuery({
    queryKey: ['reading', 'history', ownerUserId],
    initialPageParam: undefined as ReadingHistoryCursor | undefined,
    enabled: Boolean(ownerUserId),
    queryFn: ({ pageParam, signal }) => trpcClient.reading.history.query({
      expectedUserId: ownerUserId ?? '',
      pageSize: 24,
      cursor: pageParam
    }, { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor
  })
  const items = history.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar containerSize="gallery" title="最近阅读" />
      <PageContainer as="main" size="gallery" className="py-6">
        <div className="mb-6 flex items-center gap-3">
          <BookOpenCheckIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">按最近一次阅读排序，每个作品显示一条记录。</p>
        </div>
        {history.isError ? (
          <PageState variant="error" title="阅读记录加载失败" description="请稍后重试。"
            action={<Button type="button" variant="outline" onClick={() => void history.refetch()}>重试</Button>} />
        ) : history.isLoading ? (
          <div className="flex justify-center py-16" role="status"><Spinner aria-label="正在加载阅读记录" /></div>
        ) : items.length === 0 ? (
          <PageState variant="empty" title="还没有阅读记录" description="打开本地作品并浏览媒体后，记录会出现在这里。" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {items.map(({ artwork, reading }) => (
                <div key={artwork.id} className="min-w-0">
                  <ArtworkCard artwork={artwork} reading={reading} showReadingStatus />
                  {reading.lastViewedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      最近阅读：{new Date(reading.lastViewedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">阅读 {reading.viewCount} 次</p>
                </div>
              ))}
            </div>
            {history.hasNextPage ? (
              <div className="mt-8 flex justify-center">
                <Button type="button" variant="outline" disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}>
                  {history.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
                  加载更多
                </Button>
              </div>
            ) : null}
          </>
        )}
      </PageContainer>
    </div>
  )
}
