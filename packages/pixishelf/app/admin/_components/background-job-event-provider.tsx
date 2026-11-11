'use client'

import { fetchEventSource } from '@microsoft/fetch-event-source'
import {
  adminInvalidationSchema,
  jobEventStreamBatchSchema,
  workerSnapshotSchema,
  type JobEventStreamItem,
  type JobType
} from '@pixishelf/job-contracts'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { WifiOff } from 'lucide-react'
import { AdminRealtimeSync } from './admin-realtime-sync'

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
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const syncRef = useRef<AdminRealtimeSync | null>(null)
  const [status, setStatus] = useState<BackgroundJobEventConnectionStatus>('connecting')
  const [items, setItems] = useState<JobEventStreamItem[]>([])
  const [readyVersion, setReadyVersion] = useState(0)
  const [resetVersion, setResetVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const sync = new AdminRealtimeSync(queryClient, {
      summary: trpc.archiveInbox.summary.queryKey(),
      list: trpc.archiveInbox.list.queryKey(),
      dashboard: trpc.job.backgroundDashboard.queryKey(),
      duration: trpc.job.getAnimationDurationProbeStatus.queryKey()
    })
    syncRef.current = sync

    // fetch-event-source carries each SSE id forward as Last-Event-ID on its internal retries.
    void fetchEventSource('/api/jobs/events', {
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
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
          sync.refreshAll()
          return
        }
        if (message.event === 'jobs.reset') {
          setItems([])
          setResetVersion((value) => value + 1)
          sync.reset()
          return
        }
        if (message.event === 'admin.invalidate') {
          const parsed = adminInvalidationSchema.parse(safeJson(message.data))
          sync.invalidate(parsed.resources)
          return
        }
        if (message.event === 'workers.snapshot') {
          sync.workers(workerSnapshotSchema.parse(safeJson(message.data)))
          return
        }
        if (message.event !== 'jobs.events') return
        const parsed = jobEventStreamBatchSchema.safeParse(safeJson(message.data))
        if (!parsed.success) {
          setStatus('disconnected')
          setItems([])
          setResetVersion((value) => value + 1)
          sync.reset()
          throw new Error('Worker 事件流数据格式无效')
        }
        sync.jobs(parsed.data.items)
        setItems((current) => mergeRecentEvents(current, parsed.data.items))
      },
      onclose() {
        setStatus('disconnected')
        throw new Error('Worker 事件流已关闭')
      },
      onerror(error) {
        setStatus('disconnected')
        sync.disconnect()
        if (error instanceof FatalJobEventStreamError) throw error
        return 1_000
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setStatus('disconnected')
      if (error instanceof FatalJobEventStreamError) return
    })

    return () => {
      controller.abort()
      sync.dispose()
      syncRef.current = null
    }
  }, [queryClient, trpc])

  const value = useMemo(
    () => ({ status, items, readyVersion, resetVersion }),
    [items, readyVersion, resetVersion, status]
  )
  return (
    <BackgroundJobEventContext.Provider value={value}>
      {status === 'disconnected' ? (
        <div className="px-4 pt-4">
          <Alert variant="warning" role="status">
            <WifiOff aria-hidden="true" />
            <AlertDescription>
              <p>实时更新不可用，当前状态可能已过期</p>
              <Button variant="outline" size="sm" onClick={() => syncRef.current?.refreshAll()}>
                刷新状态
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {children}
    </BackgroundJobEventContext.Provider>
  )
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
