import Link from 'next/link'
import type { StatisticsResult, StatisticsRanking } from '@/services/statistics-service'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { PageState } from '@/components/layout/page-state'
import { AdminSection, AdminSectionHeader } from '../../_components/admin-workbench'

export async function StatisticsMetric({ data }: { data: Promise<StatisticsResult<number>> }) {
  const result = await data
  return result.ok ? (
    result.value.toLocaleString()
  ) : (
    <span className="text-sm text-muted-foreground" role="status">
      加载失败，请刷新
    </span>
  )
}

export async function StatisticsLeaderboard({
  data,
  ...props
}: {
  data: Promise<StatisticsResult<StatisticsRanking>>
  title: string
  description: string
  type: 'artist' | 'tag'
}) {
  const result = await data
  return result.ok ? (
    <Leaderboard {...props} data={result.value} />
  ) : (
    <AdminSection>
      <AdminSectionHeader title={props.title} description={props.description} />
      <PageState variant="error" title="排行加载失败" description="请稍后刷新页面，其他统计仍可查看。" compact />
    </AdminSection>
  )
}

export function RankingPlaceholder({ title }: { title: string }) {
  return (
    <AdminSection aria-busy="true" aria-label={title + '加载中'}>
      <AdminSectionHeader title={title} />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </AdminSection>
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
                    <span className="font-utility shrink-0 text-sm font-semibold text-foreground tabular-nums">
                      {item.count}
                    </span>
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
