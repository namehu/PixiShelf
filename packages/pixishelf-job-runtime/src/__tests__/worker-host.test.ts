import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkerHealthState } from '../worker-health-state.js'
import { WorkerHost } from '../worker-host.js'
import { PrismaWorkerPresenceStore, type WorkerPresenceRecord } from '../worker-presence.js'

describe('WorkerHost', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('persists lifecycle, heartbeats every interval, and shuts down idempotently', async () => {
    const writes: WorkerPresenceRecord[] = []
    let nowMs = Date.parse('2026-08-14T10:00:00.000Z')
    const healthState = new WorkerHealthState()
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-1',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }]
      },
      presenceStore: { write: async (record) => void writes.push(record) },
      healthState,
      heartbeatIntervalMs: 30_000,
      now: () => new Date(nowMs)
    })

    await host.start()
    await host.markReady()
    expect(writes.map((record) => record.status)).toEqual(['STARTING', 'READY'])
    expect(healthState.snapshot().ready).toBe(true)

    nowMs += 30_000
    await vi.advanceTimersByTimeAsync(30_000)
    expect(writes.at(-1)?.heartbeatAt).toBe('2026-08-14T10:00:30.000Z')

    await Promise.all([host.shutdown(), host.shutdown()])
    expect(host.signal.aborted).toBe(true)
    expect(writes.filter((record) => record.status === 'STOPPING')).toHaveLength(1)
    expect(healthState.snapshot().ready).toBe(false)
  })

  it('degrades on a failed heartbeat and recovers after a successful one', async () => {
    let writeCount = 0
    const writes: WorkerPresenceRecord[] = []
    const healthState = new WorkerHealthState()
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
          writeCount += 1
          if (writeCount === 3) throw new Error('database unavailable')
          writes.push(record)
        }
      },
      healthState,
      heartbeatIntervalMs: 30_000
    })
    await host.markReady()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(healthState.snapshot()).toMatchObject({ ready: false, lastError: 'database unavailable' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(healthState.snapshot()).toMatchObject({ ready: true, lastError: null })
    expect(writes.at(-1)?.status).toBe('READY')
    await host.shutdown()
  })

  it('persists STOPPING after an in-flight heartbeat and prevents later writes', async () => {
    const committed: WorkerPresenceRecord[] = []
    let scheduled: (() => void) | undefined
    let releaseHeartbeat: (() => void) | undefined
    let heartbeatStarted: (() => void) | undefined
    const heartbeatGate = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve
    })
    const started = new Promise<void>((resolve) => {
      heartbeatStarted = resolve
    })
    let writeCount = 0
    const healthState = new WorkerHealthState()
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
          writeCount += 1
          if (writeCount === 3) {
            heartbeatStarted?.()
            await heartbeatGate
          }
          committed.push(record)
        }
      },
      healthState,
      heartbeatIntervalMs: 30_000,
      scheduler: {
        schedule: (callback) => {
          scheduled = callback
          return callback
        },
        cancel: vi.fn()
      }
    })
    await host.markReady()

    scheduled?.()
    await started
    let shutdownCompleted = false
    const stopping = host.shutdown().then(() => {
      shutdownCompleted = true
    })
    await Promise.resolve()
    expect(shutdownCompleted).toBe(false)

    releaseHeartbeat?.()
    await stopping
    expect(committed.at(-1)?.status).toBe('STOPPING')

    const writeCountAfterShutdown = committed.length
    scheduled?.()
    await Promise.resolve()
    expect(committed).toHaveLength(writeCountAfterShutdown)
  })

  it('serializes a STARTING heartbeat before READY during a long preflight', async () => {
    const committed: WorkerPresenceRecord[] = []
    let scheduled: (() => void) | undefined
    let releaseHeartbeat: (() => void) | undefined
    let heartbeatStarted: (() => void) | undefined
    const heartbeatGate = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve
    })
    const started = new Promise<void>((resolve) => {
      heartbeatStarted = resolve
    })
    let writeCount = 0
    const healthState = new WorkerHealthState()
    const host = new WorkerHost({
      identity: {
        workerId: 'worker-preflight',
        serviceVersion: '1.0.0',
        hostname: 'worker-host',
        processId: 42,
        capabilities: []
      },
      presenceStore: {
        write: async (record) => {
          writeCount += 1
          if (writeCount === 2) {
            heartbeatStarted?.()
            await heartbeatGate
          }
          committed.push(record)
        }
      },
      healthState,
      scheduler: {
        schedule: (callback) => {
          scheduled = callback
          return callback
        },
        cancel: vi.fn()
      }
    })

    await host.start()
    scheduled?.()
    await started
    const ready = host.markReady()
    await Promise.resolve()
    expect(healthState.snapshot().ready).toBe(false)
    releaseHeartbeat?.()
    await ready

    expect(committed.map((record) => record.status)).toEqual(['STARTING', 'STARTING', 'READY'])
    expect(healthState.snapshot().ready).toBe(true)
    await host.shutdown()
  })
})

describe('PrismaWorkerPresenceStore', () => {
  it('maps ISO timestamps to database Date values', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    const store = new PrismaWorkerPresenceStore({ workerInstance: { upsert } })
    await store.write({
      workerId: 'worker-1',
      status: 'STARTING',
      serviceVersion: '1.0.0',
      hostname: 'worker-host',
      processId: 42,
      capabilities: [],
      startedAt: '2026-08-14T10:00:00.000Z',
      heartbeatAt: '2026-08-14T10:00:00.000Z',
      lastError: null,
      updatedAt: '2026-08-14T10:00:00.000Z'
    })
    expect(upsert.mock.calls[0]?.[0].create.startedAt).toBeInstanceOf(Date)
  })
})
