import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REFILL_META_SOURCE_BATCH_SIZE, refillMetaSource } from '../refill-meta-source.js'
import type { RunMaintenanceMutation } from '../types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('refill meta source maintenance', () => {
  it('uses cursor pages, rejects unsafe identities, and updates only null checkpoints', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-refill-'))
    roots.push(root)
    await mkdir(path.join(root, 'artist'), { recursive: true })
    await writeFile(path.join(root, 'artist', '42-meta.txt'), 'metadata')
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, externalId: '42', images: [{ path: 'artist/001.webp' }] },
        { id: 2, externalId: '../escape', images: [{ path: 'artist/002.webp' }] }
      ])
      .mockResolvedValueOnce([])
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const result = await refillMetaSource({
      database: { artwork: { count: vi.fn().mockResolvedValue(2), findMany } } as never,
      mutate: (async (operation) => operation({ artwork: { updateMany } } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn(),
      scanRoot: root
    })

    expect(result).toMatchObject({ updatedCount: 1, totalFiles: 2, unsafePaths: 1 })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' }, take: REFILL_META_SOURCE_BATCH_SIZE })
    )
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 1, metaSource: null },
      data: { metaSource: 'artist/42-meta.txt' }
    })
  })

  it('is restart-safe when a previous attempt already filled every checkpoint', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-refill-'))
    roots.push(root)
    const findMany = vi.fn().mockResolvedValue([])
    const result = await refillMetaSource({
      database: { artwork: { count: vi.fn().mockResolvedValue(0), findMany } } as never,
      mutate: vi.fn() as never,
      signal: new AbortController().signal,
      progress: vi.fn(),
      scanRoot: root
    })
    expect(result.updatedCount).toBe(0)
    expect(findMany).toHaveBeenCalledOnce()
  })
})
