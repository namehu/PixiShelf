'use client'

import { useQuery } from '@tanstack/react-query'
import ArtworkCard from '@/components/artwork/artwork-card'
import { useAuthUser } from '@/components/auth'
import { PageState } from '@/components/layout/page-state'
import { SectionHeader } from '@/components/layout/section-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useArtworkDisplayMode } from '@/components/user-setting'
import { useTRPCClient } from '@/lib/trpc'
import { cn } from '@/lib/utils'

export default function ContinueReadingSection() {
  const ownerUserId = useAuthUser()?.id ?? null
  const displayMode = useArtworkDisplayMode()
  const client = useTRPCClient()
  const reading = useQuery({
    queryKey: ['reading', 'continueReading', ownerUserId],
    enabled: Boolean(ownerUserId),
    queryFn: ({ signal }) => client.reading.continueReading.query({ expectedUserId: ownerUserId ?? '' }, { signal }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true
  })

  if (!ownerUserId || (reading.isSuccess && reading.data.items.length === 0)) return null

  const shelfClassName = cn(
    'custom-scrollbar -mx-1 grid snap-x snap-proximity grid-flow-col auto-cols-[42%] overflow-x-auto overscroll-x-contain px-1 py-1',
    displayMode === 'minimal'
      ? 'gap-0.5 sm:auto-cols-[calc((100%_-_6px)/4)] lg:auto-cols-[calc((100%_-_10px)/6)]'
      : 'gap-4 sm:auto-cols-[calc((100%_-_3rem)/4)] lg:auto-cols-[calc((100%_-_5rem)/6)]'
  )

  return (
    <section aria-labelledby="dashboard-continue-reading-heading" className="mb-12 min-w-0">
      <SectionHeader
        className="mb-5"
        title={<span id="dashboard-continue-reading-heading">继续阅读</span>}
        description="接着上次的位置，继续尚未读完的作品。"
      />

      {reading.isError ? (
        <PageState
          variant="error"
          compact
          headingLevel="h3"
          title="继续阅读加载失败"
          description="暂时无法获取阅读进度，请重试。"
          action={
            <Button type="button" variant="outline" disabled={reading.isFetching} onClick={() => void reading.refetch()}>
              {reading.isFetching ? '正在重试…' : '重试'}
            </Button>
          }
        />
      ) : reading.isPending ? (
        <div role="status" aria-label="正在加载继续阅读">
          <div className={shelfClassName} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="min-w-0 snap-start">
                <Skeleton className={cn('aspect-[3/4] w-full', displayMode === 'minimal' && 'rounded-none')} />
                {displayMode !== 'minimal' && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ul aria-label="继续阅读作品" className={shelfClassName}>
          {reading.data.items.map(({ artwork, reading: summary }, index) => (
            <li key={artwork.id} className="min-w-0 snap-start">
              <ArtworkCard
                artwork={artwork}
                reading={summary}
                showReadingStatus
                displayMode={displayMode}
                priority={index < 2}
                href={`/artworks/${artwork.id}?resume=1`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
