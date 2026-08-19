import { describe, expect, it, vi } from 'vitest'
import {
  MEDIA_DERIVED_TAG_IMAGE_BATCH_SIZE,
  MEDIA_DERIVED_TAG_SYNC_BATCH_SIZE,
  selectMediaDerivedTagIds,
  syncAllMediaDerivedTags
} from '../media-derived-tag-sync.js'
import type { RunMaintenanceMutation } from '../types.js'

describe('media derived tag maintenance', () => {
  it('classifies imported media with the legacy webp, video, and image semantics', () => {
    const tagIds = { webp: 11, video: 12, image: 13 }

    expect(selectMediaDerivedTagIds(tagIds, ['work/page.webp'])).toEqual([11, 13])
    expect(selectMediaDerivedTagIds(tagIds, ['work/page.webp', 'work/clip.mp4'])).toEqual([11, 12])
    expect(selectMediaDerivedTagIds(tagIds, ['work/page.jpg'])).toEqual([13])
  })

  it('synchronizes bounded artwork pages idempotently', async () => {
    const tagIds = [11, 12, 13]
    const tagFindFirst = vi.fn(async ({ where }: { where: { OR: Array<{ systemKey?: string }> } }) => {
      const systemKey = where.OR[0]?.systemKey
      const index = ['media:webp', 'media:video', 'media:image'].indexOf(systemKey ?? '')
      return index >= 0 ? { id: tagIds[index] } : null
    })
    const tagUpdate = vi.fn(async ({ where }: { where: { id: number } }) => ({ id: where.id }))
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 })
    const transaction = {
      tag: { findFirst: tagFindFirst, update: tagUpdate, create: vi.fn() },
      artworkTag: { createMany, deleteMany }
    }
    const artworkFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([])
    const database = {
      artwork: { count: vi.fn().mockResolvedValue(2), findMany: artworkFindMany },
      image: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, artworkId: 1, path: 'a.webp' },
          { id: 2, artworkId: 2, path: 'b.m4v' }
        ])
      },
      artworkTag: { count: vi.fn().mockResolvedValue(1) }
    }

    const result = await syncAllMediaDerivedTags({
      database: database as never,
      mutate: (async (operation) => operation(transaction as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn()
    })

    expect(result.webp.expectedArtworks).toBe(1)
    expect(result.video.expectedArtworks).toBe(1)
    expect(result.image.expectedArtworks).toBe(1)
    expect(artworkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' }, take: MEDIA_DERIVED_TAG_SYNC_BATCH_SIZE })
    )
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
    expect(tagUpdate).toHaveBeenCalledTimes(3)
    expect(database.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: MEDIA_DERIVED_TAG_IMAGE_BATCH_SIZE,
        select: { id: true, artworkId: true, path: true }
      })
    )
  })

  it('does not enter relation writes when the lease fence is stale', async () => {
    const staleFence = new Error('stale fence')
    const operation = vi.fn()
    await expect(
      syncAllMediaDerivedTags({
        database: {} as never,
        mutate: vi.fn(async () => {
          throw staleFence
        }) as never,
        signal: new AbortController().signal,
        progress: operation
      })
    ).rejects.toBe(staleFence)
    expect(operation).not.toHaveBeenCalled()
  })
})
