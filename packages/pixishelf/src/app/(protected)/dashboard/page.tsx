import { getRecommendedArtworks, getRecentArtworks, getRecentArtists } from './lib/data'
import UserMenu from './_components/UserMenu'
import MainNavigation from './_components/MainNavigation'
import RecommendedArtworks from './_components/RecommendedArtworks'
import RecentArtworks from './_components/RecentArtworks'
import RecentArtists from './_components/RecentArtists'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 仪表板页面组件
 */
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recommendedArtworks, recentArtworks, recentArtists] = await Promise.allSettled([
    getRecommendedArtworks(),
    getRecentArtworks(),
    getRecentArtists()
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
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-6">
              <h1 className="text-xl font-bold text-gray-900">Pixishelf</h1>
              <MainNavigation />
            </div>

            <div className="flex items-center">
              <UserMenu />
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <RecommendedArtworks initialData={recommendedData} />
        <RecentArtworks data={recentArtworksData} error={recentArtworksError} />
        <RecentArtists data={recentArtistsData} error={recentArtistsError} />
      </main>
    </div>
  )
}
