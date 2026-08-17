import { describe, expect, it, vi } from 'vitest'
import { cleanupStaleWorkerInstances, PrismaWorkerPresenceStore } from '../worker-presence.js'

describe('worker instance retention', () => {
  it('selects one bounded batch with separate STOPPING and inactive thresholds', async () => {
    const findMany = vi.fn().mockResolvedValue([{ workerId: 'stale-stopping' }, { workerId: 'stale-ready' }])
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 })
    const now = new Date('2026-08-17T00:00:00.000Z')

    const result = await cleanupStaleWorkerInstances({ workerInstance: { findMany, deleteMany } }, now, {
      batchSize: 2
    })

    expect(result).toEqual({ selected: 2, deleted: 2, hasMore: true })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: 'STOPPING', heartbeatAt: { lt: new Date('2026-08-16T00:00:00.000Z') } },
          {
            status: { in: ['STARTING', 'READY', 'DEGRADED'] },
            heartbeatAt: { lt: new Date('2026-08-10T00:00:00.000Z') }
          }
        ]
      },
      orderBy: { heartbeatAt: 'asc' },
      take: 2,
      select: { workerId: true }
    })
    expect(deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          { workerId: { in: ['stale-stopping', 'stale-ready'] } },
          expect.objectContaining({ OR: expect.any(Array) })
        ]
      })
    })
  })

  it('does not issue an unbounded delete when no stale instances are selected', async () => {
    const deleteMany = vi.fn()
    const result = await cleanupStaleWorkerInstances(
      { workerInstance: { findMany: vi.fn().mockResolvedValue([]), deleteMany } },
      new Date('2026-08-17T00:00:00.000Z')
    )

    expect(result).toEqual({ selected: 0, deleted: 0, hasMore: false })
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('lets a heartbeat refresh between selection and deletion win the retention race', async () => {
    const sevenDayCutoff = new Date('2026-08-10T00:00:00.000Z')
    const record = { workerId: 'worker-racing', heartbeatAt: new Date('2026-08-01T00:00:00.000Z') }
    const findMany = vi.fn(async () => {
      const selected = [{ workerId: record.workerId }]
      record.heartbeatAt = new Date('2026-08-17T00:00:00.000Z')
      return selected
    })
    const deleteMany = vi.fn(async () => {
      if (record.heartbeatAt < sevenDayCutoff) return { count: 1 }
      return { count: 0 }
    })

    const result = await cleanupStaleWorkerInstances(
      { workerInstance: { findMany, deleteMany } },
      new Date('2026-08-17T00:00:00.000Z')
    )

    expect(result).toEqual({ selected: 1, deleted: 0, hasMore: false })
    expect(record.heartbeatAt).toEqual(new Date('2026-08-17T00:00:00.000Z'))
    expect(deleteMany).toHaveBeenCalledOnce()
  })

  it('runs maintenance on the worker heartbeat path at most once per interval', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const findMany = vi.fn().mockResolvedValue([])
    const deleteMany = vi.fn()
    const now = vi.fn(() => new Date('2026-08-17T00:00:00.000Z'))
    const store = new PrismaWorkerPresenceStore(
      { workerInstance: { upsert } },
      {
        retentionClient: { workerInstance: { findMany, deleteMany } },
        retentionMaintenanceIntervalMs: 60_000,
        now
      }
    )
    const record = {
      workerId: 'worker-current',
      status: 'READY' as const,
      serviceVersion: 'test',
      hostname: 'host',
      processId: 1,
      capabilities: [],
      startedAt: '2026-08-17T00:00:00.000Z',
      heartbeatAt: '2026-08-17T00:00:00.000Z',
      lastError: null,
      updatedAt: '2026-08-17T00:00:00.000Z'
    }

    await store.write(record)
    await store.write(record)

    expect(upsert).toHaveBeenCalledTimes(2)
    expect(findMany).toHaveBeenCalledOnce()
  })

  it('keeps a successful presence heartbeat healthy when retention fails and reports the error', async () => {
    const retentionError = new Error('retention unavailable')
    const onRetentionError = vi.fn()
    const upsert = vi.fn().mockResolvedValue({})
    const store = new PrismaWorkerPresenceStore(
      { workerInstance: { upsert } },
      {
        retentionClient: {
          workerInstance: {
            findMany: vi.fn().mockRejectedValue(retentionError),
            deleteMany: vi.fn()
          }
        },
        onRetentionError
      }
    )

    await expect(
      store.write({
        workerId: 'worker-current',
        status: 'READY',
        serviceVersion: 'test',
        hostname: 'host',
        processId: 1,
        capabilities: [],
        startedAt: '2026-08-17T00:00:00.000Z',
        heartbeatAt: '2026-08-17T00:00:00.000Z',
        lastError: null,
        updatedAt: '2026-08-17T00:00:00.000Z'
      })
    ).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledOnce()
    expect(onRetentionError).toHaveBeenCalledWith(retentionError)
  })
})
