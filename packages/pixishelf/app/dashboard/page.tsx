import { Suspense } from 'react'
import { getDashboardRecentArtworks, getRecommendedArtworks } from '@/services/artwork-service'
import { getDashboardArtists } from '@/services/artist-service'
import RecentArtists from './_components/recent-artists'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'
import ArtworkGrid from './_components/artwork-grid'
import { Button } from '@/components/ui/button'
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
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
      {label}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">最新作品</h3>
              <p className="text-gray-600">发现最新上传的精彩作品</p>
            </div>
            <Link href={ROUTES.ARTWORKS}>
              <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
                查看全部 →
              </Button>
            </Link>
          </div>

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
      </main>
    </div>
  )
}
