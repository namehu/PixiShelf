'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, Clock3, FileSearch, RotateCcw } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { SCard } from '@/components/shared/s-card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatDate,
  formatDuration,
  formatMode,
  formatType,
  getSourceMaintenanceHref,
  isSourceAuditApplyRun,
  isSourceAuditRun,
  ScanRunStatus,
  StatusBadge
} from '@/app/admin/scan-history/_components/scan-history-format'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const ACTIVE_SCAN_RUN_STATUSES = new Set(['PENDING', 'RUNNING', 'PAUSED', 'RETRY_WAIT'])

export interface PixivScanActivity {
  id: string
  status: string
  progress: number
  message: string | null
  error: string | null
}

export function ScanHistorySummaryCard({
  activity,
  onRefreshActivity,
  isRefreshingActivity = false
}: {
  activity?: PixivScanActivity | null
  onRefreshActivity?: () => void
  isRefreshingActivity?: boolean
}) {
  const trpc = useTRPC()
  const historyQuery = useQuery(
    trpc.scanRun.list.queryOptions(
      { limit: 1, type: 'PIXIV' },
      {
        refetchInterval: (query) => {
          const latest = query.state.data?.[0]
          return activity || (latest && ACTIVE_SCAN_RUN_STATUSES.has(latest.status)) ? 2000 : 12000
        }
      }
    )
  )

  const latest = historyQuery.data?.find((run) => run.type === 'PIXIV') ?? null
  const sourceAudit = latest ? isSourceAuditRun(latest) : false
  const sourceAuditApply = latest ? isSourceAuditApplyRun(latest) : false
  const sourceMaintenance = sourceAudit || sourceAuditApply
  const sourceMaintenanceHref = latest ? getSourceMaintenanceHref(latest) : null
  const isRefreshing = historyQuery.isFetching || isRefreshingActivity

  const handleRefresh = () => {
    void historyQuery.refetch()
    onRefreshActivity?.()
  }

  return (
    <SCard
      title={
        <span className="flex items-center gap-2">
          {activity ? (
            <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Clock3 className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
          当前/最近扫描
        </span>
      }
      description="优先显示正在执行的 Pixiv 任务；任务完成后保留最近一次扫描摘要。"
      extra={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            刷新
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/scan-history">
              查看历史
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      }
    >
      {activity ? (
        <CurrentScanStatus activity={activity} />
      ) : historyQuery.isPending ? (
        <HistorySummarySkeleton />
      ) : historyQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>无法读取 Pixiv 扫描历史</AlertTitle>
          <AlertDescription>请使用“刷新”重试；若问题持续，请检查服务连接。</AlertDescription>
        </Alert>
      ) : latest ? (
        <LatestScanSummary
          latest={latest}
          sourceAudit={sourceAudit}
          sourceAuditApply={sourceAuditApply}
          sourceMaintenance={sourceMaintenance}
          sourceMaintenanceHref={sourceMaintenanceHref}
        />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearch aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>尚未记录 Pixiv 扫描历史</EmptyTitle>
            <EmptyDescription>完成一次 Pixiv 扫描后，这里会显示最近一次的结果。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SCard>
  )
}

function CurrentScanStatus({ activity }: { activity: PixivScanActivity }) {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <AdminStatusBadge status={activity.status}>{formatJobStatus(activity.status)}</AdminStatusBadge>
          <span className="text-sm text-muted-foreground">Worker 任务正在更新此状态。</span>
        </div>
        <span className="text-sm font-medium tabular-nums text-muted-foreground">{activity.progress}%</span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground">
          {activity.message ? <PrivacySensitiveText>{activity.message}</PrivacySensitiveText> : '等待 Worker 更新任务信息…'}
        </p>
        <Progress value={activity.progress} aria-label={`扫描进度 ${activity.progress}%`} />
      </div>

      {activity.error ? (
        <Alert variant="destructive">
          <AlertTitle>任务报告错误</AlertTitle>
          <AlertDescription>
            <PrivacySensitiveText>{activity.error}</PrivacySensitiveText>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function LatestScanSummary({
  latest,
  sourceAudit,
  sourceAuditApply,
  sourceMaintenance,
  sourceMaintenanceHref
}: {
  latest: {
    id: string
    type: string
    mode: string
    status: string
    operationKind: string | null
    sourceAuditRunId: string | null
    startedAt: Date | string | null
    durationMs: number | null
    errorMessage: string | null
    totalArtworks: number
    succeededArtworks: number
    skippedArtworks: number
    failedArtworks: number
    newImages: number
    walkedEntries: number | null
    metadataCandidates: number | null
    inventoryUnchanged: number | null
    contentHashed: number | null
    contentChanged: number | null
    parsedInputs: number | null
    publishedInputs: number | null
    missingInputs: number | null
    auditNewInputs: number | null
    auditChangedInputs: number | null
    auditInvalidInputs: number | null
    auditIdentityConflictInputs: number | null
  }
  sourceAudit: boolean
  sourceAuditApply: boolean
  sourceMaintenance: boolean
  sourceMaintenanceHref: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={latest.status as ScanRunStatus} />
            <span className="text-sm text-muted-foreground">
              {formatType(latest.type)} ·{' '}
              {formatMode(sourceMaintenance ? (latest.operationKind ?? latest.mode) : latest.mode)}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatDate(latest.startedAt)} · 耗时 {formatDuration(latest.durationMs)}
          </p>
        </div>
        {latest.errorMessage ? (
          <PrivacySensitiveText as="p" className="max-w-md text-sm text-destructive">
            {latest.errorMessage}
          </PrivacySensitiveText>
        ) : null}
      </div>

      {sourceAudit ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <SummaryStat label="来源新增" value={latest.auditNewInputs ?? 0} />
            <SummaryStat label="来源变化" value={latest.auditChangedInputs ?? 0} />
            <SummaryStat label="来源缺失" value={latest.missingInputs ?? 0} />
            <SummaryStat label="无效 metadata" value={latest.auditInvalidInputs ?? 0} />
            <SummaryStat label="身份冲突" value={latest.auditIdentityConflictInputs ?? 0} />
            <SummaryStat label="一致" value={latest.inventoryUnchanged ?? 0} />
          </div>
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/scan-history/${latest.id}/source-audit`}>
                查看核对结果
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </>
      ) : sourceAuditApply ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryStat label="所选" value={latest.totalArtworks} />
            <SummaryStat label="已应用" value={latest.succeededArtworks} />
            <SummaryStat label="跳过" value={latest.skippedArtworks} />
            <SummaryStat label="失败" value={latest.failedArtworks} />
          </div>
          {sourceMaintenanceHref ? (
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href={sourceMaintenanceHref}>
                  查看同步结果
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SummaryStat label="发现" value={latest.totalArtworks} />
          <SummaryStat label="成功" value={latest.succeededArtworks} />
          <SummaryStat label="跳过" value={latest.skippedArtworks} />
          <SummaryStat label="失败" value={latest.failedArtworks} />
          <SummaryStat label="新增图片" value={latest.newImages} />
        </div>
      )}

      {!sourceMaintenance && latest.walkedEntries !== null ? (
        <div className="rounded-lg border bg-muted/20 px-3 py-3">
          <div className="text-xs font-medium text-foreground">本次扫描工作量</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>遍历 {numberFormatter.format(latest.walkedEntries)}</span>
            <span>候选 {numberFormatter.format(latest.metadataCandidates ?? 0)}</span>
            <span>未变化 {numberFormatter.format(latest.inventoryUnchanged ?? 0)}</span>
            <span>读取 {numberFormatter.format(latest.contentHashed ?? 0)}</span>
            <span>变化 {numberFormatter.format(latest.contentChanged ?? 0)}</span>
            <span>解析 {numberFormatter.format(latest.parsedInputs ?? 0)}</span>
            <span>写入 {numberFormatter.format(latest.publishedInputs ?? 0)}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HistorySummarySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="正在加载 Pixiv 扫描状态" aria-busy="true">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-16" />
        ))}
      </div>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{numberFormatter.format(value)}</div>
    </div>
  )
}

function formatJobStatus(status: string) {
  return (
    {
      PENDING: '等待执行',
      RUNNING: '运行中',
      PAUSING: '正在暂停',
      PAUSED: '已暂停',
      RETRY_WAIT: '等待重试',
      CANCELLING: '正在取消'
    }[status] ?? status
  )
}
