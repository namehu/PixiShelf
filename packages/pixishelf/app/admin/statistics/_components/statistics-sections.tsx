import Link from 'next/link'
import type { StatisticsResult, StatisticsRanking, StatisticsStorage } from '@/services/statistics-service'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { formatFileSize } from '@/utils/media'
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

const storageCategories = [
  { type: 'IMAGE', label: '静态图片' },
  { type: 'ANIMATION', label: '动图' },
  { type: 'VIDEO', label: '视频' },
  { type: 'UNKNOWN', label: '其他' }
] as const

export async function StatisticsStorageSection({ data }: { data: Promise<StatisticsResult<StatisticsStorage>> }) {
  const result = await data
  if (!result.ok) {
    return (
      <AdminSection aria-label="媒体占用">
        <AdminSectionHeader title="媒体占用" />
        <PageState variant="error" title="媒体占用加载失败" description="请稍后刷新页面，其他统计仍可查看。" compact />
      </AdminSection>
    )
  }
  const { totalBytes, categories, unknownSizeCount, computedAt } = result.value
  const [value, unit] = formatFileSize(totalBytes).split(' ')
  return (
    <AdminSection aria-label="媒体占用" className="gap-5">
      <Separator />
      <div className="grid min-w-0 gap-6 py-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center md:gap-10">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-muted-foreground">媒体总占用</h2>
          <p className="font-utility mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="text-4xl font-semibold tracking-tight text-foreground">{value}</span>
            <span className="text-lg text-muted-foreground">{unit}</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">按已登记原文件统计</p>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          {storageCategories.map(({ type, label }) => {
            const category = categories.find((item) => item.type === type)
            if (type === 'UNKNOWN' && !category) return null
            const [amount, suffix] = formatFileSize(category?.bytes ?? 0).split(' ')
            return (
              <div key={type} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-utility mt-1.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
                  <span className="text-xl font-semibold text-foreground">{amount}</span>
                  <span className="text-xs text-muted-foreground">{suffix}</span>
                </dd>
              </div>
            )
          })}
        </dl>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs leading-5 text-muted-foreground">
        <p>包含回收站内的原文件，不含派生文件与临时文件。</p>
        <p>统计于 <time dateTime={computedAt}>{computedAt.slice(0, 16).replace('T', ' ')} UTC</time></p>
        {unknownSizeCount > 0 && <p className="w-full">已知大小合计；另有 {unknownSizeCount.toLocaleString()} 个文件尚未登记大小。</p>}
      </div>
      <Separator />
    </AdminSection>
  )
}

export function StoragePlaceholder() {
  return (
    <AdminSection aria-label="媒体占用加载中" aria-busy="true" className="gap-5">
      <Separator />
      <div className="grid gap-6 py-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center md:gap-10">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          {storageCategories.slice(0, 3).map(({ type }) => (
            <div key={type} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-5 w-full max-w-80" />
      <Separator />
    </AdminSection>
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
