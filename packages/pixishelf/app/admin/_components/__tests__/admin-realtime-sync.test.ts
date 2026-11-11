import { QueryClient, QueryObserver } from '@tanstack/react-query'
import type { JobEventStreamItem, WorkerSnapshot } from '@pixishelf/job-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminRealtimeSync, adminRealtimeQueryOptions } from '../admin-realtime-sync'

const keys = { summary: ['summary'], list: ['list'], dashboard: ['dashboard'], duration: ['duration'] }
const timestamp = '2026-11-11T00:00:00.000Z'
const job = {
  id: 'duration-job',
  type: 'ANIMATION_DURATION_PROBE',
  status: 'RUNNING',
  progress: 10,
  updatedAt: timestamp
}
const dashboard = { recentJobs: [job], runningJobs: [job], runningJob: job, activeCount: 1, workers: [] }
const event = (id: number, patch = {}, type = 'job.progress') =>
  ({
    event: { id: String(id), type },
    job: { ...job, ...patch }
  }) as JobEventStreamItem

describe('shared admin realtime queries', () => {
  let client: QueryClient
  let sync: AdminRealtimeSync
  let subscriptions: Array<() => void>
  beforeEach(() => {
    vi.useFakeTimers()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    sync = new AdminRealtimeSync(client, keys)
    subscriptions = []
  })
  afterEach(() => {
    sync.dispose()
    subscriptions.forEach((unsubscribe) => unsubscribe())
    client.clear()
    vi.useRealTimers()
  })
  function watch(key: string[], initialData: unknown, queryFn = vi.fn(async () => initialData)) {
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn,
      initialData,
      staleTime: Infinity,
      ...adminRealtimeQueryOptions
    })
    subscriptions.push(observer.subscribe(() => undefined))
    return queryFn
  }

  it('has no periodic requests in either connection state and merges duplicate invalidations across observers', async () => {
    const summary = watch(keys.summary, { count: 0 })
    watch(keys.summary, { count: 0 }, summary)
    const list = watch([...keys.list, 'filtered-page-2'], { items: [], nextCursor: 'next' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(summary).not.toHaveBeenCalled()
    sync.disconnect()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(summary).not.toHaveBeenCalled()
    sync.invalidate(['archiveInbox'])
    sync.invalidate(['archiveInbox'])
    await vi.advanceTimersByTimeAsync(250)
    expect(summary).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(client.getQueryData([...keys.list, 'filtered-page-2'])).toEqual({ items: [], nextCursor: 'next' })
  })

  it('marks inactive queries stale without fetching them', async () => {
    client.setQueryData(keys.summary, { count: 0 })
    sync.invalidate(['archiveInbox'])
    await vi.advanceTimersByTimeAsync(250)
    expect(client.getQueryState(keys.summary)?.isInvalidated).toBe(true)
    expect(client.isFetching()).toBe(0)
  })

  it('keeps invalidated aggregate data stale across worker and progress patches until a returning view fetches it', async () => {
    client.setQueryData(keys.dashboard, dashboard)
    const updatedAt = client.getQueryState(keys.dashboard)?.dataUpdatedAt
    sync.invalidate(['jobDashboard'])
    await vi.advanceTimersByTimeAsync(250)
    sync.workers({ version: 1, sampledAt: timestamp, workers: [] })
    sync.jobs([event(1, { progress: 20, updatedAt: '2026-11-11T00:00:01Z' })])
    expect(client.getQueryState(keys.dashboard)).toMatchObject({ isInvalidated: true, dataUpdatedAt: updatedAt })
    const fetch = watch(keys.dashboard, dashboard)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledOnce()
    expect(client.getQueryState(keys.dashboard)?.isInvalidated).toBe(false)
  })

  it('patches known progress without HTTP requests and never overwrites a newer snapshot', async () => {
    const fetchDashboard = watch(keys.dashboard, dashboard)
    const fetchDuration = watch(keys.duration, job)
    sync.jobs([event(1, { progress: 20, updatedAt: '2026-11-11T00:00:01Z' })])
    expect(client.getQueryData(keys.duration)).toMatchObject({ progress: 20 })
    sync.jobs([event(2, { progress: 5 })])
    expect(client.getQueryData(keys.duration)).toMatchObject({ progress: 20 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchDashboard).not.toHaveBeenCalled()
    expect(fetchDuration).not.toHaveBeenCalled()
  })

  it('refreshes once for any terminal event in a batch and deduplicates replayed events', async () => {
    const fetchDashboard = watch(keys.dashboard, dashboard)
    const fetchDuration = watch(keys.duration, job)
    const batch = [event(1, { status: 'COMPLETED' }, 'job.completed'), event(2)]
    sync.jobs(batch)
    sync.jobs(batch)
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).toHaveBeenCalledOnce()
    expect(fetchDuration).toHaveBeenCalledOnce()
    sync.jobs([event(3, { id: 'new-job' }, 'job.queued')])
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDuration).toHaveBeenCalledTimes(2)
  })

  it('waits for an existing request then fetches once, coalescing changes during its follow-up', async () => {
    let complete!: (value: unknown) => void
    const oldRequest = new Promise((resolve) => {
      complete = resolve
    })
    const queryFn = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValue({ count: 2 })
    watch(keys.summary, { count: 0 }, queryFn)
    const first = client.fetchQuery({ queryKey: keys.summary, queryFn })
    sync.invalidate(['archiveInbox'])
    await vi.advanceTimersByTimeAsync(250)
    sync.invalidate(['archiveInbox'])
    await vi.advanceTimersByTimeAsync(250)
    expect(queryFn).toHaveBeenCalledOnce()
    complete({ count: 1 })
    await first
    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(keys.summary)).toEqual({ count: 2 })
  })

  it('coalesces ready/reset synchronization and supports manual refresh while disconnected', async () => {
    const fetchDashboard = watch(keys.dashboard, dashboard)
    sync.reset()
    sync.refreshAll()
    sync.refreshAll()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).toHaveBeenCalledOnce()
    sync.disconnect()
    sync.refreshAll()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).toHaveBeenCalledTimes(2)
  })

  it('updates worker heartbeats directly and queries only on availability changes', async () => {
    const fetchDashboard = watch(keys.dashboard, dashboard)
    const snapshot = (heartbeatAt: string, sampledAt: string) =>
      ({
        version: 1,
        sampledAt,
        workers: [
          {
            workerId: 'worker',
            status: 'READY',
            capabilities: [],
            heartbeatAt,
            serviceVersion: 'test',
            hostname: 'test',
            processId: 1,
            startedAt: timestamp,
            updatedAt: heartbeatAt,
            lastError: null
          }
        ]
      }) as WorkerSnapshot
    sync.workers(snapshot(timestamp, timestamp))
    sync.workers(snapshot('2026-11-11T00:00:15Z', '2026-11-11T00:00:15Z'))
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).not.toHaveBeenCalled()
    sync.workers(snapshot('2026-11-11T00:00:15Z', '2026-11-11T00:01:46Z'))
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).toHaveBeenCalledOnce()
    sync.workers(snapshot('2026-11-11T00:01:50Z', '2026-11-11T00:01:50Z'))
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchDashboard).toHaveBeenCalledTimes(2)
  })
})
