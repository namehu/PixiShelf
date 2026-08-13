'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, History, Loader2, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTRPC } from '@/lib/trpc'
import { ScanHistoryDetailTable } from './scan-history-detail-table'
import {
  formatDate,
  formatDuration,
  formatFullDate,
  formatMode,
  formatType,
  ScanRunItemStatus,
  ScanRunStatus,
  StatusBadge
} from './scan-history-format'

const ITEM_STATUS_FILTERS: Array<{ value: ScanRunItemStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'SUCCESS', label: '成功' },
  { value: 'SKIPPED', label: '跳过' },
  { value: 'FAILED', label: '失败' }
]

const numberFormatter = new Intl.NumberFormat('zh-CN')

function parseStatusFilter(value: string | null): ScanRunItemStatus | 'ALL' {
  return value === 'SUCCESS' || value === 'SKIPPED' || value === 'FAILED' ? value : 'ALL'
}

export function ScanHistoryManagement() {
  const trpc = useTRPC()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const historyQuery = useQuery(
    trpc.scanRun.list.queryOptions(
      { limit: 50 },
      {
        refetchInterval: (query) => {
          const hasRunning = query.state.data?.some((run) => run.status === 'RUNNING')
          return hasRunning ? 2000 : 12000
        }
      }
    )
  )

  const runs = historyQuery.data ?? []
  const latest = runs[0] ?? null
  const runParam = searchParams.get('run')
  const selectedRunId = runParam === 'none' ? null : (runParam ?? latest?.id ?? null)
  const statusFilter = parseStatusFilter(searchParams.get('status'))

  const detailQuery = useQuery(
    trpc.scanRun.detail.queryOptions(
      {
        scanRunId: selectedRunId ?? '__none__',
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 500
      },
      { enabled: Boolean(selectedRunId) }
    )
  )

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? detailQuery.data?.run ?? null
  const detailItems = detailQuery.data?.items ?? []

  const updateView = (runId: string | null, status: ScanRunItemStatus | 'ALL' = 'ALL') => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('run', runId ?? 'none')

    if (runId && status !== 'ALL') params.set('status', status)
    else params.delete('status')

    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <History className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-pretty text-2xl font-semibold tracking-tight text-foreground">扫描历史</h1>
              <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">
                展开任意一次运行，直接查看作品明细与失败原因。
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => historyQuery.refetch()}
            disabled={historyQuery.isFetching}
            className="self-start bg-white"
          >
            <RefreshCw
              className={cn('size-4 motion-reduce:animate-none', historyQuery.isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            {historyQuery.isFetching ? '刷新中…' : '刷新记录'}
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-sm text-muted-foreground">
          <span>{historyQuery.isPending ? '正在读取记录…' : `最近 ${runs.length} 次运行`}</span>
          <span>运行中的任务每 2 秒更新</span>
          <span className="ml-auto hidden text-xs sm:inline">点击记录展开或收起明细</span>
        </div>

        {historyQuery.isError ? (
          <QueryError
            title="无法加载扫描记录"
            description="请检查服务连接后重新加载。"
            onRetry={() => historyQuery.refetch()}
          />
        ) : historyQuery.isPending ? (
          <RunListSkeleton />
        ) : runs.length === 0 ? (
          <EmptyState />
        ) : (
          <section aria-label="扫描运行记录" className="space-y-2">
            {runs.map((run, index) => {
              const expanded = run.id === selectedRunId
              const panelId = `scan-run-${run.id}-panel`

              return (
                <article
                  key={run.id}
                  className={cn(
                    'relative overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow]',
                    expanded && 'border-blue-200 shadow-md shadow-blue-950/5'
                  )}
                >
                  <span
                    className={cn('absolute inset-y-0 left-0 w-1', getStatusRailClass(run.status))}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => updateView(expanded ? null : run.id)}
                    className="w-full py-4 pr-4 pl-5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 sm:pl-6"
                  >
                    <div className="grid items-center gap-3 sm:grid-cols-[112px_minmax(0,1fr)_auto_auto] sm:gap-5">
                      <div className="flex items-center justify-between gap-3 sm:block">
                        <time
                          className="text-sm font-medium tabular-nums text-foreground"
                          dateTime={new Date(run.startedAt).toISOString()}
                        >
                          {formatDate(run.startedAt)}
                        </time>
                        {index === 0 ? (
                          <span className="hidden text-xs font-medium text-blue-600 sm:mt-1 sm:block">最近运行</span>
                        ) : null}
                        <div className="flex items-center gap-2 sm:hidden">
                          <StatusBadge status={run.status as ScanRunStatus} />
                          <ChevronDown
                            className={cn(
                              'size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                              expanded && 'rotate-180'
                            )}
                            aria-hidden="true"
                          />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            role="heading"
                            aria-level={2}
                            className="truncate text-sm font-semibold text-foreground sm:text-base"
                          >
                            {formatType(run.type)}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatMode(run.mode)}</span>
                        </div>
                        <RunMetrics
                          succeeded={run.succeededArtworks}
                          skipped={run.skippedArtworks}
                          failed={run.failedArtworks}
                          media={run.newImages}
                          className="mt-2 sm:hidden"
                        />
                      </div>

                      <RunMetrics
                        succeeded={run.succeededArtworks}
                        skipped={run.skippedArtworks}
                        failed={run.failedArtworks}
                        media={run.newImages}
                        className="hidden sm:flex"
                      />

                      <div className="hidden items-center gap-3 sm:flex">
                        <StatusBadge status={run.status as ScanRunStatus} />
                        <ChevronDown
                          className={cn(
                            'size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                            expanded && 'rotate-180'
                          )}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  </button>

                  {expanded && selectedRun ? (
                    <div id={panelId} className="border-t bg-muted/10 px-4 py-5 sm:px-6">
                      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                          <div className="flex items-baseline gap-1.5">
                            <dt className="text-muted-foreground">发现</dt>
                            <dd className="font-semibold tabular-nums">
                              {numberFormatter.format(selectedRun.totalArtworks)}
                            </dd>
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            <dt className="text-muted-foreground">耗时</dt>
                            <dd className="font-medium tabular-nums">{formatDuration(selectedRun.durationMs)}</dd>
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            <dt className="text-muted-foreground">明细</dt>
                            <dd className="font-medium tabular-nums">
                              {numberFormatter.format(detailItems.length)} 条
                            </dd>
                          </div>
                          <div className="hidden text-xs text-muted-foreground md:block">
                            {formatFullDate(selectedRun.startedAt)}
                          </div>
                        </dl>

                        <div
                          className="inline-flex w-fit rounded-lg bg-muted p-1"
                          role="group"
                          aria-label="按处理状态筛选"
                        >
                          {ITEM_STATUS_FILTERS.map((filter) => (
                            <button
                              key={filter.value}
                              type="button"
                              aria-pressed={statusFilter === filter.value}
                              onClick={() => updateView(selectedRunId, filter.value)}
                              className={cn(
                                'min-h-8 rounded-md px-3 text-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                statusFilter === filter.value && 'bg-background text-foreground shadow-sm'
                              )}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {selectedRun.errorMessage ? (
                        <div
                          className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                          role="alert"
                        >
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          <p className="break-words">{selectedRun.errorMessage}</p>
                        </div>
                      ) : null}

                      {detailQuery.isError ? (
                        <QueryError
                          title="无法加载作品明细"
                          description="本次运行记录仍然保留，请重新加载明细。"
                          onRetry={() => detailQuery.refetch()}
                        />
                      ) : (
                        <ScanHistoryDetailTable items={detailItems} isFetching={detailQuery.isFetching} />
                      )}

                      {detailQuery.data?.nextCursor ? (
                        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          当前显示前 500 条明细。使用状态筛选可以缩小结果范围。
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}

function RunMetrics({
  succeeded,
  skipped,
  failed,
  media,
  className
}: {
  succeeded: number
  skipped: number
  failed: number
  media: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground',
        className
      )}
    >
      <span>
        <strong className="font-semibold text-emerald-700">{numberFormatter.format(succeeded)}</strong> 成功
      </span>
      <span>
        <strong className="font-semibold text-foreground">{numberFormatter.format(skipped)}</strong> 跳过
      </span>
      <span>
        <strong className={cn('font-semibold', failed > 0 ? 'text-red-700' : 'text-foreground')}>
          {numberFormatter.format(failed)}
        </strong>{' '}
        失败
      </span>
      <span>
        <strong className="font-semibold text-foreground">{numberFormatter.format(media)}</strong> 新媒体
      </span>
    </div>
  )
}

function getStatusRailClass(status: string) {
  if (status === 'RUNNING') return 'bg-blue-500'
  if (status === 'COMPLETED') return 'bg-emerald-500'
  if (status === 'FAILED') return 'bg-red-500'
  return 'bg-neutral-300'
}

function EmptyState() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-white px-6 py-12 text-center">
      <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-sm font-medium text-foreground">还没有扫描记录</h2>
      <p className="mt-1 max-w-xs text-pretty text-sm text-muted-foreground">
        完成一次扫描后，可在这里展开查看每件作品的处理结果。
      </p>
    </div>
  )
}

function QueryError({ title, description, onRetry }: { title: string; description: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800" role="alert">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-red-700">{description}</p>
        </div>
        <Button type="button" variant="outline" onClick={onRetry} className="border-red-200 bg-white hover:bg-red-100">
          <RefreshCw className="size-4" aria-hidden="true" />
          重新加载
        </Button>
      </div>
    </div>
  )
}

function RunListSkeleton() {
  return (
    <div className="space-y-2" aria-label="正在加载扫描记录" aria-busy="true">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-5 rounded-xl border bg-white px-5 py-5">
          <Loader2
            className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div className="h-4 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}
