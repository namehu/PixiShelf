import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn().mockResolvedValue([]),
  artist: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  update: vi.fn(),
  find: vi.fn().mockResolvedValue(null),
  mapping: vi.fn().mockResolvedValue(null),
  createMapping: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { findUnique: mocks.find },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRawUnsafe: mocks.lock,
        artist: { findUnique: mocks.artist },
        artwork: { create: mocks.create, update: mocks.update },
        localImportArtistMapping: { findUnique: mocks.mapping, create: mocks.createMapping }
      })
  }
}))
vi.mock('@/services/scan-run-service', () => ({
  startScanRun: vi.fn().mockResolvedValue({ id: 'test-run' }),
  appendScanRunItems: vi.fn(),
  completeScanRunSummary: vi.fn()
}))

import { createArtwork } from '../index'

it('rejects a stale manually selected artist before creating a work instead of silently redirecting it', async () => {
  await expect(createArtwork({ title: 'stale form', artistId: 7 })).rejects.toThrow('艺术家已不存在或已合并')
  expect(mocks.artist).toHaveBeenCalledWith({ where: { id: 7, mergedIntoId: null }, select: { id: true } })
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.artist.mock.invocationCallOrder[0]!)
  expect(mocks.create).not.toHaveBeenCalled()
})

it.each([null, 7])('persists upload storage in the creation transaction for artist %s', async (artistId) => {
  mocks.artist.mockResolvedValue({ id: 7 } as never)
  mocks.create.mockResolvedValue({ id: 83, artistId, storageKey: null })
  mocks.update.mockImplementation(async ({ data }) => ({ id: 83, artistId, title: 'new', ...data }))
  await createArtwork({ title: 'new', artistId })
  expect(mocks.update).toHaveBeenLastCalledWith({
    where: { id: 83 },
    data: {
      storageKey: expect.stringMatching(/^e_83_/),
      storagePath: expect.stringMatching(new RegExp(`^local-imports/${artistId ? 'artist-7' : 'unassigned'}/e_83_`))
    }
  })
})
