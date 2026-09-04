import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { ImageIcon, TagsIcon, UsersIcon, WallpaperIcon } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { ROUTES } from '@/lib/constants'
import { Progress } from '@/components/ui/progress'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { PageState } from '@/components/layout/page-state'
import { AdminMetric, AdminSection, AdminSectionHeader, AdminWorkbench } from '../_components/admin-workbench'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '状态管理 - PixiShelf Admin'
}
interface StatsData {
  error: boolean
  counts: {
    artworks: number
    artists: number
    images: number
    tags: number
  }
  topArtists: { id: number; name: string; count: number }[]
  topTags: { id: number; name: string; count: number }[]
}

const getCachedStats = unstable_cache(
  async (): Promise<StatsData> => {
    try {
      const [artworkCount, artistCount, imageCount, tagCount, topArtistsRaw, topTagsRaw] = await Promise.all([
        prisma.artwork.count(),
        prisma.artist.count(),
        prisma.image.count(),
        prisma.tag.count(),
        prisma.artwork.groupBy({
          by: ['artistId'],
          where: { artistId: { not: null } },
          _count: { artistId: true },
          orderBy: { _count: { artistId: 'desc' } },
          take: 20
        }),
        prisma.tag.findMany({
          orderBy: { artworkCount: 'desc' },
          take: 20,
          select: { id: true, name: true, artworkCount: true }
        })
      ])

      const artistIds = topArtistsRaw.map((item) => item.artistId as number)
      const artists = await prisma.artist.findMany({
        where: { id: { in: artistIds } },
        select: { id: true, name: true }
      })
      const artistNames = new Map(artists.map((artist) => [artist.id, artist.name]))

      return {
        error: false,
        counts: {
          artworks: artworkCount,
          artists: artistCount,
          images: imageCount,
          tags: tagCount
        },
        topArtists: topArtistsRaw.map((item) => ({
          id: item.artistId!,
          name: artistNames.get(item.artistId!) ?? '未知艺术家',
          count: item._count.artistId
        })),
        topTags: topTagsRaw.map((tag) => ({ id: tag.id, name: tag.name, count: tag.artworkCount }))
      }
    } catch (error) {
      logger.error('Dashboard Stats Error:', error)
      return {
        error: true,
        counts: { artworks: 0, artists: 0, images: 0, tags: 0 },
        topArtists: [],
        topTags: []
      }
    }
  },
  ['dashboard-stats-v2'],
  { revalidate: 60 }
)

export default async function StatsDashboardPage() {
  const stats = await getCachedStats()

  return (
    <AdminWorkbench title="图库状态" description="概览当前档案规模，并查看收录量最高的艺术家与标签。">
      {stats.error ? (
        <PageState
          variant="error"
          title="统计数据加载失败"
          description="数据库暂时无法返回统计信息，请稍后刷新页面。"
          compact
        />
      ) : (
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-label="图库核心指标" className="grid min-w-0 gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
          <MetricLink href={ROUTES.ARTWORKS}>
            <AdminMetric label="总收录作品" value={stats.counts.artworks.toLocaleString()} description="库内资源" icon={<WallpaperIcon className="size-4" aria-hidden="true" />} />
          </MetricLink>
          <MetricLink href="/artists">
            <AdminMetric label="艺术家" value={stats.counts.artists.toLocaleString()} description="创作来源" icon={<UsersIcon className="size-4" aria-hidden="true" />} />
          </MetricLink>
          <AdminMetric label="图库文件" value={stats.counts.images.toLocaleString()} description="存储对象" icon={<ImageIcon className="size-4" aria-hidden="true" />} />
          <MetricLink href="/tags">
            <AdminMetric label="活跃标签" value={stats.counts.tags.toLocaleString()} description="分类维度" icon={<TagsIcon className="size-4" aria-hidden="true" />} />
          </MetricLink>
        </section>

        <div className="grid min-w-0 gap-8 xl:grid-cols-2">
          <Leaderboard title="热门艺术家" description="按作品收录量排序" data={stats.topArtists} type="artist" />
          <Leaderboard title="热门标签" description="按作品使用量排序" data={stats.topTags} type="tag" />
        </div>
      </div>
      )}
    </AdminWorkbench>
  )
}

function MetricLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring/50">
      {children}
    </Link>
  )
}

function Leaderboard({
  title,
  description,
  data,
  type
}: {
  title: string
  description: string
  data: { id: number; name: string; count: number }[]
  type: 'artist' | 'tag'
}) {
  const maxValue = data[0]?.count || 1

  return (
    <AdminSection aria-labelledby={`leaderboard-${type}`}>
      <AdminSectionHeader title={<span id={`leaderboard-${type}`}>{title}</span>} description={description} />
      {data.length === 0 ? (
        <PageState variant="empty" title="暂无排行数据" description="完成更多导入后，这里会显示收录排行。" compact />
      ) : (
        <ol className="flex min-w-0 flex-col border-b border-border">
          {data.map((item, index) => {
            const percentage = Math.round((item.count / maxValue) * 100)
            return (
              <li key={item.id} className="border-t border-border">
                <Link
                  href={`/${type}s/${item.id}`}
                  className="group block rounded-sm px-1 py-3 outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="font-utility flex size-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <PrivacySensitiveText className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {item.name}
                    </PrivacySensitiveText>
                    <span className="font-utility shrink-0 text-sm font-semibold text-foreground tabular-nums">{item.count}</span>
                  </span>
                  <Progress className="mt-2 h-1.5" value={percentage} aria-label={`${item.name}：${item.count}`} />
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </AdminSection>
  )
}
