import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { WallpaperIcon, Users, ImageIcon, Tags, Trophy, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { ROUTES } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '状态管理 - PixiShelf Admin'
}

// --- 类型定义 ---

interface StatsData {
  counts: {
    artworks: number
    artists: number
    images: number
    tags: number
  }
  topArtists: { id: number; name: string; count: number }[]
  topTags: { id: number; name: string; count: number }[]
}

/**
 * 获取统计数据
 * 缓存有效期: 60秒 (1分钟)
 */
const getCachedStats = unstable_cache(
  async (): Promise<StatsData> => {
    try {
      // 1. 并行查询基础计数
      const [artworkCount, artistCount, imageCount, tagCount] = await Promise.all([
        prisma.artwork.count(),
        prisma.artist.count(),
        prisma.image.count(),
        prisma.tag.count()
      ])

      // 2. 并行查询排行榜原始数据
      const [topArtistsRaw, topTagsRaw] = await Promise.all([
        // 艺术家排行：根据作品数量倒序
        prisma.artwork.groupBy({
          by: ['artistId'],
          where: { artistId: { not: null } },
          _count: { artistId: true },
          orderBy: { _count: { artistId: 'desc' } },
          take: 20
        }),
        // 标签排行：假设 Tag 表有 artworkCount 字段 (如果没有，需要调整此处逻辑)
        prisma.tag.findMany({
          orderBy: { artworkCount: 'desc' },
          take: 20,
          select: { id: true, name: true, artworkCount: true } // 仅取所需字段
        })
      ])

      // 3. 补全艺术家详细信息 (因为 groupBy 无法直接 include)
      const artistIds = topArtistsRaw.map((t) => t.artistId as number)
      const artists = await prisma.artist.findMany({
        where: { id: { in: artistIds } },
        select: { id: true, name: true }
      })

      // 4. 组装艺术家数据
      const topArtists = topArtistsRaw
        .map((item) => {
          const info = artists.find((a) => a.id === item.artistId)
          return {
            id: item.artistId!,
            name: info?.name || '未知艺术家',
            count: item._count.artistId
          }
        })
        .sort((a, b) => b.count - a.count)

      return {
        counts: {
          artworks: artworkCount,
          artists: artistCount,
          images: imageCount,
          tags: tagCount
        },
        topArtists,
        topTags: topTagsRaw.map((t) => ({ id: t.id, name: t.name, count: t.artworkCount }))
      }
    } catch (error) {
      logger.error('Dashboard Stats Error:', error)
      // 错误回退数据，防止页面崩溃
      return {
        counts: { artworks: 0, artists: 0, images: 0, tags: 0 },
        topArtists: [],
        topTags: []
      }
    }
  },
  ['dashboard-stats-v1'], // Cache Key
  { revalidate: 60 } // Revalidate Time
)

export default async function StatsDashboardPage() {
  const stats = await getCachedStats()

  return (
    <div className="space-y-8 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* 顶部核心指标区 (Grid 布局: 手机2列，平板/电脑4列) */}
      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="总收录作品"
          value={stats.counts.artworks}
          icon={WallpaperIcon}
          trend="库内资源"
          theme="blue"
          href={ROUTES.ARTWORKS}
        />
        <StatCard
          title="入驻艺术家"
          value={stats.counts.artists}
          icon={Users}
          trend="创作来源"
          theme="violet"
          href="/artists"
        />
        <StatCard title="图库文件数" value={stats.counts.images} icon={ImageIcon} trend="存储对象" theme="emerald" />
        <StatCard title="活跃标签" value={stats.counts.tags} icon={Tags} trend="分类维度" theme="amber" href="/tags" />
      </section>

      {/* 排行榜区域 (Grid 布局: 手机单列，电脑双列) */}
      <section className="grid gap-6 md:grid-cols-2">
        <LeaderboardCard
          title="热门艺术家 TOP 20"
          subtitle="作品收录量最多的创作者"
          icon={Users}
          data={stats.topArtists}
          type="artist"
        />
        <LeaderboardCard
          title="热门标签 TOP 20"
          subtitle="图库中最常使用的标签"
          icon={Tags}
          data={stats.topTags}
          type="tag"
        />
      </section>
    </div>
  )
}

/**
 * 颜色映射配置 (解决 Tailwind 动态类名问题)
 */
const colorVariants = {
  blue: {
    icon: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    decoration: 'bg-blue-600'
  },
  violet: {
    icon: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-100 dark:bg-violet-900/30',
    decoration: 'bg-violet-600'
  },
  emerald: {
    icon: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    decoration: 'bg-emerald-600'
  },
  amber: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    decoration: 'bg-amber-600'
  }
}

const StatCard = ({
  title,
  value,
  icon: Icon,
  trend,
  theme,
  href
}: {
  title: string
  value: number
  icon: React.ElementType
  trend?: string
  theme: keyof typeof colorVariants
  href?: string
}) => {
  const colors = colorVariants[theme]

  const Content = (
    <Card className="border-none shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden relative dark:bg-neutral-800">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{title}</CardTitle>
        <div className={cn('p-2 rounded-full transition-colors', colors.bg, colors.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value.toLocaleString()}</div>
        {trend && <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1 flex items-center">{trend}</p>}
      </CardContent>
      {/* 装饰性背景圆 (修复了不显示的问题) */}
      <div
        className={cn(
          'absolute -right-6 -bottom-6 w-24 h-24 rounded-full opacity-[0.08] dark:opacity-[0.15] pointer-events-none',
          colors.decoration
        )}
      />
    </Card>
  )

  if (href) return <Link href={href}>{Content}</Link>
  return Content
}

const LeaderboardCard = ({
  title,
  subtitle,
  icon: Icon,
  data,
  type
}: {
  title: string
  subtitle: string
  icon: React.ElementType
  data: { id: number; name: string; count: number }[]
  type: 'artist' | 'tag'
}) => {
  const maxValue = data[0]?.count || 1

  return (
    <Card className="col-span-1 shadow-sm border-neutral-200 dark:border-neutral-800 dark:bg-neutral-800 flex flex-col h-full">
      <CardHeader className="pb-3 border-b border-neutral-100 dark:border-neutral-700/50">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base sm:text-lg font-semibold flex items-center gap-2 text-neutral-800 dark:text-neutral-100">
              <Icon className="w-5 h-5 text-neutral-500" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1 text-xs sm:text-sm">{subtitle}</CardDescription>
          </div>
          {/* 查看更多按钮 (预留) */}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-neutral-100 dark:hover:bg-neutral-700">
            <ArrowRight className="h-4 w-4 text-neutral-400" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto pt-4">
        <div className="space-y-5">
          {data.map((item, index) => {
            const percentage = Math.round((item.count / maxValue) * 100)

            // 排名颜色逻辑
            let rankClass = 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400'
            let barColor = 'bg-blue-500/50'

            if (index === 0) {
              rankClass = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
              barColor = 'bg-yellow-400'
            } else if (index === 1) {
              rankClass = 'bg-neutral-200 text-neutral-700 dark:bg-neutral-600 dark:text-neutral-300'
              barColor = 'bg-neutral-400'
            } else if (index === 2) {
              rankClass = 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400'
              barColor = 'bg-orange-400'
            }

            return (
              <Link
                key={item.id}
                href={`/${type}s/${item.id}`} // 自动生成链接: /artists/1 或 /tags/1
                className="group block"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-3 overflow-hidden">
                    {/* 排名徽章 */}
                    <div
                      className={cn(
                        'flex items-center justify-center w-6 h-6 rounded text-xs font-bold flex-shrink-0',
                        rankClass
                      )}
                    >
                      {index <= 2 ? <Trophy className="w-3 h-3" /> : index + 1}
                    </div>

                    {/* 名称 */}
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {item.name}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-neutral-900 dark:text-white tabular-nums">{item.count}</span>
                </div>

                {/* 简易进度条 (无需组件库依赖) */}
                <div className="w-full bg-neutral-100 dark:bg-neutral-700/50 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700 ease-out', barColor)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </Link>
            )
          })}

          {data.length === 0 && <div className="text-center py-10 text-neutral-400 text-sm">暂无数据</div>}
        </div>
      </CardContent>
    </Card>
  )
}
