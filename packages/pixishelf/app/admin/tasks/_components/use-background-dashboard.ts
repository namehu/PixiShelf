'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import type { JobDto, JobEventDto, JobStatus } from '@pixishelf/job-contracts'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { ACTIVE_JOB_STATUSES, mergeJobEvents } from './background-task-format'
import { useOptionalBackgroundJobEventSubscription as useLiveJobEvents } from '../../_components/background-job-event-provider'
import { collectUnseenLiveEvents, mergeLiveJobSnapshot, type LiveEventCursor } from './live-event-reconciliation'

export function useBackgroundDashboard() {
  const trpc = useTRPC()
  const live = useLiveJobEvents()
  const liveEventCursor = useRef<LiveEventCursor>({ resetVersion: 0, eventId: null })
  const query = useQuery(
    trpc.job.backgroundDashboard.queryOptions(undefined, {
      refetchInterval: (query) => {
        if (live.status === 'connected') return false
        const dashboard = query.state.data
        return dashboard && (dashboard.activeCount > 0 || dashboard.queuedCount > 0) ? 3_000 : 30_000
      }
    })
  )
  useEffect(() => {
    if (live.readyVersion > 0 || live.resetVersion > 0) void query.refetch()
  }, [live.readyVersion, live.resetVersion, query.refetch])
  useEffect(() => {
    if (!query.data) return
    const unseen = collectUnseenLiveEvents(live.items, live.resetVersion, liveEventCursor.current)
    liveEventCursor.current = unseen.cursor
    if (unseen.items.length === 0) return
    const knownJobIds = new Set([
      ...query.data.recentJobs.map((job) => job.id),
      ...query.data.runningJobs.map((job) => job.id),
      ...(query.data.runningJob ? [query.data.runningJob.id] : [])
    ])
    const needsSnapshot = unseen.items.some(
      ({ event, job }) =>
        !knownJobIds.has(job.id) ||
        TERMINAL_JOB_STATUSES.includes(job.status) ||
        !['job.progress', 'job.stage_changed'].includes(event.type)
    )
    if (needsSnapshot) void query.refetch()
  }, [live.items, live.resetVersion, query.data, query.refetch])
  const data = useMemo(() => patchDashboardJobs(query.data, live.items), [live.items, query.data])
  return { ...query, data }
}

const TERMINAL_JOB_STATUSES: JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED']
const EMPTY_EVENTS: JobEventDto[] = []

interface JobEventStream {
  events: JobEventDto[]
  afterEventId?: string
  drainedTerminalStatus?: JobStatus
}

type JobEventStreams = Record<string, JobEventStream>

type JobEventStreamAction = {
  type: 'page'
  jobId: string
  jobStatus: JobStatus
  requestedAfterEventId?: string
  items: JobEventDto[]
  lastEventId: string | null
}

function eventStreamsReducer(state: JobEventStreams, action: JobEventStreamAction): JobEventStreams {
  const current = state[action.jobId] ?? { events: [] }
  if (current.afterEventId !== action.requestedAfterEventId) return state

  const items = action.items.filter((event) => event.jobId === action.jobId)
  if (items.length !== action.items.length) return state
  const terminal = TERMINAL_JOB_STATUSES.includes(action.jobStatus)
  const afterEventId = items.at(-1)?.id ?? action.lastEventId ?? current.afterEventId
  return {
    ...state,
    [action.jobId]: {
      events: mergeJobEvents(current.events, items),
      afterEventId,
      drainedTerminalStatus: terminal && items.length === 0 ? action.jobStatus : undefined
    }
  }
}

export function useBackgroundJobEvents(job: JobDto | null) {
  const trpc = useTRPC()
  const [streams, dispatch] = useReducer(eventStreamsReducer, {})
  const jobId = job?.id ?? null
  const stream = jobId ? streams[jobId] : undefined
  const afterEventId = stream?.afterEventId
  const active = Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status))
  const live = useLiveJobEvents({ jobId: jobId ?? '__none__' })
  const terminalDrainComplete = Boolean(
    job && TERMINAL_JOB_STATUSES.includes(job.status) && stream?.drainedTerminalStatus === job.status
  )
  const requestedJobId = jobId ?? '__none__'
  const requestedJobStatus = job?.status ?? 'PENDING'
  const requestedAfterEventId = afterEventId
  const query = useQuery(
    trpc.job.backgroundEvents.queryOptions(
      { jobId: requestedJobId, afterEventId: requestedAfterEventId, limit: 100 },
      {
        enabled: Boolean(job) && !terminalDrainComplete,
        refetchInterval: live.status === 'connected' ? false : active ? 3_000 : false,
        retry: false,
        select: (data) => ({
          ...data,
          requestedJobId,
          requestedJobStatus,
          requestedAfterEventId
        })
      }
    )
  )

  useEffect(() => {
    const data = query.data
    if (!data || !jobId || data.requestedJobId !== jobId) return
    dispatch({
      type: 'page',
      jobId,
      jobStatus: data.requestedJobStatus,
      requestedAfterEventId: data.requestedAfterEventId,
      items: data.items,
      lastEventId: data.lastEventId
    })
  }, [jobId, query.data])

  useEffect(() => {
    if (!job || !TERMINAL_JOB_STATUSES.includes(job.status) || terminalDrainComplete) return
    void query.refetch()
  }, [job?.id, job?.status, query.refetch, terminalDrainComplete])

  useEffect(() => {
    if (!job || (live.readyVersion === 0 && live.resetVersion === 0)) return
    void query.refetch()
  }, [jobId, live.readyVersion, live.resetVersion, query.refetch])

  const liveEvents = live.items.map(({ event }) => event)

  return {
    ...query,
    events: mergeJobEvents(stream?.events ?? EMPTY_EVENTS, liveEvents),
    isPolling: query.fetchStatus === 'fetching' && (active || !terminalDrainComplete),
    terminalDrainComplete
  }
}

export function reconcileBackgroundJobDetail(detail: JobDto | null | undefined, dashboardJob: JobDto | null) {
  if (!detail) return dashboardJob
  if (!dashboardJob || detail.id !== dashboardJob.id) return detail
  const dashboardTerminal = TERMINAL_JOB_STATUSES.includes(dashboardJob.status)
  const detailActive = ACTIVE_JOB_STATUSES.includes(detail.status)
  if (dashboardTerminal && detailActive) return dashboardJob
  return new Date(dashboardJob.updatedAt).getTime() > new Date(detail.updatedAt).getTime() ? dashboardJob : detail
}

export function useBackgroundJobDetail(jobId: string | null, dashboardJob: JobDto | null) {
  const trpc = useTRPC()
  const live = useLiveJobEvents({ jobId: jobId ?? '__none__' })
  const query = useQuery(
    trpc.job.backgroundDetail.queryOptions(
      { jobId: jobId ?? '__none__' },
      {
        enabled: Boolean(jobId),
        refetchInterval: (detailQuery) => {
          const detail = detailQuery.state.data as JobDto | null | undefined
          const current = reconcileBackgroundJobDetail(detail, dashboardJob)
          if (live.status === 'connected') return false
          return current && ACTIVE_JOB_STATUSES.includes(current.status) ? 3_000 : false
        },
        retry: false
      }
    )
  )

  const currentDetail = query.data?.id === jobId ? query.data : null
  const currentDashboardJob = dashboardJob?.id === jobId ? dashboardJob : null
  const reconciled = reconcileBackgroundJobDetail(currentDetail, currentDashboardJob)
  const liveJob = live.items.at(-1)?.job
  return {
    ...query,
    data: reconciled ? mergeLiveJobSnapshot(reconciled, liveJob) : reconciled
  }
}

function patchDashboardJobs<
  TDashboard extends { recentJobs: JobDto[]; runningJobs: JobDto[]; runningJob: JobDto | null }
>(dashboard: TDashboard | undefined, items: ReturnType<typeof useLiveJobEvents>['items']): TDashboard | undefined {
  if (!dashboard || items.length === 0) return dashboard
  const latestByJob = new Map(items.map(({ job }) => [job.id, job]))
  const patch = (job: JobDto) => mergeLiveJobSnapshot(job, latestByJob.get(job.id))
  return {
    ...dashboard,
    recentJobs: dashboard.recentJobs.map(patch),
    runningJobs: dashboard.runningJobs.map(patch),
    runningJob: dashboard.runningJob ? patch(dashboard.runningJob) : null
  }
}

export function useBackgroundJobControls(onSuccess: (job?: JobDto) => void) {
  const trpc = useTRPC()
  const common = (message: string) => ({
    onSuccess: (job: JobDto) => {
      toast.success(message)
      onSuccess(job)
    },
    onError: (error: { message: string }) => {
      toast.error(`操作失败：${error.message}`)
    }
  })
  const cancel = useMutation(trpc.job.cancelBackgroundJob.mutationOptions(common('取消请求已提交')))
  const pause = useMutation(trpc.job.pauseBackgroundJob.mutationOptions(common('暂停请求已提交')))
  const resume = useMutation(trpc.job.resumeBackgroundJob.mutationOptions(common('任务已重新排队')))
  const retry = useMutation(trpc.job.retryBackgroundJob.mutationOptions(common('重试任务已加入队列')))
  const acknowledge = useMutation(
    trpc.job.acknowledgeBackgroundJobFailure.mutationOptions({
      onSuccess: () => {
        toast.success('提醒已忽略，失败记录仍保留')
        onSuccess()
      },
      onError: (error: { message: string }) => {
        toast.error(`操作失败：${error.message}`)
      }
    })
  )
  const priority = useMutation(trpc.job.changeBackgroundJobPriority.mutationOptions(common('队列优先级已更新')))

  return { cancel, pause, resume, retry, acknowledge, priority }
}
