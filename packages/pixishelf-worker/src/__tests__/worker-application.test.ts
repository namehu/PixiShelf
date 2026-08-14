import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { WorkerHealthState, WorkerHost, type WorkerPresenceRecord } from '@pixishelf/job-runtime'
import type { WorkerHealthServer } from '../health-server.js'
import { registerShutdownSignals, type SignalSource } from '../shutdown-signals.js'
import { WorkerApplication } from '../worker-application.js'

describe('WorkerApplication', () => {
  it('becomes ready without an executor and drains exactly once', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    const order: string[] = []
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-1',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: []
      },
      presenceStore: {
        write: async (record) => {
          records.push(record)
          order.push(`presence:${record.status}`)
        }
      },
      healthState: state
    })
    const healthServer: WorkerHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      address: () => null
    }
    const events: string[] = []
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const application = new WorkerApplication({
      healthState: state,
      healthServer,
      host,
      logger: {
        info: (event) => void events.push(event),
        warn: (event) => void events.push(event),
        error: (event) => void events.push(event)
      },
      preflight: async () => void order.push('preflight'),
      disconnectDatabase
    })

    await application.start()
    expect(state.snapshot().ready).toBe(true)
    expect(order.slice(0, 3)).toEqual(['presence:STARTING', 'preflight', 'presence:READY'])
    expect(events).toContain('worker.awaiting_dispatcher_phase')
    await Promise.all([application.shutdown('SIGTERM'), application.shutdown('SIGINT')])
    expect(disconnectDatabase).toHaveBeenCalledOnce()
    expect(healthServer.close).toHaveBeenCalledOnce()
    expect(records.filter((record) => record.status === 'STOPPING')).toHaveLength(1)
  })

  it('records STOPPING and cleans resources when preflight fails', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-1',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: []
      },
      presenceStore: { write: async (record) => void records.push(record) },
      healthState: state
    })
    const healthServer: WorkerHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      address: () => null
    }
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const application = new WorkerApplication({
      healthState: state,
      healthServer,
      host,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      preflight: vi
        .fn()
        .mockRejectedValue(new Error('ffprobe unavailable at postgresql://worker:super-secret@postgres/pixishelf')),
      disconnectDatabase
    })

    await expect(application.start()).rejects.toThrow('ffprobe unavailable')
    expect(records.map((record) => record.status)).toEqual(['STARTING', 'STOPPING'])
    expect(records.at(-1)?.lastError).toContain('postgresql://[REDACTED]@postgres/pixishelf')
    expect(records.at(-1)?.lastError).not.toContain('super-secret')
    expect(disconnectDatabase).toHaveBeenCalledOnce()
    expect(healthServer.close).toHaveBeenCalledOnce()
    expect(state.snapshot()).toMatchObject({ live: false, ready: false, draining: true })
  })

  it('prepares dispatch before READY, activates only after READY, and drains before STOPPING', async () => {
    const state = new WorkerHealthState()
    const order: string[] = []
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-dispatch',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: [{ jobType: 'SCAN', definitionVersions: [1] }]
      },
      presenceStore: {
        write: async (record) => void order.push(`presence:${record.status}`)
      },
      healthState: state
    })
    const dispatcher = {
      prepare: vi.fn(async () => void order.push('dispatcher:prepare')),
      activate: vi.fn(() => {
        expect(state.snapshot().ready).toBe(true)
        order.push('dispatcher:activate')
      }),
      stop: vi.fn(async () => void order.push('dispatcher:stop'))
    }
    const application = new WorkerApplication({
      healthState: state,
      healthServer: {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        address: () => null
      },
      host,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      preflight: async () => void order.push('preflight'),
      disconnectDatabase: vi.fn().mockResolvedValue(undefined),
      dispatcher
    })

    await application.start()
    expect(order).toEqual([
      'presence:STARTING',
      'preflight',
      'dispatcher:prepare',
      'presence:READY',
      'dispatcher:activate'
    ])
    await application.shutdown('SIGTERM')
    expect(order.indexOf('dispatcher:stop')).toBeLessThan(order.indexOf('presence:STOPPING'))
  })

  it('never records READY when dispatcher preparation fails', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-dispatch-failed',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: [{ jobType: 'SCAN', definitionVersions: [1] }]
      },
      presenceStore: { write: async (record) => void records.push(record) },
      healthState: state
    })
    const application = new WorkerApplication({
      healthState: state,
      healthServer: {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        address: () => null
      },
      host,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      preflight: vi.fn().mockResolvedValue(undefined),
      disconnectDatabase: vi.fn().mockResolvedValue(undefined),
      dispatcher: {
        prepare: vi.fn().mockRejectedValue(new Error('dispatcher configuration invalid')),
        activate: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined)
      }
    })

    await expect(application.start()).rejects.toThrow('dispatcher configuration invalid')
    expect(records.map(({ status }) => status)).toEqual(['STARTING', 'STOPPING'])
    expect(state.snapshot().ready).toBe(false)
  })

  it('does not persist STOPPING or disconnect the database until dispatcher drain finishes', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    let releaseDrain: (() => void) | undefined
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-fatal-drain',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: [{ jobType: 'SCAN', definitionVersions: [1] }]
      },
      presenceStore: { write: async (record) => void records.push(record) },
      healthState: state
    })
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const dispatcher = {
      prepare: vi.fn().mockResolvedValue(undefined),
      activate: vi.fn(),
      stop: vi.fn(() => drainGate)
    }
    const application = new WorkerApplication({
      healthState: state,
      healthServer: {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        address: () => null
      },
      host,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      preflight: vi.fn().mockResolvedValue(undefined),
      disconnectDatabase,
      dispatcher
    })
    await application.start()

    const stopping = application.shutdown('dispatcher-fatal')
    await vi.waitFor(() => expect(dispatcher.stop).toHaveBeenCalledOnce())
    expect(records.map(({ status }) => status)).toEqual(['STARTING', 'READY'])
    expect(disconnectDatabase).not.toHaveBeenCalled()
    releaseDrain?.()
    await stopping

    expect(records.map(({ status }) => status)).toEqual(['STARTING', 'READY', 'STOPPING'])
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('stops a host whose STARTING presence write finishes after shutdown begins', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    let releaseStarting: (() => void) | undefined
    const startingGate = new Promise<void>((resolve) => {
      releaseStarting = resolve
    })
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-race',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: []
      },
      presenceStore: {
        write: async (record) => {
          records.push(record)
          if (record.status === 'STARTING') await startingGate
        }
      },
      healthState: state
    })
    const healthServer: WorkerHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      address: () => null
    }
    const preflight = vi.fn().mockResolvedValue(undefined)
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const application = new WorkerApplication({
      healthState: state,
      healthServer,
      host,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      preflight,
      disconnectDatabase
    })

    const starting = application.start()
    await vi.waitFor(() => expect(records.map((record) => record.status)).toContain('STARTING'))
    const stopping = application.shutdown('SIGTERM')
    releaseStarting?.()
    await Promise.all([starting, stopping])

    expect(preflight).not.toHaveBeenCalled()
    expect(records.map((record) => record.status)).toEqual(['STARTING', 'STOPPING'])
    expect(host.signal.aborted).toBe(true)
    expect(disconnectDatabase).toHaveBeenCalledOnce()
    expect(healthServer.close).toHaveBeenCalledOnce()
    await application.shutdown('SIGINT')
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('treats SIGTERM during preflight as a clean cancellation', async () => {
    const state = new WorkerHealthState()
    const records: WorkerPresenceRecord[] = []
    const events: string[] = []
    let preflightStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      preflightStarted = resolve
    })
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-preflight-signal',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: []
      },
      presenceStore: { write: async (record) => void records.push(record) },
      healthState: state
    })
    const healthServer: WorkerHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      address: () => null
    }
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const application = new WorkerApplication({
      healthState: state,
      healthServer,
      host,
      logger: {
        info: (event) => void events.push(event),
        warn: (event) => void events.push(event),
        error: (event) => void events.push(event)
      },
      preflight: () =>
        new Promise<void>((_resolve, reject) => {
          preflightStarted?.()
          host.signal.addEventListener('abort', () => reject(host.signal.reason), { once: true })
        }),
      disconnectDatabase
    })

    const starting = application.start()
    await started
    const stopping = application.shutdown('SIGTERM')
    await expect(Promise.all([starting, stopping])).resolves.toBeDefined()

    expect(events).toContain('worker.startup_cancelled')
    expect(events).not.toContain('worker.startup_failed')
    expect(records.at(-1)).toMatchObject({ status: 'STOPPING', lastError: null })
    expect(disconnectDatabase).toHaveBeenCalledOnce()
    expect(healthServer.close).toHaveBeenCalledOnce()
  })

  it('registers both shutdown signals and can unregister them', () => {
    const source = new EventEmitter()
    const shutdown = vi.fn()
    const unregister = registerShutdownSignals(source as SignalSource, shutdown)
    source.emit('SIGTERM')
    source.emit('SIGINT')
    expect(shutdown.mock.calls).toEqual([['SIGTERM'], ['SIGINT']])
    unregister()
    expect(source.listenerCount('SIGTERM')).toBe(0)
    expect(source.listenerCount('SIGINT')).toBe(0)
  })
})
