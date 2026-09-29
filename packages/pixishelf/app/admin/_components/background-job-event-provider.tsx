'use client'

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { jobEventStreamBatchSchema, type JobEventStreamItem, type JobType } from '@pixishelf/job-contracts'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const MAX_RECENT_EVENTS = 500

export type BackgroundJobEventConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface BackgroundJobEventContextValue {
  status: BackgroundJobEventConnectionStatus
  items: JobEventStreamItem[]
  readyVersion: number
  resetVersion: number
}

const BackgroundJobEventContext = createContext<BackgroundJobEventContextValue | null>(null)
const DISCONNECTED_JOB_EVENT_CONTEXT: BackgroundJobEventContextValue = {
  status: 'disconnected',
  items: [],
  readyVersion: 0,
  resetVersion: 0
}

class FatalJobEventStreamError extends Error {}

export function BackgroundJobEventProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BackgroundJobEventConnectionStatus>('connecting')
  const [items, setItems] = useState<JobEventStreamItem[]>([])
  const [readyVersion, setReadyVersion] = useState(0)
  const [resetVersion, setResetVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    // fetch-event-source carries each SSE id forward as Last-Event-ID on its internal retries.
    void fetchEventSource('/api/jobs/events', {
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          setStatus('connected')
          return
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new FatalJobEventStreamError(`Worker 事件流鉴权失败（${response.status}）`)
        }
        throw new Error(`Worker 事件流连接失败（${response.status}）`)
      },
      onmessage(message) {
        if (message.event === 'ping') return
        if (message.event === 'jobs.ready') {
          setStatus('connected')
          setReadyVersion((value) => value + 1)
          return
        }
        if (message.event === 'jobs.reset') {
          setItems([])
          setResetVersion((value) => value + 1)
          return
        }
        if (message.event !== 'jobs.events') return
        const parsed = jobEventStreamBatchSchema.safeParse(safeJson(message.data))
        if (!parsed.success) {
          setStatus('disconnected')
          setItems([])
          setResetVersion((value) => value + 1)
          return
        }
        setItems((current) => mergeRecentEvents(current, parsed.data.items))
      },
      onclose() {
        setStatus('disconnected')
        throw new Error('Worker 事件流已关闭')
      },
      onerror(error) {
        setStatus('disconnected')
        if (error instanceof FatalJobEventStreamError) throw error
        return 1_000
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setStatus('disconnected')
      if (error instanceof FatalJobEventStreamError) return
    })

    return () => controller.abort()
  }, [])

  const value = useMemo(
    () => ({ status, items, readyVersion, resetVersion }),
    [items, readyVersion, resetVersion, status]
  )
  return <BackgroundJobEventContext.Provider value={value}>{children}</BackgroundJobEventContext.Provider>
}

export function useBackgroundJobEvents(): BackgroundJobEventContextValue {
  const value = useContext(BackgroundJobEventContext)
  if (!value) throw new Error('useBackgroundJobEvents must be used inside BackgroundJobEventProvider')
  return value
}

export function useBackgroundJobEventSubscription(
  filter: { jobType?: JobType; jobId?: string } = {}
): BackgroundJobEventContextValue {
  const value = useBackgroundJobEvents()
  const items = useMemo(
    () =>
      value.items.filter(
        (item) =>
          (filter.jobType === undefined || item.job.type === filter.jobType) &&
          (filter.jobId === undefined || item.job.id === filter.jobId)
      ),
    [filter.jobId, filter.jobType, value.items]
  )
  return useMemo(() => ({ ...value, items }), [items, value])
}

export function useOptionalBackgroundJobEventSubscription(
  filter: { jobType?: JobType; jobId?: string } = {}
): BackgroundJobEventContextValue {
  const value = useContext(BackgroundJobEventContext) ?? DISCONNECTED_JOB_EVENT_CONTEXT
  const items = useMemo(
    () =>
      value.items.filter(
        (item) =>
          (filter.jobType === undefined || item.job.type === filter.jobType) &&
          (filter.jobId === undefined || item.job.id === filter.jobId)
      ),
    [filter.jobId, filter.jobType, value.items]
  )
  return useMemo(() => ({ ...value, items }), [items, value])
}

export function mergeRecentEvents(current: JobEventStreamItem[], incoming: JobEventStreamItem[]): JobEventStreamItem[] {
  if (incoming.length === 0) return current
  const byId = new Map(current.map((item) => [item.event.id, item]))
  for (const item of incoming) byId.set(item.event.id, item)
  return [...byId.values()]
    .sort((left, right) => compareCursor(left.event.id, right.event.id))
    .slice(-MAX_RECENT_EVENTS)
}

function compareCursor(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
