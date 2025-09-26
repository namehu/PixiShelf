import { artworkService } from '@/services/artworkService'
import { artistService } from '@/services/artistService'
import MainNavigation from './_components/MainNavigation'
import RecommendedArtworks from './_components/RecommendedArtworks'
import RecentArtworks from './_components/RecentArtworks'
import RecentArtists from './_components/RecentArtists'
import PNav from '@/components/layout/PNav'

export const dynamic = 'force-dynamic'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 仪表板页面组件
 */
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recommendedArtworks, recentArtworks, recentArtists] = await Promise.allSettled([
    artworkService.getRecommendedArtworks({ pageSize: 10 }), // 获取推荐作品数据
    artworkService.getRecentArtworks({ page: 1, pageSize: 10 }), // 获取最新作品数据
    artistService.getRecentArtists({ page: 1, pageSize: 10 }) // 获取热门艺术家数据
  ])

  // 处理数据获取结果
  const recommendedData =
    recommendedArtworks.status === 'fulfilled'
      ? recommendedArtworks.value
      : { items: [], total: 0, page: 1, pageSize: 10 }
  const recentArtworksData =
    recentArtworks.status === 'fulfilled' ? recentArtworks.value : { items: [], total: 0, page: 1, pageSize: 10 }
  const recentArtistsData =
    recentArtists.status === 'fulfilled' ? recentArtists.value : { items: [], total: 0, page: 1, pageSize: 10 }

  // 处理错误信息
  const recentArtworksError =
    recentArtworks.status === 'rejected' ? recentArtworks.reason?.message || '获取作品失败' : null
  const recentArtistsError =
    recentArtists.status === 'rejected' ? recentArtists.reason?.message || '获取艺术家失败' : null

  return (
    <>
      <RecommendedArtworks initialData={recommendedData} />
      <RecentArtworks data={recentArtworksData} error={recentArtworksError} />
      <RecentArtists data={recentArtistsData} error={recentArtistsError} />
    </>
  )
}
