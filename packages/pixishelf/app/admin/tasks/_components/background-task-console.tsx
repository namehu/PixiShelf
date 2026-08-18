'use client'

import type { JobDto, JobEventDto, JobStatus, WorkerHealthDto } from '@pixishelf/job-contracts'
import {
  Activity,
  AlertTriangle,
  Ban,
  ChevronDown,
  Clock3,
  Cpu,
  ListOrdered,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  SquareActivity
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { confirm } from '@/components/shared/global-confirm'
import {
  canCancelJob,
  canChangePriority,
  canPauseJob,
  canResumeJob,
  canRetryJob,
  formatBackgroundDate,
  formatBackgroundEventType,
  formatBackgroundJobStatus,
  formatBackgroundJobType,
  formatHeartbeatAge,
  getWorkerHealth,
  getWorkerSummary
} from './background-task-format'
import {
  useBackgroundDashboard,
  useBackgroundJobControls,
  useBackgroundJobDetail,
  useBackgroundJobEvents
} from './use-background-dashboard'

export interface BackgroundDashboardView {
  counts: Record<JobStatus, number>
  queuedCount: number
  activeCount: number
  runningJob: JobDto | null
  recentJobs: JobDto[]
  workers: WorkerHealthDto[]
}

export function BackgroundTaskConsole() {
  const dashboardQuery = useBackgroundDashboard()
  const dashboard = dashboardQuery.data as BackgroundDashboardView | undefined
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedJobId || !dashboard) return
    setSelectedJobId(dashboard.runningJob?.id ?? dashboard.recentJobs[0]?.id ?? null)
  }, [dashboard, selectedJobId])

  const dashboardSelectedJob =
    dashboard?.recentJobs.find((job) => job.id === selectedJobId) ??
    (dashboard?.runningJob?.id === selectedJobId ? dashboard.runningJob : null)
  const detailQuery = useBackgroundJobDetail(selectedJobId, dashboardSelectedJob ?? null)
  const selectedJob = detailQuery.data
  const controls = useBackgroundJobControls((job) => {
    if (job) setSelectedJobId(job.id)
    void dashboardQuery.refetch()
    void detailQuery.refetch()
  })

  if (dashboardQuery.isPending) {
    return (
      <section aria-label="后台任务控制台" className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" /> 正在读取串行队列与 Worker 状态…
        </div>
      </section>
    )
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <section
        aria-label="后台任务控制台读取失败"
        className="rounded-xl border border-destructive/30 bg-card p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">无法读取后台队列</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {dashboardQuery.error?.message ?? '查询返回了空数据。'}
            </p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => void dashboardQuery.refetch()}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" /> 重试
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <BackgroundTaskConsoleView
      dashboard={dashboard}
      selectedJob={selectedJob}
      selectedJobLoading={detailQuery.isPending && Boolean(selectedJobId)}
      onSelectJob={setSelectedJobId}
      onRefresh={() => {
        void dashboardQuery.refetch()
        if (selectedJobId) void detailQuery.refetch()
      }}
      refreshing={dashboardQuery.isFetching || detailQuery.isFetching}
      controls={controls}
      detailError={detailQuery.isError ? detailQuery.error : null}
      onRetryDetail={() => void detailQuery.refetch()}
    />
  )
}

export interface BackgroundControlsView {
  cancel: { isPending: boolean; mutate: (input: { jobId: string }) => void }
  pause: { isPending: boolean; mutate: (input: { jobId: string }) => void }
  resume: { isPending: boolean; mutate: (input: { jobId: string }) => void }
  retry: { isPending: boolean; mutate: (input: { jobId: string }) => void }
  priority: { isPending: boolean; mutate: (input: { jobId: string; priority: number }) => void }
}

export function BackgroundTaskConsoleView({
  dashboard,
  selectedJob,
  selectedJobLoading,
  onSelectJob,
  onRefresh,
  refreshing,
  controls,
  detailError = null,
  onRetryDetail
}: {
  dashboard: BackgroundDashboardView
  selectedJob: JobDto | null
  selectedJobLoading: boolean
  onSelectJob: (jobId: string) => void
  onRefresh: () => void
  refreshing: boolean
  controls: BackgroundControlsView
  detailError?: { message: string } | null
  onRetryDetail?: () => void
}) {
  const workerSummary = getWorkerSummary(dashboard.workers)
  const running = dashboard.runningJob

  return (
    <section
      aria-labelledby="background-console-title"
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SquareActivity className="size-5 text-primary" aria-hidden="true" />
            <h2 id="background-console-title" className="font-semibold tracking-tight">
              串行后台作业控制台
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">中央队列只允许一个 Worker 执行槽；排队不代表任务已完成。</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={refreshing}
          className="self-start sm:self-auto"
        >
          <RefreshCw
            data-icon="inline-start"
            className={cn(refreshing && 'animate-spin motion-reduce:animate-none')}
            aria-hidden="true"
          />
          刷新状态
        </Button>
      </header>

      <div className="grid min-w-0 gap-px bg-border lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="min-w-0 bg-card p-4 sm:p-5">
          <ExecutionSlot job={running} queuedCount={dashboard.queuedCount} />
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="后台任务状态汇总">
            <SummaryCell label="队列等待" value={dashboard.queuedCount} emphasized />
            <SummaryCell label="正在占槽" value={dashboard.activeCount} />
            <SummaryCell label="已暂停" value={dashboard.counts.PAUSED} />
            <SummaryCell label="失败" value={dashboard.counts.FAILED} />
            <SummaryCell label="已完成" value={dashboard.counts.COMPLETED} />
          </dl>
        </div>
        <WorkerPanel workers={dashboard.workers} label={workerSummary.label} />
      </div>

      <div className="grid min-w-0 border-t lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
        <RecentJobs jobs={dashboard.recentJobs} selectedJobId={selectedJob?.id ?? null} onSelectJob={onSelectJob} />
        <div className="min-w-0 border-t lg:border-t-0 lg:border-l">
          {detailError ? (
            <div
              role="status"
              className="m-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm sm:m-5 sm:mb-0"
            >
              <p className="break-words text-destructive">任务详情刷新失败：{detailError.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                当前显示最近一次队列快照；重试以确认任务是否已进入终态。
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={onRetryDetail}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                重试任务详情
              </Button>
            </div>
          ) : null}
          {selectedJobLoading && !selectedJob ? (
            <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <Spinner aria-hidden="true" />
              正在读取任务详情…
            </div>
          ) : selectedJob ? (
            <JobDetail job={selectedJob} controls={controls} />
          ) : (
            <div className="p-5 text-sm text-muted-foreground">选择一条近期任务，查看控制项和结构化事件。</div>
          )}
        </div>
      </div>
    </section>
  )
}

function ExecutionSlot({ job, queuedCount }: { job: JobDto | null; queuedCount: number }) {
  const active = Boolean(job)
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border p-4',
        active ? 'border-primary/35 bg-primary/[0.035]' : 'border-dashed bg-muted/10'
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-border" aria-hidden="true">
        {active ? <span className="block h-1/3 w-full animate-pulse bg-primary motion-reduce:animate-none" /> : null}
      </div>
      <div className="flex min-w-0 items-start gap-3 pl-1">
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          {active ? (
            <Activity className="size-5" aria-hidden="true" />
          ) : (
            <Clock3 className="size-5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">唯一执行槽</span>
            <AdminStatusBadge status={job?.status ?? 'IDLE'}>
              {job ? formatBackgroundJobStatus(job.status) : '空闲'}
            </AdminStatusBadge>
          </div>
          {job ? (
            <>
              <p className="mt-2 font-semibold">{formatBackgroundJobType(job.type)}</p>
              <p className="mt-1 select-text break-all font-mono text-xs text-muted-foreground">{job.id}</p>
              <div className="mt-3 flex items-center gap-3">
                <Progress value={job.progress} className="h-2 flex-1" aria-label={`任务进度 ${job.progress}%`} />
                <span className="text-xs font-semibold tabular-nums">{job.progress}%</span>
              </div>
              {job.message ? (
                <p className="mt-2 select-text break-words text-sm text-muted-foreground">{job.message}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              当前没有任务占用执行槽，队列中有 {queuedCount} 项等待。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCell({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/10 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 text-lg font-semibold tabular-nums', emphasized && value > 0 && 'text-primary')}>
        {value}
      </dd>
    </div>
  )
}

function WorkerPanel({ workers, label }: { workers: WorkerHealthDto[]; label: string }) {
  const now = Date.now()
  const workerEntries = workers.map((worker) => ({ worker, health: getWorkerHealth(worker, now) }))
  const currentWorkers = workerEntries.filter(({ health }) => !health.stale)
  const historicalWorkers = workerEntries.filter(({ health }) => health.stale)

  return (
    <section aria-labelledby="worker-health-title" className="min-w-0 bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id="worker-health-title" className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="size-4 text-primary" aria-hidden="true" />
          Worker 健康
        </h3>
        <AdminStatusBadge status={workers.some((worker) => getWorkerHealth(worker).healthy) ? 'READY' : 'FAILED'}>
          {label}
        </AdminStatusBadge>
      </div>
      {workers.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">没有注册的 Worker</p>
          <p className="mt-1 text-muted-foreground">队列可接收任务，但不会开始执行。请启动 pixishelf-worker。</p>
        </div>
      ) : (
        <>
          {currentWorkers.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {currentWorkers.map(({ worker, health }) => (
                <WorkerInstanceCard key={worker.workerId} worker={worker} ageMs={health.ageMs} />
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">当前没有在线 Worker</p>
              <p className="mt-1 text-muted-foreground">现有记录均已离线，队列中的任务暂时不会开始执行。</p>
            </div>
          )}

          {historicalWorkers.length > 0 ? (
            <details className="group mt-3 rounded-lg border border-dashed bg-muted/15 text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                <Clock3 className="size-4 shrink-0" aria-hidden="true" />
                <span className="font-medium text-foreground">历史实例</span>
                <span className="text-xs">{historicalWorkers.length} 条 · 不参与任务执行</span>
                <ChevronDown
                  className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-t border-dashed px-3 pt-2 pb-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  容器重启或重建后保留的诊断记录，不会领取任务，并会按保留策略自动清理。
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {historicalWorkers.map(({ worker, health }) => (
                    <WorkerInstanceCard key={worker.workerId} worker={worker} ageMs={health.ageMs} historical />
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

function WorkerInstanceCard({
  worker,
  ageMs,
  historical = false
}: {
  worker: WorkerHealthDto
  ageMs: number
  historical?: boolean
}) {
  return (
    <li className={cn('min-w-0 rounded-lg border p-3 text-sm', historical && 'border-dashed bg-muted/15')}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{worker.workerId}</span>
        </span>
        <AdminStatusBadge status={historical ? 'IDLE' : worker.status}>
          {historical ? '历史记录' : worker.status}
        </AdminStatusBadge>
      </div>
      <p className="mt-2 select-text break-all font-mono text-xs text-muted-foreground">
        {worker.hostname}:{worker.processId} · {worker.serviceVersion}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {historical ? '最后心跳' : '心跳'} {formatHeartbeatAge(ageMs)}
      </p>
      {worker.lastError ? (
        <p className="mt-2 select-text break-words text-xs text-destructive">{worker.lastError}</p>
      ) : null}
    </li>
  )
}

function RecentJobs({
  jobs,
  selectedJobId,
  onSelectJob
}: {
  jobs: JobDto[]
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
}) {
  return (
    <section aria-labelledby="recent-jobs-title" className="min-w-0 p-4 sm:p-5">
      <h3 id="recent-jobs-title" className="flex items-center gap-2 text-sm font-semibold">
        <ListOrdered className="size-4 text-primary" aria-hidden="true" />
        近期任务
      </h3>
      {jobs.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          队列为空，还没有中央后台任务记录。
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => onSelectJob(job.id)}
                aria-pressed={selectedJobId === job.id}
                className={cn(
                  'w-full min-w-0 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedJobId === job.id && 'border-primary/40 bg-primary/[0.04]'
                )}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{formatBackgroundJobType(job.type)}</span>
                  <AdminStatusBadge status={job.status}>{formatBackgroundJobStatus(job.status)}</AdminStatusBadge>
                </span>
                <span className="mt-1 block select-text break-all font-mono text-[11px] text-muted-foreground">
                  {job.id}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {formatBackgroundDate(job.createdAt)} · 优先级 {job.effectivePriority}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function JobDetail({ job, controls }: { job: JobDto; controls: BackgroundControlsView }) {
  const eventQuery = useBackgroundJobEvents(job)
  const [priority, setPriority] = useState(String(job.queuePriority))
  useEffect(() => setPriority(String(job.queuePriority)), [job.id, job.queuePriority])
  const anyPending =
    controls.cancel.isPending ||
    controls.pause.isPending ||
    controls.resume.isPending ||
    controls.retry.isPending ||
    controls.priority.isPending
  const priorityNumber = Number(priority)
  const priorityRange = job.triggerSource === 'MANUAL' || job.triggerSource === 'RETRY' ? [0, 99] : [100, 999]
  const priorityInvalid =
    !Number.isInteger(priorityNumber) || priorityNumber < priorityRange[0]! || priorityNumber > priorityRange[1]!

  return (
    <article aria-labelledby="job-detail-title" className="min-w-0 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="job-detail-title" className="text-sm font-semibold">
              {formatBackgroundJobType(job.type)}
            </h3>
            <AdminStatusBadge status={job.status}>{formatBackgroundJobStatus(job.status)}</AdminStatusBadge>
          </div>
          <p className="mt-1 select-text break-all font-mono text-xs text-muted-foreground">{job.id}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            触发：{job.triggerSource} · 尝试 {job.attempt}/{job.maxAttempts} · 创建于{' '}
            {formatBackgroundDate(job.createdAt)}
          </p>
        </div>
        <JobActions job={job} controls={controls} disabled={anyPending} />
      </div>

      {canChangePriority(job) ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/10 p-3">
          <label htmlFor={`priority-${job.id}`} className="flex flex-col gap-1 text-xs text-muted-foreground">
            队列优先级
            <Input
              id={`priority-${job.id}`}
              name={`background-job-${job.id}-priority`}
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={priorityRange[0]}
              max={priorityRange[1]}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-8 w-24 bg-background"
              aria-invalid={priorityInvalid}
              aria-describedby={priorityInvalid ? `priority-${job.id}-error` : undefined}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={priorityInvalid || priorityNumber === job.queuePriority || controls.priority.isPending}
            onClick={() => controls.priority.mutate({ jobId: job.id, priority: priorityNumber })}
          >
            更新优先级
          </Button>
          <p
            id={`priority-${job.id}-error`}
            role={priorityInvalid ? 'alert' : undefined}
            className={cn(
              'basis-full text-xs',
              priorityInvalid ? 'font-medium text-destructive' : 'text-muted-foreground'
            )}
          >
            {job.triggerSource === 'MANUAL' || job.triggerSource === 'RETRY'
              ? '手动/重试任务允许 0–99'
              : '计划/系统任务允许 100–999'}
            ；数字越小越先执行。
          </p>
        </div>
      ) : null}

      {job.status === 'RUNNING' || job.status === 'PAUSING' || job.status === 'CANCELLING' ? (
        <div className="mt-4 flex items-center gap-3">
          <Progress value={job.progress} className="h-2 flex-1" aria-label={`任务进度 ${job.progress}%`} />
          <span className="text-xs font-semibold tabular-nums">{job.progress}%</span>
        </div>
      ) : null}
      {job.message ? <p className="mt-3 select-text break-words text-sm text-muted-foreground">{job.message}</p> : null}
      {job.error ? (
        <p className="mt-3 select-text break-words rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {job.errorCode ? `${job.errorCode}：` : ''}
          {job.error}
        </p>
      ) : null}

      <EventTimeline
        key={job.id}
        job={job}
        events={eventQuery.events}
        pending={eventQuery.isPending}
        error={eventQuery.isError ? eventQuery.error : null}
        polling={eventQuery.isPolling}
        onRetry={() => void eventQuery.refetch()}
      />
    </article>
  )
}

function JobActions({ job, controls, disabled }: { job: JobDto; controls: BackgroundControlsView; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canPauseJob(job) ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => controls.pause.mutate({ jobId: job.id })}
        >
          <Pause data-icon="inline-start" aria-hidden="true" />
          暂停
        </Button>
      ) : null}
      {canResumeJob(job) ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => controls.resume.mutate({ jobId: job.id })}
        >
          <Play data-icon="inline-start" aria-hidden="true" />
          继续
        </Button>
      ) : null}
      {canRetryJob(job) ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => controls.retry.mutate({ jobId: job.id })}
        >
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          重试
        </Button>
      ) : null}
      {canCancelJob(job) ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={disabled}
          onClick={() =>
            confirm({
              title: `取消“${formatBackgroundJobType(job.type)}”？`,
              description:
                job.status === 'PENDING' || job.status === 'RETRY_WAIT' || job.status === 'PAUSED'
                  ? '任务会从队列中取消，不会开始后续处理；此前已经发布的产物会保留。'
                  : 'Worker 会在当前阶段的取消检查点停止；已经完成并发布的产物会保留，未完成的阶段之后可以重试。',
              confirmText: '确认取消',
              variant: 'destructive',
              onConfirm: () => controls.cancel.mutate({ jobId: job.id })
            })
          }
        >
          <Ban data-icon="inline-start" aria-hidden="true" />
          取消
        </Button>
      ) : null}
    </div>
  )
}

const EVENT_SEGMENT_SIZE = 50

function EventTimeline({
  job,
  events,
  pending,
  error,
  polling,
  onRetry
}: {
  job: JobDto
  events: JobEventDto[]
  pending: boolean
  error: { message: string } | null
  polling: boolean
  onRetry: () => void
}) {
  const [visibleCount, setVisibleCount] = useState(EVENT_SEGMENT_SIZE)
  const hiddenCount = Math.max(0, events.length - visibleCount)
  const visibleEvents = hiddenCount > 0 ? events.slice(-visibleCount) : events

  return (
    <section aria-labelledby={`events-${job.id}`} className="mt-5 min-w-0 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 id={`events-${job.id}`} className="text-sm font-semibold">
            结构化事件时间线
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">按事件编号增量读取；文本可选择复制。</p>
        </div>
        {polling ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
              aria-hidden="true"
            />
            跟随运行中
          </span>
        ) : null}
      </div>
      {pending && events.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          正在读取事件…
        </div>
      ) : null}
      {error ? (
        <div role="status" className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
          <p className="break-words text-destructive">事件读取失败：{error.message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            重试事件查询
          </Button>
        </div>
      ) : null}
      {!pending && !error && events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          这个任务还没有事件记录。
        </p>
      ) : null}
      {events.length > 0 ? (
        <>
          {hiddenCount > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <span>
                已保存 {events.length} 条事件，当前显示最近 {visibleEvents.length} 条。
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setVisibleCount((count) => count + EVENT_SEGMENT_SIZE)}
              >
                显示更早事件（{Math.min(hiddenCount, EVENT_SEGMENT_SIZE)}）
              </Button>
            </div>
          ) : null}
          <ol className="relative mt-4 flex min-w-0 flex-col gap-0 border-l border-primary/20 pl-4">
            {visibleEvents.map((event) => (
              <EventItem key={event.id} event={event} />
            ))}
          </ol>
        </>
      ) : null}
    </section>
  )
}

function EventItem({ event }: { event: JobEventDto }) {
  const dataText = event.data === null ? null : JSON.stringify(event.data, null, 2)
  return (
    <li className="relative min-w-0 pb-4 last:pb-0">
      <span
        className={cn(
          'absolute -left-[1.22rem] top-1 size-2 rounded-full ring-4 ring-card',
          event.level === 'ERROR' ? 'bg-destructive' : event.level === 'WARN' ? 'bg-warning' : 'bg-primary'
        )}
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{formatBackgroundEventType(event.type)}</span>
        <span className="select-text font-mono text-[11px] text-muted-foreground">#{event.id}</span>
        <time dateTime={event.createdAt} className="text-xs text-muted-foreground">
          {formatBackgroundDate(event.createdAt)}
        </time>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {event.stage ? <span>阶段 {event.stage}</span> : null}
        {event.progress !== null ? <span>进度 {event.progress}%</span> : null}
        <span>尝试 {event.attempt}</span>
        {event.workerId ? <span className="select-text break-all font-mono">Worker {event.workerId}</span> : null}
      </div>
      {event.message ? <p className="mt-1 select-text break-words text-sm">{event.message}</p> : null}
      {dataText ? (
        <pre className="mt-2 max-w-full select-text overflow-x-auto rounded-md bg-muted/45 p-2 text-xs leading-5 whitespace-pre-wrap break-all">
          {dataText}
        </pre>
      ) : null}
    </li>
  )
}
