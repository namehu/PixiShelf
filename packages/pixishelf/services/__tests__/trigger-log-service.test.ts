import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteManyMock, findManyMock } = vi.hoisted(() => ({
  deleteManyMock: vi.fn(),
  findManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { triggerLog: { deleteMany: deleteManyMock, findMany: findManyMock } }
}))

import { cleanupTriggerLogs } from '../trigger-log-service'

describe('cleanupTriggerLogs', () => {
  beforeEach(() => {
    deleteManyMock.mockReset().mockResolvedValue({ count: 12 })
    findManyMock
      .mockReset()
      .mockResolvedValueOnce(Array.from({ length: 12 }, (_, id) => ({ id: id + 1 })))
      .mockResolvedValue([])
  })

  it('deletes logs older than the configured retention period', async () => {
    const result = await cleanupTriggerLogs({
      retentionDays: 30,
      now: new Date('2026-08-08T00:00:00.000Z')
    })

    expect(findManyMock).toHaveBeenCalledWith({
      where: { created_at: { lt: new Date('2026-07-09T00:00:00.000Z') } },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true }
    })
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: Array.from({ length: 12 }, (_, id) => id + 1) },
        created_at: { lt: new Date('2026-07-09T00:00:00.000Z') }
      }
    })
    expect(result).toEqual({
      deletedLogs: 12,
      retentionDays: 30,
      cutoff: '2026-07-09T00:00:00.000Z'
    })
  })

  it('rejects invalid retention periods', async () => {
    await expect(cleanupTriggerLogs({ retentionDays: 0 })).rejects.toThrow('positive integer')
    expect(deleteManyMock).not.toHaveBeenCalled()
  })
})
