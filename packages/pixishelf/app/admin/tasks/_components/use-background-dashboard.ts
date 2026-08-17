'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import type { JobDto, JobEventDto, JobStatus } from '@pixishelf/job-contracts'
import { useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { ACTIVE_JOB_STATUSES, mergeJobEvents } from './background-task-format'

export function useBackgroundDashboard() {
  const trpc = useTRPC()
  return useQuery(
    trpc.job.backgroundDashboard.queryOptions(undefined, {
      refetchInterval: (query) => {
        const dashboard = query.state.data
        return dashboard && (dashboard.activeCount > 0 || dashboard.queuedCount > 0) ? 1_500 : 8_000
      }
    })
  )
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
        refetchInterval: active ? 1_500 : false,
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

  return {
    ...query,
    events: stream?.events ?? EMPTY_EVENTS,
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
  const query = useQuery(
    trpc.job.backgroundDetail.queryOptions(
      { jobId: jobId ?? '__none__' },
      {
        enabled: Boolean(jobId),
        refetchInterval: (detailQuery) => {
          const detail = detailQuery.state.data as JobDto | null | undefined
          const current = reconcileBackgroundJobDetail(detail, dashboardJob)
          return current && ACTIVE_JOB_STATUSES.includes(current.status) ? 1_500 : false
        },
        retry: false
      }
    )
  )

  const currentDetail = query.data?.id === jobId ? query.data : null
  const currentDashboardJob = dashboardJob?.id === jobId ? dashboardJob : null
  return { ...query, data: reconcileBackgroundJobDetail(currentDetail, currentDashboardJob) }
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
  const priority = useMutation(trpc.job.changeBackgroundJobPriority.mutationOptions(common('队列优先级已更新')))

  return { cancel, pause, resume, retry, priority }
}
