import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { WallpaperIcon, Users, Image as ImageIcon, Tags } from 'lucide-react'

export const dynamic = 'force-dynamic'

// 定义扩展后的统计数据类型
interface StatsData {
  artworkCount: number
  artistCount: number
  imageCount: number
  tagCount: number
  topArtists: {
    id: number
    name: string
    artworkCount: number
  }[]
  topTags: {
    id: number
    name: string
    artworkCount: number
  }[]
}

/**
 * 服务器端函数：用于从数据库获取所有统计数据，包括排行榜。
 */
async function getStats(): Promise<StatsData> {
  try {
    // 使用 Promise.all 并行执行所有查询以提高效率
    const [artworkCount, artistCount, imageCount, tagCount, topArtistsData, topTags] = await Promise.all([
      prisma.artwork.count(),
      prisma.artist.count(),
      prisma.image.count(),
      prisma.tag.count(),
      // 查询作品数量最多的前5位艺术家
      prisma.artwork.groupBy({
        by: ['artistId'],
        where: { artistId: { not: null } },
        _count: true,
        orderBy: { _count: { imageCount: 'desc' } },
        take: 5
      }),
      // 查询作品数量最多的前5个标签 (利用缓存字段 artworkCount)
      prisma.tag.findMany({
        orderBy: { artworkCount: 'desc' },
        take: 5
      })
    ])

    // 根据 topArtistsData 中的 artistId 获取艺术家详细信息
    const artistIds = topArtistsData.map((data) => data.artistId as number)
    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, name: true }
    })

    // 将艺术家信息与作品数量结合起来
    const topArtists = topArtistsData
      .map((data) => {
        const artist = artists.find((a) => a.id === data.artistId)
        return {
          id: artist?.id || 0,
          name: artist?.name || '未知艺术家',
          artworkCount: data._count
        }
      })
      .sort((a, b) => b.artworkCount - a.artworkCount) // 确保最终排序正确

    return {
      artworkCount,
      artistCount,
      imageCount,
      tagCount,
      topArtists,
      topTags
    }
  } catch (error) {
    console.error('获取统计数据时出错:', error)
    // 在生产环境中，你可能希望记录这个错误
    // 返回一个默认值或抛出错误，让上层组件处理
    return {
      artworkCount: 0,
      artistCount: 0,
      imageCount: 0,
      tagCount: 0,
      topArtists: [],
      topTags: []
    }
  }
}

/**
 * 统计信息卡片组件
 * @param title - 卡片标题
 * @param value - 显示的统计数值
 * @param icon - 卡片中显示的图标
 */
const StatCard = ({ title, value, icon: Icon }: { title: string; value: number; icon: React.ElementType }) => (
  <Card className="rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</CardTitle>
      <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">总计</p>
    </CardContent>
  </Card>
)

/**
 * 排行榜卡片组件
 * @param title - 卡片标题
 * @param items - 列表项，包含名称和数值
 * @param icon - 卡片中显示的图标
 */
const LeaderboardCard = ({
  title,
  items,
  icon: Icon
}: {
  title: string
  items: { name: string; value: number }[]
  icon: React.ElementType
}) => (
  <Card className="rounded-xl shadow-lg">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-lg font-medium">{title}</CardTitle>
      <Icon className="h-5 w-5 text-gray-400" />
    </CardHeader>
    <CardContent>
      {items.length > 0 ? (
        <ul className="space-y-4">
          {items.map((item, index) => (
            <li key={item.name + index} className="flex items-center space-x-4">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full font-bold text-sm">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={item.name}>
                  {item.name}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{item.value.toLocaleString()}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">作品</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">暂无数据</p>
      )}
    </CardContent>
  </Card>
)

/**
 * 数据统计仪表盘页面
 * 这是一个服务器组件，它会异步获取数据并渲染页面。
 */
export default async function StatsDashboardPage() {
  const stats = await getStats()

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">数据总览</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="作品数量" value={stats.artworkCount} icon={WallpaperIcon} />
        <StatCard title="艺术家数量" value={stats.artistCount} icon={Users} />
        <StatCard title="图片总数" value={stats.imageCount} icon={ImageIcon} />
        <StatCard title="标签总数" value={stats.tagCount} icon={Tags} />
      </div>

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2 mt-8">
        <LeaderboardCard
          title="最活跃艺术家"
          icon={Users}
          items={stats.topArtists.map((artist) => ({
            name: artist.name,
            value: artist.artworkCount
          }))}
        />
        <LeaderboardCard
          title="最热门标签"
          icon={Tags}
          items={stats.topTags.map((tag) => ({
            name: tag.name,
            value: tag.artworkCount
          }))}
        />
      </div>
    </div>
  )
}
