import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { artworkCount, artworkFindMany, artworkUpdateMany, transaction } = vi.hoisted(() => ({
  artworkCount: vi.fn(),
  artworkFindMany: vi.fn(),
  artworkUpdateMany: vi.fn(),
  transaction: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { count: artworkCount, findMany: artworkFindMany, updateMany: artworkUpdateMany },
    $transaction: transaction
  }
}))
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/utils/sleep', () => ({ sleep: vi.fn() }))

import { refillMetaSource } from '../refill-meta-source'

const roots: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  artworkCount.mockResolvedValue(1)
  artworkFindMany
    .mockResolvedValueOnce([{ id: 1, externalId: '42', images: [{ path: 'artist/001.webp' }] }])
    .mockResolvedValue([])
  artworkUpdateMany.mockResolvedValue({ count: 1 })
  transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('legacy refill meta source compatibility', () => {
  it('uses bounded cursor pages and conditional updates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-next-refill-'))
    roots.push(root)
    await mkdir(path.join(root, 'artist'), { recursive: true })
    await writeFile(path.join(root, 'artist', '42-meta.txt'), 'metadata')

    await expect(refillMetaSource({ scanPath: root })).resolves.toEqual({ updatedCount: 1, totalFiles: 1 })
    expect(artworkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 0 } }), orderBy: { id: 'asc' }, take: 50 })
    )
    expect(artworkUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, metaSource: null },
      data: { metaSource: 'artist/42-meta.txt' }
    })
  })
})
