import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { userSetting: { findMany: db.findMany, upsert: db.upsert }, $transaction: db.transaction }
}))
import { getUserSettings, upsertUserSettings } from '../user-setting-service'
beforeEach(() => vi.clearAllMocks())
describe('retired account privacy preference', () => {
  it('ignores historical privacy rows while keeping normal account settings', async () => {
    db.findMany.mockResolvedValue([
      { key: 'media_privacy_mode', value: 'true', type: 'boolean' },
      { key: 'video_seek_step_seconds', value: '15', type: 'number' }
    ])
    expect(await getUserSettings('user')).toEqual({ video_seek_step_seconds: 15 })
  })
  it('rejects a batch containing the old key before any database mutation', async () => {
    await expect(
      upsertUserSettings('user', [
        { key: 'video_seek_step_seconds', value: 15 },
        { key: 'media_privacy_mode', value: true }
      ])
    ).rejects.toThrow()
    expect(db.upsert).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
