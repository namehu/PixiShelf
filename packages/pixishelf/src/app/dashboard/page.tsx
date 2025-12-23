import { getRecommendedArtworks, getRecentArtworks } from '@/services/artwork-service'
import { getRecentArtists } from '@/services/artist-service'
import RecommendedArtworks from './_components/RecommendedArtworks'
import RecentArtworks from './_components/RecentArtworks'
import RecentArtists from './_components/RecentArtists'
import PNav from '@/components/layout/PNav'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'
import { HashIcon, ImageIcon, ImageUpIcon, UsersIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * 仪表板页面组件
 */
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recommendedArtworks, recentArtworks, recentArtists] = await Promise.all([
    getRecommendedArtworks({ pageSize: 10 }), // 获取推荐作品数据
    getRecentArtworks({ page: 1, pageSize: 10 }), // 获取最新作品数据
    getRecentArtists({ page: 1, pageSize: 10 }) // 获取热门艺术家数据
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      <PNav>
        <div className="flex gap-4">
          <Link href={ROUTES.GALLERY} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
            <ImageIcon className="h-5 w-5" />
            <span className="hidden sm:inline">作品</span>
          </Link>
          <Link href={ROUTES.ARTISTS} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
            <UsersIcon className="h-5 w-5" />
            <span className="hidden sm:inline">艺术家</span>
          </Link>
          <Link href={ROUTES.TAGS} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
            <HashIcon className="h-5 w-5" />
            <span className="hidden sm:inline">标签</span>
          </Link>
          <Link href={ROUTES.VIEWER} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
            <ImageUpIcon className="h-5 w-5" />
            <span className="hidden sm:inline">刷图</span>
          </Link>
        </div>
      </PNav>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <RecentArtworks data={recentArtworks} />
        <RecentArtists data={recentArtists} />
        <RecommendedArtworks data={recommendedArtworks} />
      </main>
    </div>
  )
}
