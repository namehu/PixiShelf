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
  ScanRunStatus,
  StatusBadge
} from '@/app/admin/scan-history/_components/scan-history-format'

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

  return (
    <SCard
      title={
        <span className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-neutral-500" />
          最近扫描
        </span>
      }
      description="保留最近一次扫描摘要，完整审计记录已移到独立页面。"
      extra={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
            <RotateCcw className="h-4 w-4" />
            刷新
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/scan-history">
              查看历史
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      }
    >
      {latest ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={latest.status as ScanRunStatus} />
                <span className="text-sm text-muted-foreground">
                  {formatType(latest.type)} · {formatMode(latest.mode)}
                </span>
              </div>
              <p className="mt-2 text-sm text-neutral-600">
                {formatDate(latest.startedAt)} · 耗时 {formatDuration(latest.durationMs)}
              </p>
            </div>
            {latest.errorMessage && <p className="max-w-md text-sm text-destructive">{latest.errorMessage}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <SummaryStat label="发现" value={latest.totalArtworks} />
            <SummaryStat label="成功" value={latest.succeededArtworks} />
            <SummaryStat label="跳过" value={latest.skippedArtworks} />
            <SummaryStat label="失败" value={latest.failedArtworks} />
            <SummaryStat label="新增图片" value={latest.newImages} />
          </div>
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
    <div className="rounded-md border bg-neutral-50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}
