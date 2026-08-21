'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Clock3, RotateCcw } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { SCard } from '@/components/shared/s-card'
import { Button } from '@/components/ui/button'
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

export function ScanHistorySummaryCard() {
  const trpc = useTRPC()
  const historyQuery = useQuery(
    trpc.scanRun.list.queryOptions(
      { limit: 1 },
      {
        refetchInterval: (query) => {
          const latest = query.state.data?.[0]
          return latest?.status === 'RUNNING' ? 2000 : 12000
        }
      }
    )
  )

  const latest = historyQuery.data?.[0] ?? null
  const sourceAudit = latest ? isSourceAuditRun(latest) : false
  const sourceAuditApply = latest ? isSourceAuditApplyRun(latest) : false
  const sourceMaintenance = sourceAudit || sourceAuditApply
  const sourceMaintenanceHref = latest ? getSourceMaintenanceHref(latest) : null

  return (
    <SCard
      title={
        <span className="flex items-center gap-2">
          <Clock3 className="size-5 text-muted-foreground" aria-hidden="true" />
          最近扫描
        </span>
      }
      description="保留最近一次扫描摘要，完整审计记录已移到独立页面。"
      extra={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
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
      {latest ? (
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
            {latest.errorMessage && <p className="max-w-md text-sm text-destructive">{latest.errorMessage}</p>}
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
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          尚未记录扫描历史。
        </div>
      )}
    </SCard>
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
