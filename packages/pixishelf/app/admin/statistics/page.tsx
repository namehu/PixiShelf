import { Suspense } from 'react'
import Link from 'next/link'
import { ImageIcon, TagsIcon, UsersIcon, WallpaperIcon } from 'lucide-react'
import { ROUTES } from '@/lib/constants'
import { loadStatisticsSections } from '@/services/statistics-service'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminMetric, AdminWorkbench } from '../_components/admin-workbench'
import { StatisticsMetric, StatisticsLeaderboard, RankingPlaceholder } from './_components/statistics-sections'

export const dynamic = 'force-dynamic'
export const metadata = { title: '状态管理 - PixiShelf Admin' }

export default function StatsDashboardPage() {
  const sections = loadStatisticsSections()
  const metrics = [
    {
      label: '总收录作品',
      description: '库内资源',
      href: ROUTES.ARTWORKS,
      icon: WallpaperIcon,
      data: sections.basic.then((r) => (r.ok ? { ok: true as const, value: r.value.artworks } : r))
    },
    {
      label: '艺术家',
      description: '创作来源',
      href: '/artists',
      icon: UsersIcon,
      data: sections.basic.then((r) => (r.ok ? { ok: true as const, value: r.value.artists } : r))
    },
    { label: '图库文件', description: '存储对象', icon: ImageIcon, data: sections.images },
    {
      label: '活跃标签',
      description: '分类维度',
      href: '/tags',
      icon: TagsIcon,
      data: sections.basic.then((r) => (r.ok ? { ok: true as const, value: r.value.tags } : r))
    }
  ]
  return (
    <AdminWorkbench title="图库状态" description="概览当前档案规模，并查看收录量最高的艺术家与标签。">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-label="图库核心指标" className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, description, href, icon: Icon, data }) => {
            const metric = (
              <AdminMetric
                label={label}
                description={description}
                icon={<Icon className="size-4" aria-hidden="true" />}
                value={
                  <Suspense
                    fallback={
                      <Skeleton className="h-8 w-24" role="status" aria-busy="true" aria-label={label + '加载中'} />
                    }
                  >
                    <StatisticsMetric data={data} />
                  </Suspense>
                }
              />
            )
            return href ? (
              <MetricLink key={label} href={href}>
                {metric}
              </MetricLink>
            ) : (
              <div key={label}>{metric}</div>
            )
          })}
        </section>
        <div className="grid min-w-0 gap-8 xl:grid-cols-2">
          <Suspense fallback={<RankingPlaceholder title="热门艺术家" />}>
            <StatisticsLeaderboard
              title="热门艺术家"
              description="按作品收录量排序"
              type="artist"
              data={sections.artists}
            />
          </Suspense>
          <Suspense fallback={<RankingPlaceholder title="热门标签" />}>
            <StatisticsLeaderboard title="热门标签" description="按作品使用量排序" type="tag" data={sections.tags} />
          </Suspense>
        </div>
      </div>
    </AdminWorkbench>
  )
}

function MetricLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  )
}
