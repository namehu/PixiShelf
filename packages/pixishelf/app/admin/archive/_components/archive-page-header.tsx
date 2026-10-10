'use client'

import Link from 'next/link'
import type { inferRouterOutputs } from '@trpc/server'
import { Archive, Inbox, RefreshCw } from 'lucide-react'
import type { AppRouter } from '@/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ArchiveAddDialog } from './archive-add-dialog'
import { archiveLaneStatusLabel } from './archive-task-view-state'

type Dashboard = inferRouterOutputs<AppRouter>['job']['backgroundDashboard']

export function ArchivePageActions({
  refreshing,
  onRefresh,
  onCreated
}: {
  refreshing: boolean
  onRefresh: () => void
  onCreated: () => void
}) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
        刷新
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/admin/archive/inbox?tab=inbox">
          <Inbox data-icon="inline-start" aria-hidden="true" />
          收件箱
        </Link>
      </Button>
      <ArchiveAddDialog
        trigger={
          <Button size="sm">
            <Archive data-icon="inline-start" aria-hidden="true" />
            添加链接
          </Button>
        }
        onCreated={onCreated}
      />
    </>
  )
}

export function WorkerLaneStrip({ dashboard, loading }: { dashboard: Dashboard | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2" aria-label="正在加载后台任务通道">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-28" />
      </div>
    )
  }
  if (!dashboard) {
    return (
      <Badge variant="warning" role="status">
        通道状态不可用，请确认后台进程已启动
      </Badge>
    )
  }
  const laneNames: Record<string, string> = {
    ARCHIVE_RESOLVE: '链接解析',
    BACKGROUND_WRITER: '媒体写入'
  }
  return (
    <section className="flex flex-wrap items-center gap-2" aria-label="后台任务执行通道">
      {dashboard.lanes.map((lane) => (
        <Badge
          key={lane.executionLane}
          variant={
            lane.status === 'ERROR' || lane.status === 'DRAINING'
              ? 'warning'
              : lane.status === 'RUNNING'
                ? 'info'
                : 'muted'
          }
        >
          {laneNames[lane.executionLane] ?? lane.executionLane} · {archiveLaneStatusLabel(lane.status)}
          {lane.runningJob && <span className="tabular-nums">{lane.runningJob.progress}%</span>}
        </Badge>
      ))}
    </section>
  )
}
