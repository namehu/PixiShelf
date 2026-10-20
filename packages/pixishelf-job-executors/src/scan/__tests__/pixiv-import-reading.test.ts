import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { initializePixivImportReading } from '../pixiv-import-reading.ts'

function fixture(accounts: Array<{ userId: string }>, images: Array<{ id: number; path: string; mediaType: string }>) {
  const tx = {
    userSetting: { findMany: vi.fn(async () => accounts) },
    image: { findMany: vi.fn(async () => images) },
    artworkReadMedia: { createMany: vi.fn(async () => ({ count: images.length })) },
    artworkReadingSummary: { create: vi.fn(async () => ({})) }
  }
  return { tx, run: () => initializePixivImportReading(tx as unknown as Prisma.TransactionClient, 42) }
}

describe('Pixiv import reading preference', () => {
  it('is opt-in and does no media work when no account enabled it', async () => {
    const { tx, run } = fixture([], [])
    await run()
    expect(tx.userSetting.findMany).toHaveBeenCalledWith({
      where: { key: 'pixiv_import_mark_read', type: 'boolean', value: 'true' },
      select: { userId: true }
    })
    expect(tx.image.findMany).not.toHaveBeenCalled()
    expect(tx.artworkReadingSummary.create).not.toHaveBeenCalled()
  })

  it('marks physical members for only opted-in accounts and counts logical media without fabricating visits', async () => {
    const images = [
      { id: 1, path: 'work/animation.apng', mediaType: 'ANIMATION' },
      { id: 2, path: 'work/animation.mp4', mediaType: 'VIDEO' },
      { id: 3, path: 'work/image.jpg', mediaType: 'IMAGE' }
    ]
    const { tx, run } = fixture([{ userId: 'a' }, { userId: 'b' }], images)
    await run()
    for (const userId of ['a', 'b']) {
      expect(tx.artworkReadMedia.createMany).toHaveBeenCalledWith({
        data: images.map(({ id: mediaId }) => ({ userId, artworkId: 42, mediaId })),
        skipDuplicates: true
      })
      expect(tx.artworkReadingSummary.create).toHaveBeenCalledWith({
        data: { userId, artworkId: 42, seenCount: 2, totalCount: 2, stateVersion: 1 }
      })
    }
    expect(tx.artworkReadingSummary.create).toHaveBeenCalledTimes(2)
  })

  it('does not mark empty artworks complete', async () => {
    const { tx, run } = fixture([{ userId: 'a' }], [])
    await run()
    expect(tx.artworkReadMedia.createMany).not.toHaveBeenCalled()
    expect(tx.artworkReadingSummary.create).not.toHaveBeenCalled()
  })

  it('propagates failures so the surrounding scan publication rolls back', async () => {
    const { tx, run } = fixture([{ userId: 'a' }], [{ id: 1, path: '1.jpg', mediaType: 'IMAGE' }])
    tx.artworkReadingSummary.create.mockRejectedValueOnce(new Error('write failed'))
    await expect(run()).rejects.toThrow('write failed')
  })
})
