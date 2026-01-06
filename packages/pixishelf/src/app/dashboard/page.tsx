import { getRecommendedArtworks, getRecentArtworks } from '@/services/artwork-service'
import { getRecentArtists } from '@/services/artist-service'
import RecentArtists from './_components/RecentArtists'
import PNav from '@/components/layout/PNav'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'
import { HashIcon, ImageIcon, ImageUpIcon, UsersIcon } from 'lucide-react'
import ArtworkGrid from './_components/ArtworkGrid'
import { Button } from '@/components/ui/button'
import InfiniteArtworkGrid from './_components/InfiniteArtworkGrid'

export const dynamic = 'force-dynamic'

/**
 * 仪表板页面组件
 */
export default async function DashboardPage() {
  // 并行获取所有数据
  const [recommendedArtworks, recentArtworks, recentArtists] = await Promise.all([
    getRecommendedArtworks({ pageSize: 12 }), // 获取推荐作品数据
    getRecentArtworks({ page: 1, pageSize: 12 }), // 获取最新作品数据
    getRecentArtists({ page: 1, pageSize: 12 }) // 获取热门艺术家数据
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
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">最新作品</h3>
              <p className="text-gray-600">发现最新上传的精彩作品</p>
            </div>
            <Link href={ROUTES.GALLERY}>
              <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
                查看全部 →
              </Button>
            </Link>
          </div>

          <ArtworkGrid initialData={recentArtworks} />
        </div>

        <RecentArtists data={recentArtists.data} />

        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">推荐作品</h3>
              <p className="text-gray-600">为您精心挑选的优质作品</p>
            </div>
          </div>

          <InfiniteArtworkGrid initialData={recommendedArtworks} />
        </div>
      </main>
    </div>
  )
}
