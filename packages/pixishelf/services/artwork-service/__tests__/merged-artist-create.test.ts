import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn().mockResolvedValue([]),
  artist: vi.fn().mockResolvedValue(null),
  create: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRawUnsafe: mocks.lock,
        artist: { findUnique: mocks.artist },
        artwork: { create: mocks.create }
      })
  }
}))

import { createArtwork } from '../index'

it('rejects a stale manually selected artist before creating a work instead of silently redirecting it', async () => {
  await expect(createArtwork({ title: 'stale form', artistId: 7 })).rejects.toThrow('艺术家已不存在或已合并')
  expect(mocks.artist).toHaveBeenCalledWith({ where: { id: 7, mergedIntoId: null }, select: { id: true } })
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.artist.mock.invocationCallOrder[0]!)
  expect(mocks.create).not.toHaveBeenCalled()
})
