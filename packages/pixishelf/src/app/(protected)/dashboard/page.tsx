import { artworkService } from '@/services/artworkService'
import { artistService } from '@/services/artist-service'
import RecommendedArtworks from './_components/RecommendedArtworks'
import RecentArtworks from './_components/RecentArtworks'
import RecentArtists from './_components/RecentArtists'

export const dynamic = 'force-dynamic'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 仪表板页面组件
 */
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recommendedArtworks, recentArtworks, recentArtists] = await Promise.all([
    artworkService.getRecommendedArtworks({ pageSize: 10 }), // 获取推荐作品数据
    artworkService.getRecentArtworks({ page: 1, pageSize: 10 }), // 获取最新作品数据
    artistService.getRecentArtists({ page: 1, pageSize: 10 }) // 获取热门艺术家数据
  ])

  return (
    <>
      <RecommendedArtworks data={recommendedArtworks} />
      <RecentArtworks data={recentArtworks} />
      <RecentArtists data={recentArtists} />
    </>
  )
}
