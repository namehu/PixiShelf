import type { WorkerHealthState, WorkerHost } from '@pixishelf/job-runtime'
import type { WorkerHealthServer } from './health-server.js'
import type { WorkerLogger } from './logger.js'

export interface WorkerApplicationOptions {
  healthState: WorkerHealthState
  healthServer: WorkerHealthServer
  host: WorkerHost
  logger: WorkerLogger
  preflight(): Promise<void>
  disconnectDatabase(): Promise<void>
  forceTerminate?(exitCode: number): void
  presenceReadinessGate?: { allowReady(): void }
  dispatcher?: {
    prepare(): Promise<void>
    activate(): void
    stop(reason?: string): Promise<void>
  }
  dispatchers?: Array<{
    prepare(): Promise<void>
    activate(): void
    stop(reason?: string): Promise<void>
  }>
}

export interface WorkerShutdownOptions {
  forceAfterMs?: number
}

export class WorkerApplication {
  private startPromise: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private hostStarted = false
  private hostStartPromise: Promise<void> | null = null
  private preflightPromise: Promise<void> | null = null
  private dispatcherPreparePromise: Promise<void> | null = null
  private dispatcherPrepared = false
  private forceTerminationTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: WorkerApplicationOptions) {}

  private get dispatchers() {
    return this.options.dispatchers ?? (this.options.dispatcher ? [this.options.dispatcher] : [])
  }

  start() {
    this.startPromise ??= this.startInternal()
    return this.startPromise
  }

  private async startInternal() {
    await this.options.healthServer.start()
    if (this.options.healthState.snapshot().draining) return
    this.options.logger.info('worker.preflight_started')
    try {
      this.hostStartPromise = this.options.host.start()
      await this.hostStartPromise
      this.hostStarted = true
      if (this.options.healthState.snapshot().draining) {
        await this.options.host.shutdown()
        return
      }
      this.preflightPromise = this.options.preflight()
      await this.preflightPromise
      if (this.options.healthState.snapshot().draining) {
        await this.options.host.shutdown()
        return
      }
      if (this.dispatchers.length > 0) {
        this.dispatcherPreparePromise = Promise.all(this.dispatchers.map((dispatcher) => dispatcher.prepare())).then(
          () => undefined
        )
        await this.dispatcherPreparePromise
        this.dispatcherPrepared = true
        if (this.options.healthState.snapshot().draining) {
          await Promise.all(this.dispatchers.map((dispatcher) => dispatcher.stop('startup-drain')))
          await this.options.host.shutdown()
          return
        }
      }
      this.options.presenceReadinessGate?.allowReady()
      await this.options.host.markReady()
      if (this.options.healthState.snapshot().draining) {
        if (this.dispatcherPrepared) {
          await Promise.all(this.dispatchers.map((dispatcher) => dispatcher.stop('startup-drain')))
        }
        await this.options.host.shutdown()
        return
      }
      for (const dispatcher of this.dispatchers) dispatcher.activate()
      this.options.logger.info('worker.preflight_completed')
      this.options.logger.info(
        this.dispatchers.length > 0 ? 'worker.dispatch_ready' : 'worker.awaiting_dispatcher_phase'
      )
    } catch (error) {
      if (this.options.healthState.snapshot().draining || this.options.host.signal.aborted) {
        this.options.logger.info('worker.startup_cancelled')
        await this.shutdown()
        return
      }
      this.options.host.fail(error)
      this.options.logger.error('worker.startup_failed', { error })
      await this.shutdown()
      throw error
    }
  }

  shutdown(reason = 'signal', shutdownOptions: WorkerShutdownOptions = {}) {
    this.options.healthState.beginDrain()
    if (shutdownOptions.forceAfterMs !== undefined) {
      this.armForceTermination(reason, shutdownOptions.forceAfterMs)
    }
    this.shutdownPromise ??= this.shutdownInternal(reason)
    return this.shutdownPromise
  }

  private armForceTermination(reason: string, forceAfterMs: number) {
    if (!Number.isSafeInteger(forceAfterMs) || forceAfterMs <= 0) {
      throw new Error('forceAfterMs must be a positive safe integer')
    }
    if (this.forceTerminationTimer) return
    this.forceTerminationTimer = setTimeout(() => {
      this.options.logger.error('worker.force_terminate', { reason, forceAfterMs })
      this.options.forceTerminate?.(1)
    }, forceAfterMs)
    this.forceTerminationTimer.unref()
  }

  private async shutdownInternal(reason: string) {
    this.options.logger.info('worker.draining', { reason })
    if (this.dispatcherPreparePromise) {
      await this.dispatcherPreparePromise
        .then(() => {
          this.dispatcherPrepared = true
        })
        .catch(() => undefined)
    }
    if (this.dispatcherPrepared) {
      await Promise.all(this.dispatchers.map((dispatcher) => dispatcher.stop(reason)))
    }
    if (this.hostStartPromise) {
      await this.hostStartPromise
        .then(() => {
          this.hostStarted = true
        })
        .catch(() => undefined)
    }
    if (this.hostStarted) await this.options.host.shutdown()
    await this.preflightPromise?.catch(() => undefined)
    await this.options.healthServer.close().catch((error) => {
      this.options.logger.warn('worker.health_server_close_failed', { error })
    })
    await this.options.disconnectDatabase().catch((error) => {
      this.options.logger.error('worker.database_disconnect_failed', { error })
    })
    this.options.healthState.markStopped()
    this.options.logger.info('worker.stopped')
    if (this.forceTerminationTimer) {
      clearTimeout(this.forceTerminationTimer)
      this.forceTerminationTimer = null
    }
  }
}
