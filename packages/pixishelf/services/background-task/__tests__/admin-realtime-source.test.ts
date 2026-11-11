import { describe, expect, it, vi } from 'vitest'
import { PostgresAdminRealtimeSource } from '../admin-realtime-source'

describe('admin realtime source', () => {
  it('establishes a baseline and checks deadlines only when data changes or a boundary is reached', async () => {
    const now = new Date('2026-11-11T00:00:00Z')
    let revision = 0n
    const aggregate = vi.fn().mockResolvedValue({ _min: { expiresAt: null, updatedAt: null } })
    const database = {
      adminRealtimeRevision: { findMany: async () => [{ resource: 'archiveInbox', revision }] },
      archiveIntakeItem: { aggregate }
    }
    const source = new PostgresAdminRealtimeSource(database as never)
    expect(await source.readChanges(now)).toEqual([])
    expect(await source.readChanges(now)).toEqual([])
    expect(aggregate).toHaveBeenCalledTimes(2)
    revision++
    expect(await source.readChanges(now)).toEqual(['archiveInbox'])
    expect(aggregate).toHaveBeenCalledTimes(4)
  })

  it('notifies once for READY expiry and once when a failure leaves the inclusive 24-hour window', async () => {
    const start = new Date('2026-11-11T00:00:00Z')
    const expires = new Date(start.getTime() + 1000)
    const failedAt = new Date(start.getTime() - 86_400_000 + 2000)
    const aggregate = vi.fn(async (args) => ({
      _min:
        args.where.status === 'READY'
          ? { expiresAt: args.where.expiresAt.gt < expires ? expires : null }
          : { updatedAt: args.where.updatedAt.gte <= failedAt ? failedAt : null }
    }))
    const source = new PostgresAdminRealtimeSource({
      adminRealtimeRevision: { findMany: async () => [{ resource: 'archiveInbox', revision: 0n }] },
      archiveIntakeItem: { aggregate }
    } as never)
    expect(await source.readChanges(start)).toEqual([])
    expect(await source.readChanges(expires)).toEqual(['archiveInbox'])
    expect(await source.readChanges(expires)).toEqual([])
    expect(await source.readChanges(new Date(start.getTime() + 2000))).toEqual([])
    expect(await source.readChanges(new Date(start.getTime() + 2001))).toEqual(['archiveInbox'])
    expect(await source.readChanges(new Date(start.getTime() + 60_000))).toEqual([])
    expect(aggregate).toHaveBeenCalledTimes(6)
  })
})
