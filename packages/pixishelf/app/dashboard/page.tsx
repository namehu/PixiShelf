import { getRecommendedArtworks, getRecentArtworks } from '@/services/artwork-service'
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
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recentArtworks, dashboardArtists, recommendedArtworks] = await Promise.all([
    getRecentArtworks({ page: 1, pageSize: 10 }), // 获取最新作品数据
    getDashboardArtists({ pageSize: 12, previewArtworkSize: 3 }), // 获取随机艺术家卡片数据
    getRecommendedArtworks({ pageSize: 20 }) // 获取推荐作品数据
  ])

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

          <ArtworkGrid initialData={recentArtworks} />
        </div>

        <RecentArtists data={dashboardArtists} />

        <RecommendedArtworkSection initialData={recommendedArtworks} />
      </main>
    </div>
  )
}
