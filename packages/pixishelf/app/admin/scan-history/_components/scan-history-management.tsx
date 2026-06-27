'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, FileSearch, ListFilter, RotateCcw } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { SCard } from '@/components/shared/s-card'
import {
  formatAction,
  formatDate,
  formatDuration,
  formatFullDate,
  formatMode,
  formatType,
  ItemStatusBadge,
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

export function ScanHistoryManagement() {
  const trpc = useTRPC()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ScanRunItemStatus | 'ALL'>('ALL')

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

  useEffect(() => {
    if (!selectedRunId && latest) {
      setSelectedRunId(latest.id)
    }
  }, [latest, selectedRunId])

  const detailQuery = useQuery(
    trpc.scanRun.detail.queryOptions(
      {
        scanRunId: selectedRunId ?? '__none__',
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 500
      },
      {
        enabled: Boolean(selectedRunId)
      }
    )
  )

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? detailQuery.data?.run ?? null, [
    detailQuery.data?.run,
    runs,
    selectedRunId
  ])
  const detailItems = detailQuery.data?.items ?? []

  return (
    <div className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">扫描历史</h1>
            <p className="mt-2 text-neutral-600">查看扫描、重扫和导入运行记录，以及作品级处理明细</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
            <RotateCcw className="h-4 w-4" />
            刷新
          </Button>
        </div>

        {latest ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <HistoryStat label="发现" value={latest.totalArtworks} />
            <HistoryStat label="成功" value={latest.succeededArtworks} />
            <HistoryStat label="跳过" value={latest.skippedArtworks} />
            <HistoryStat label="失败" value={latest.failedArtworks} />
            <HistoryStat label="新增图片" value={latest.newImages} />
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <SCard
            title={
              <span className="flex items-center gap-2">
                <Clock3 className="h-5 w-5 text-neutral-500" />
                运行记录
              </span>
            }
            description="最近 50 次扫描和导入"
            contentPadding={false}
          >
            {runs.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">尚未记录扫描历史。</div>
            ) : (
              <div className="max-h-[calc(100vh-17rem)] overflow-auto">
                {runs.map((run) => {
                  const active = run.id === selectedRunId
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => {
                        setSelectedRunId(run.id)
                        setStatusFilter('ALL')
                      }}
                      className={`block w-full border-b px-4 py-3 text-left transition-colors ${
                        active ? 'bg-blue-50' : 'bg-white hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{formatType(run.type)}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{formatMode(run.mode)}</div>
                        </div>
                        <StatusBadge status={run.status as ScanRunStatus} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(run.startedAt)}</span>
                        <span>成功 {run.succeededArtworks}</span>
                        <span>失败 {run.failedArtworks}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </SCard>

          <SCard
            title={
              <span className="flex items-center gap-2">
                <FileSearch className="h-5 w-5 text-neutral-500" />
                作品级明细
              </span>
            }
            description={
              selectedRun
                ? `${formatFullDate(selectedRun.startedAt)} · ${formatType(selectedRun.type)} · ${formatMode(selectedRun.mode)}`
                : '选择左侧记录查看详情'
            }
            contentPadding={false}
          >
            {!selectedRun ? (
              <div className="p-10 text-center text-sm text-muted-foreground">请选择一条扫描记录。</div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <HistoryStat label="发现" value={selectedRun.totalArtworks} compact />
                  <HistoryStat label="成功" value={selectedRun.succeededArtworks} compact />
                  <HistoryStat label="跳过" value={selectedRun.skippedArtworks} compact />
                  <HistoryStat label="失败" value={selectedRun.failedArtworks} compact />
                  <HistoryStat label="新增图片" value={selectedRun.newImages} compact />
                </div>

                <div className="flex flex-col gap-3 rounded-md border bg-neutral-50 p-3 text-sm md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={selectedRun.status as ScanRunStatus} />
                    <span className="text-muted-foreground">耗时 {formatDuration(selectedRun.durationMs)}</span>
                    <span className="text-muted-foreground">明细 {detailItems.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ITEM_STATUS_FILTERS.map((filter) => (
                      <Button
                        key={filter.value}
                        variant={statusFilter === filter.value ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setStatusFilter(filter.value)}
                      >
                        {filter.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {selectedRun.errorMessage && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {selectedRun.errorMessage}
                  </div>
                )}

                <div className="overflow-hidden rounded-lg border">
                  <div className="grid min-w-[900px] grid-cols-[92px_132px_minmax(220px,1fr)_minmax(260px,1fr)_72px] gap-3 border-b bg-neutral-50 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>状态</span>
                    <span>动作</span>
                    <span>作品</span>
                    <span>路径</span>
                    <span>媒体</span>
                  </div>
                  <div className="max-h-[calc(100vh-32rem)] min-h-72 overflow-auto">
                    <div className="min-w-[900px] divide-y">
                      {detailItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[92px_132px_minmax(220px,1fr)_minmax(260px,1fr)_72px] gap-3 px-3 py-3 text-sm"
                        >
                          <ItemStatusBadge status={item.status as ScanRunItemStatus} />
                          <span className="text-muted-foreground">{formatAction(item.action)}</span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.title || item.externalId || '未命名作品'}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {item.artistName || item.externalId || '-'}
                            </div>
                            {item.errorMessage && <div className="mt-1 text-xs text-destructive">{item.errorMessage}</div>}
                          </div>
                          <div className="min-w-0 text-xs text-muted-foreground">
                            <div className="truncate">{item.relativeDirectory || '-'}</div>
                            <div className="truncate">{item.metadataRelativePath || '-'}</div>
                          </div>
                          <span>{item.mediaCount}</span>
                        </div>
                      ))}
                      {!detailQuery.isFetching && detailItems.length === 0 && (
                        <div className="px-3 py-12 text-center text-sm text-muted-foreground">没有匹配的作品记录。</div>
                      )}
                      {detailQuery.isFetching && (
                        <div className="px-3 py-12 text-center text-sm text-muted-foreground">正在加载详情...</div>
                      )}
                    </div>
                  </div>
                </div>

                {detailQuery.data?.nextCursor && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <ListFilter className="h-4 w-4" />
                    当前显示前 500 条明细，更多分页加载可后续继续补。
                  </div>
                )}
              </div>
            )}
          </SCard>
        </div>
      </div>
    </div>
  )
}

function HistoryStat({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={compact ? 'mt-1 text-base font-semibold' : 'mt-1 text-lg font-semibold'}>{value}</div>
    </div>
  )
}
