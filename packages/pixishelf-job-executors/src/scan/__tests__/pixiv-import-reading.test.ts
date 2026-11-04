import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { initializePixivImportReading } from '../pixiv-import-reading.ts'
function fixture(accounts: Array<{ userId: string }>, logicalMediaCount: number) {
  const tx = {
    userSetting: { findMany: vi.fn(async () => accounts) },
    artwork: { findUniqueOrThrow: vi.fn(async () => ({ logicalMediaCount })) },
    artworkReadingProgress: { createMany: vi.fn(async () => ({ count: accounts.length })) }
  }
  return { tx, run: () => initializePixivImportReading(tx as unknown as Prisma.TransactionClient, 42) }
}
describe('Pixiv import reading preference', () => {
  it('does no artwork work when no account enabled it', async () => {
    const { tx, run } = fixture([], 0)
    await run()
    expect(tx.artwork.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(tx.artworkReadingProgress.createMany).not.toHaveBeenCalled()
  })
  it('creates one completion-only row for each opted-in account without visit or position fields', async () => {
    const { tx, run } = fixture([{ userId: 'a' }, { userId: 'b' }], 2)
    await run()
    expect(tx.artworkReadingProgress.createMany).toHaveBeenCalledExactlyOnceWith({
      data: ['a', 'b'].map((userId) => ({ userId, artworkId: 42, completed: true, stateVersion: 1 }))
    })
  })
  it('does not mark empty works complete', async () => {
    const { tx, run } = fixture([{ userId: 'a' }], 0)
    await run()
    expect(tx.artworkReadingProgress.createMany).not.toHaveBeenCalled()
  })
  it('propagates write failures so publication rolls back', async () => {
    const { tx, run } = fixture([{ userId: 'a' }], 2)
    tx.artworkReadingProgress.createMany.mockRejectedValueOnce(new Error('write failed'))
    await expect(run()).rejects.toThrow('write failed')
  })
})
