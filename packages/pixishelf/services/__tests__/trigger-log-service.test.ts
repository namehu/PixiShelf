import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteManyMock } = vi.hoisted(() => ({
  deleteManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { triggerLog: { deleteMany: deleteManyMock } }
}))

import { cleanupTriggerLogs } from '../trigger-log-service'

describe('cleanupTriggerLogs', () => {
  beforeEach(() => {
    deleteManyMock.mockReset().mockResolvedValue({ count: 12 })
  })

  it('deletes logs older than the configured retention period', async () => {
    const result = await cleanupTriggerLogs({
      retentionDays: 30,
      now: new Date('2026-08-08T00:00:00.000Z')
    })

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { created_at: { lt: new Date('2026-07-09T00:00:00.000Z') } }
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
