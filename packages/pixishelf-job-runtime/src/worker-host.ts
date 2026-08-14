import type { WorkerPresenceStatus } from '@pixishelf/job-contracts'
import { startHeartbeatLoop, type HeartbeatLoop, type HeartbeatScheduler } from './heartbeat-loop.js'
import { errorMessage, WorkerHealthState } from './worker-health-state.js'
import { createWorkerPresenceRecord, type WorkerIdentity, type WorkerPresenceStore } from './worker-presence.js'

export interface WorkerHostOptions {
  identity: WorkerIdentity
  presenceStore: WorkerPresenceStore
  healthState: WorkerHealthState
  heartbeatIntervalMs?: number
  now?: () => Date
  scheduler?: HeartbeatScheduler
  abortController?: AbortController
  onHeartbeatError?: (error: unknown) => void | Promise<void>
  onHeartbeatRecovered?: () => void | Promise<void>
}

export class WorkerHost {
  readonly abortController: AbortController
  private readonly startedAt: Date
  private readonly now: () => Date
  private heartbeatLoop: HeartbeatLoop | null = null
  private status: WorkerPresenceStatus = 'STARTING'
  private lastError: string | null = null
  private startPromise: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private presenceWrite: Promise<void> = Promise.resolve()

  constructor(private readonly options: WorkerHostOptions) {
    this.abortController = options.abortController ?? new AbortController()
    this.now = options.now ?? (() => new Date())
    this.startedAt = this.now()
  }

  get signal() {
    return this.abortController.signal
  }

  start() {
    this.startPromise ??= this.startInternal()
    return this.startPromise
  }

  private async startInternal() {
    await this.persist('STARTING')
    this.heartbeatLoop = startHeartbeatLoop({
      intervalMs: this.options.heartbeatIntervalMs ?? 30_000,
      beat: () => this.persist(this.status),
      signal: this.signal,
      ...(this.options.scheduler ? { scheduler: this.options.scheduler } : {}),
      onError: async (error) => {
        this.fail(error)
        this.status = 'DEGRADED'
        await this.options.onHeartbeatError?.(error)
      },
      onRecovered: async () => {
        if (this.status === 'DEGRADED' && !this.signal.aborted) {
          this.lastError = null
          this.status = 'READY'
          await this.persist('READY')
          this.options.healthState.recover()
        }
        await this.options.onHeartbeatRecovered?.()
      }
    })
  }

  async markReady() {
    await this.start()
    if (this.signal.aborted) throw new Error('Cannot mark a stopping worker as ready')
    this.status = 'READY'
    this.lastError = null
    await this.persist('READY')
    this.options.healthState.completePreflight()
  }

  fail(error: unknown) {
    this.lastError = errorMessage(error)
    this.options.healthState.fail(error)
  }

  shutdown() {
    this.shutdownPromise ??= this.shutdownInternal()
    return this.shutdownPromise
  }

  private async shutdownInternal() {
    this.options.healthState.beginDrain()
    this.status = 'STOPPING'
    this.abortController.abort(new Error('Worker is draining'))
    await this.startPromise?.catch(() => undefined)
    await this.heartbeatLoop?.stop()
    await this.persist('STOPPING').catch(() => undefined)
  }

  private async persist(status: WorkerPresenceStatus) {
    const record = createWorkerPresenceRecord(this.options.identity, status, this.now(), this.startedAt, this.lastError)
    const write = this.presenceWrite.catch(() => undefined).then(() => this.options.presenceStore.write(record))
    this.presenceWrite = write
    await write
  }
}
