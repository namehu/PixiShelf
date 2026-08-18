import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { WorkerHealthState } from '@pixishelf/job-runtime'
import type { WorkerLogger } from './logger.js'

export interface HealthServerOptions {
  state: WorkerHealthState
  host: string
  port: number
  logger: WorkerLogger
}

export interface WorkerHealthServer {
  start(): Promise<void>
  close(): Promise<void>
  address(): AddressInfo | null
}

export function createWorkerHealthServer(options: HealthServerOptions): WorkerHealthServer {
  let server: Server | null = null
  let startPromise: Promise<void> | null = null
  let closePromise: Promise<void> | null = null
  let closeRequested = false

  return {
    start() {
      if (closeRequested) return Promise.reject(new Error('Health server is closing'))
      if (startPromise) return startPromise
      const nextServer = createServer((request, response) => {
        const state = options.state.snapshot()
        if (request.method !== 'GET') {
          response.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }))
          return
        }
        if (request.url === '/livez') {
          response.writeHead(state.live ? 200 : 503, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: state.live }))
          return
        }
        if (request.url === '/readyz') {
          response.writeHead(state.ready ? 200 : 503, { 'content-type': 'application/json' })
          const laneStatus = state.draining ? 'DRAINING' : state.ready ? 'READY' : 'ERROR'
          response.end(
            JSON.stringify({
              ok: state.ready,
              draining: state.draining,
              lanes: {
                ARCHIVE_RESOLVE: laneStatus,
                BACKGROUND_WRITER: laneStatus
              }
            })
          )
          return
        }
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }))
      })

      server = nextServer
      const attempt = new Promise<void>((resolve, reject) => {
        nextServer.once('error', reject)
        nextServer.listen(options.port, options.host, () => {
          nextServer.removeListener('error', reject)
          options.logger.info('worker.health_server_listening', { host: options.host, port: this.address()?.port })
          resolve()
        })
      })
      startPromise = attempt.catch((error) => {
        if (server === nextServer) server = null
        startPromise = null
        throw error
      })
      return startPromise
    },
    close() {
      closeRequested = true
      closePromise ??= (async () => {
        await startPromise?.catch(() => undefined)
        const activeServer = server
        if (!activeServer) return
        if (activeServer.listening) {
          await new Promise<void>((resolve, reject) => {
            activeServer.close((error) => (error ? reject(error) : resolve()))
          })
        }
        if (server === activeServer) server = null
      })()
      return closePromise
    },
    address() {
      const address = server?.address()
      return address && typeof address !== 'string' ? address : null
    }
  }
}
