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
}

export class WorkerApplication {
  private startPromise: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null
  private hostStarted = false
  private hostStartPromise: Promise<void> | null = null
  private preflightPromise: Promise<void> | null = null

  constructor(private readonly options: WorkerApplicationOptions) {}

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
      await this.options.host.markReady()
      this.options.logger.info('worker.preflight_completed')
      this.options.logger.info('worker.awaiting_dispatcher_phase')
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

  shutdown(reason = 'signal') {
    this.options.healthState.beginDrain()
    this.shutdownPromise ??= this.shutdownInternal(reason)
    return this.shutdownPromise
  }

  private async shutdownInternal(reason: string) {
    this.options.logger.info('worker.draining', { reason })
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
  }
}
