'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, FileSearch, ListFilter, RotateCcw } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { SCard } from '@/components/shared/s-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type ScanRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
type ScanRunItemStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED'

const ITEM_STATUS_FILTERS: Array<{ value: ScanRunItemStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'SUCCESS', label: '成功' },
  { value: 'SKIPPED', label: '跳过' },
  { value: 'FAILED', label: '失败' }
]

export function ScanHistoryCard() {
  const trpc = useTRPC()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ScanRunItemStatus | 'ALL'>('ALL')

  const historyQuery = useQuery(
    trpc.scanRun.list.queryOptions(
      { limit: 10 },
      {
        refetchInterval: (query) => {
          const hasRunning = query.state.data?.some((run) => run.status === 'RUNNING')
          return hasRunning ? 2000 : 8000
        }
      }
    )
  )

  const detailQuery = useQuery(
    trpc.scanRun.detail.queryOptions(
      {
        scanRunId: selectedRunId ?? '__none__',
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 200
      },
      {
        enabled: Boolean(selectedRunId)
      }
    )
  )

  const runs = historyQuery.data ?? []
  const latest = runs[0] ?? null
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? detailQuery.data?.run ?? null, [
    detailQuery.data?.run,
    runs,
    selectedRunId
  ])

  return (
    <>
      <SCard
        title={
          <span className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-neutral-500" />
            扫描历史
          </span>
        }
        description="最近一次扫描摘要和作品级处理记录。"
        extra={
          <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
            <RotateCcw className="h-4 w-4" />
            刷新
          </Button>
        }
      >
        <div className="space-y-5">
          {latest ? (
            <div className="rounded-lg border bg-neutral-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={latest.status as ScanRunStatus} />
                    <span className="text-sm text-muted-foreground">
                      {formatType(latest.type)} · {formatMode(latest.mode)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-600">
                    {formatDate(latest.startedAt)} · 耗时 {formatDuration(latest.durationMs)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedRunId(latest.id)}>
                  <FileSearch className="h-4 w-4" />
                  查看详情
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                <HistoryStat label="发现" value={latest.totalArtworks} />
                <HistoryStat label="成功" value={latest.succeededArtworks} />
                <HistoryStat label="跳过" value={latest.skippedArtworks} />
                <HistoryStat label="失败" value={latest.failedArtworks} />
                <HistoryStat label="新增图片" value={latest.newImages} />
              </div>
              {latest.errorMessage && <p className="mt-3 text-sm text-destructive">{latest.errorMessage}</p>}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              尚未记录扫描历史。
            </div>
          )}

          {runs.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b bg-neutral-50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid-cols-[160px_110px_1fr_90px_80px]">
                <span>开始时间</span>
                <span>状态</span>
                <span className="hidden md:block">摘要</span>
                <span className="hidden md:block">耗时</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-3 text-sm md:grid-cols-[160px_110px_1fr_90px_80px]"
                  >
                    <span>{formatDate(run.startedAt)}</span>
                    <StatusBadge status={run.status as ScanRunStatus} />
                    <span className="hidden text-muted-foreground md:block">
                      {formatType(run.type)} · {formatMode(run.mode)} · 成功 {run.succeededArtworks} / 跳过{' '}
                      {run.skippedArtworks} / 失败 {run.failedArtworks}
                    </span>
                    <span className="hidden text-muted-foreground md:block">{formatDuration(run.durationMs)}</span>
                    <div className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(run.id)}>
                        详情
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SCard>

      <Dialog open={Boolean(selectedRunId)} onOpenChange={(open) => !open && setSelectedRunId(null)}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListFilter className="h-5 w-5" />
              扫描详情
            </DialogTitle>
            <DialogDescription>
              {selectedRun
                ? `${formatDate(selectedRun.startedAt)} · ${formatType(selectedRun.type)} · ${formatMode(selectedRun.mode)}`
                : '加载中'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-hidden">
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

            <div className="max-h-[56vh] overflow-auto rounded-lg border">
              <div className="grid min-w-[860px] grid-cols-[90px_120px_1fr_1fr_80px] gap-3 border-b bg-neutral-50 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>状态</span>
                <span>动作</span>
                <span>作品</span>
                <span>路径</span>
                <span>媒体</span>
              </div>
              <div className="min-w-[860px] divide-y">
                {detailQuery.data?.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[90px_120px_1fr_1fr_80px] gap-3 px-3 py-3 text-sm">
                    <ItemStatusBadge status={item.status as ScanRunItemStatus} />
                    <span className="text-muted-foreground">{formatAction(item.action)}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title || item.externalId || '未命名作品'}</div>
                      <div className="truncate text-xs text-muted-foreground">{item.artistName || item.externalId}</div>
                      {item.errorMessage && <div className="mt-1 text-xs text-destructive">{item.errorMessage}</div>}
                    </div>
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <div className="truncate">{item.relativeDirectory || '-'}</div>
                      <div className="truncate">{item.metadataRelativePath || '-'}</div>
                    </div>
                    <span>{item.mediaCount}</span>
                  </div>
                ))}
                {!detailQuery.isFetching && detailQuery.data?.items.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的作品记录。</div>
                )}
                {detailQuery.isFetching && (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">正在加载详情...</div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HistoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: ScanRunStatus }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'COMPLETED' ? 'default' : 'outline'
  return <Badge variant={variant}>{formatStatus(status)}</Badge>
}

function ItemStatusBadge({ status }: { status: ScanRunItemStatus }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'SUCCESS' ? 'default' : 'outline'
  return <Badge variant={variant}>{formatItemStatus(status)}</Badge>
}

function formatStatus(status: ScanRunStatus) {
  return {
    RUNNING: '运行中',
    COMPLETED: '完成',
    FAILED: '失败',
    CANCELLED: '已取消'
  }[status]
}

function formatItemStatus(status: ScanRunItemStatus) {
  return {
    SUCCESS: '成功',
    SKIPPED: '跳过',
    FAILED: '失败'
  }[status]
}

function formatMode(mode: string) {
  return (
    {
      FULL: '强制全量',
      INCREMENTAL: '增量扫描',
      CLIENT_LIST: '客户端列表',
      RESCAN: '作品重扫',
      LOCAL_RESCAN: '本地重扫',
      LOCAL_DIRECTORY_IMPORT: '本地目录导入',
      LOCAL_CREATE: '本地创建',
      BATCH_CREATE: '批量创建',
      BATCH_REGISTER_IMAGES: '批量注册图片'
    }[mode] ?? mode
  )
}

function formatType(type: string) {
  return (
    {
      PIXIV: 'Pixiv',
      LOCAL_IMPORT: '本地导入',
      LOCAL_CREATE: '本地创建',
      BATCH_IMPORT: '批量导入'
    }[type] ?? type
  )
}

function formatAction(action: string) {
  return (
    {
      CREATE: '新增',
      UPDATE: '更新',
      SKIP_EXISTING: '已存在',
      SKIP_INVALID_METADATA: '无效 metadata',
      SKIP_NO_MEDIA: '无媒体',
      FAILED_PARSE: '解析失败',
      FAILED_COLLECT: '收集失败',
      FAILED_WRITE: '写入失败'
    }[action] ?? action
  )
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(value: number | null) {
  if (!value) return '-'
  if (value < 1000) return `${value}ms`
  return `${Math.round(value / 1000)}s`
}
