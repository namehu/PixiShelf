import { Suspense } from 'react'
import { getDashboardRecentArtworks, getRecommendedArtworks } from '@/services/artwork-service'
import { getDashboardArtists } from '@/services/artist-service'
import RecentArtists from './_components/recent-artists'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'
import ArtworkGrid from './_components/artwork-grid'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/page-container'
import { PageState } from '@/components/layout/page-state'
import { SectionHeader } from '@/components/layout/section-header'
import RecommendedArtworkSection from './_components/recommended-artwork-section'

// export const dynamic = 'force-dynamic'
export const revalidate = 300

/**
 * 仪表板页面组件
 */
async function RecentArtworkGrid() {
  const recentArtworks = await getDashboardRecentArtworks({ pageSize: 10 })
  return <ArtworkGrid initialData={recentArtworks} />
}

async function DashboardArtists() {
  const dashboardArtists = await getDashboardArtists({ pageSize: 12, previewArtworkSize: 3 })
  return <RecentArtists data={dashboardArtists} />
}

async function RecommendedArtworks() {
  const recommendedArtworks = await getRecommendedArtworks({ pageSize: 20 })
  return <RecommendedArtworkSection initialData={recommendedArtworks} />
}

function SectionFallback({ label }: { label: string }) {
  return <PageState variant="loading" headingLevel="h3" compact title={label} />
}

export default function DashboardPage() {
  return (
    <div className="min-h-dvh bg-background">
      <PageContainer as="main" size="standard" className="py-8">
        <div className="mb-12">
          <SectionHeader
            className="mb-6"
            title="最新作品"
            description="发现最新上传的精彩作品"
            actions={
              <Button asChild variant="ghost">
                <Link href={ROUTES.ARTWORKS}>查看全部 →</Link>
              </Button>
            }
          />

          <Suspense fallback={<SectionFallback label="正在加载最新作品…" />}>
            <RecentArtworkGrid />
          </Suspense>
        </div>

        <Suspense fallback={<SectionFallback label="正在加载艺术家…" />}>
          <DashboardArtists />
        </Suspense>

        <Suspense fallback={<SectionFallback label="正在加载推荐作品…" />}>
          <RecommendedArtworks />
        </Suspense>
      </PageContainer>
    </div>
  )
}
