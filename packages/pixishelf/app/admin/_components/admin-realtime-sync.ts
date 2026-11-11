import type { Query, QueryClient, QueryKey, Updater } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { AdminRealtimeResource, JobEventStreamItem, WorkerSnapshot } from '@pixishelf/job-contracts'
import type { AppRouter } from '@/server'
import { isWorkerHeartbeatFresh } from '@/services/background-task/worker-heartbeat'
import { mergeLiveJobSnapshot } from '../tasks/_components/live-event-reconciliation'

export const adminRealtimeQueryOptions = {
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false
} as const

type Outputs = inferRouterOutputs<AppRouter>
type Dashboard = Outputs['job']['backgroundDashboard']
type DurationJob = Outputs['job']['getAnimationDurationProbeStatus']
type Target = 'summary' | 'list' | 'dashboard' | 'duration'
export type AdminRealtimeQueryKeys = Record<Target, QueryKey>
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'])

/** One coordinator per admin layout, independent of how many views observe each query. */
export class AdminRealtimeSync {
  private pending = new Set<Target>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = new Map<string, { dirty: boolean }>()
  private disposed = false
  private lastEventId = 0n
  private workerSignature: string | undefined

  constructor(
    private readonly client: QueryClient,
    private readonly keys: AdminRealtimeQueryKeys
  ) {}

  refreshAll() {
    this.schedule('summary', 'list', 'dashboard', 'duration')
  }

  invalidate(resources: AdminRealtimeResource[]) {
    if (resources.includes('archiveInbox')) this.schedule('summary', 'list')
    if (resources.includes('jobDashboard')) this.schedule('dashboard')
  }

  jobs(items: JobEventStreamItem[]) {
    for (const { event, job } of items) {
      if (BigInt(event.id) <= this.lastEventId) continue
      this.lastEventId = BigInt(event.id)
      const dashboard = this.client.getQueryData<Dashboard>(this.keys.dashboard)
      const known = dashboard && [...dashboard.recentJobs, ...dashboard.runningJobs].some((item) => item.id === job.id)
      if (!known || TERMINAL.has(job.status) || !['job.progress', 'job.stage_changed'].includes(event.type)) {
        this.schedule('dashboard')
      }
      this.patch<Dashboard>(this.keys.dashboard, (cached) =>
        cached
          ? {
              ...cached,
              recentJobs: cached.recentJobs.map((item) => mergeLiveJobSnapshot(item, job)),
              runningJobs: cached.runningJobs.map((item) => mergeLiveJobSnapshot(item, job)),
              runningJob: cached.runningJob ? mergeLiveJobSnapshot(cached.runningJob, job) : null
            }
          : cached
      )
      if (job.type !== 'ANIMATION_DURATION_PROBE') continue
      const current = this.client.getQueryData<DurationJob>(this.keys.duration)
      if (current?.id !== job.id || TERMINAL.has(job.status)) this.schedule('duration')
      this.patch<DurationJob>(this.keys.duration, (cached) => (cached ? mergeLiveJobSnapshot(cached, job) : cached))
    }
  }

  workers(snapshot: WorkerSnapshot) {
    const signature = JSON.stringify(
      snapshot.workers
        .map((worker) => [
          worker.workerId,
          worker.status,
          worker.capabilities,
          isWorkerHeartbeatFresh(worker.heartbeatAt, new Date(snapshot.sampledAt))
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    )
    if (this.workerSignature !== undefined && this.workerSignature !== signature) this.schedule('dashboard')
    this.workerSignature = signature
    this.patch<Dashboard>(this.keys.dashboard, (cached) => (cached ? { ...cached, workers: snapshot.workers } : cached))
  }

  reset() {
    this.lastEventId = 0n
    this.workerSignature = undefined
  }

  disconnect() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
  }

  dispose() {
    this.disposed = true
    this.disconnect()
  }

  private patch<T>(queryKey: QueryKey, updater: Updater<T | undefined, T | undefined>) {
    const state = this.client.getQueryState(queryKey)
    this.client.setQueryData<T>(queryKey, updater, { updatedAt: state?.dataUpdatedAt })
    // Partial SSE fields do not make the full HTTP snapshot fresh again.
    if (state?.isInvalidated) void this.client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
  }

  private schedule(...targets: Target[]) {
    for (const target of targets) this.pending.add(target)
    if (this.timer !== undefined || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const targets = [...this.pending]
      this.pending.clear()
      for (const target of targets) {
        const queryKey = this.keys[target]
        void this.client.invalidateQueries({ queryKey, refetchType: 'none' })
        for (const query of this.client.getQueryCache().findAll({ queryKey, type: 'active' })) {
          void this.refreshQuery(query)
        }
      }
    }, 250)
  }

  private async refreshQuery(query: Query) {
    const existing = this.running.get(query.queryHash)
    if (existing) {
      existing.dirty = true
      return
    }
    const state = { dirty: false }
    this.running.set(query.queryHash, state)
    const filters = { queryKey: query.queryKey, exact: true, type: 'active' as const }
    // A request started before the notification may contain an older snapshot.
    if (query.state.fetchStatus === 'fetching') {
      await this.client.refetchQueries(filters, { cancelRefetch: false })
    }
    do {
      state.dirty = false
      if (!this.disposed) await this.client.refetchQueries(filters, { cancelRefetch: false })
    } while (state.dirty && !this.disposed)
    this.running.delete(query.queryHash)
  }
}
