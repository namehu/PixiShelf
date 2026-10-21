import { describe, expect, it, vi } from 'vitest'
import { MediaPageStore } from '../media-page-store'
import { MEDIA_INDEX_CONFLICT, type MediaIndex, type MediaPage } from '@/schemas/artwork-reader.dto'

const index: MediaIndex = { fingerprint: 'a'.repeat(64), mediaRevision: 1, items: Array.from({ length: 3000 }, (_, i) => ({
  mediaId: i + 1, memberMediaIds: [i + 1], index: i, width: 100, height: 150,
  mediaType: 'image', isAnimated: false, reliableDimensions: true
})) }
const result = (page: number): MediaPage => ({ page, fingerprint: index.fingerprint, images: [] })
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('bounded reader media cache', () => {
  it('jumps directly to page 33, coalesces readers, and limits concurrency to two', async () => {
    const pending = new Map<number, (value: MediaPage) => void>()
    const fetch = vi.fn((page: number) => new Promise<MediaPage>((resolve) => pending.set(page, resolve)))
    const store = new MediaPageStore(index, fetch)
    store.request('detail', [799, 800, 824, 848])
    store.request('preview', [799])
    expect(fetch.mock.calls.map(([page]) => page)).toEqual([33, 34])
    pending.get(33)!(result(33))
    await settle()
    expect(fetch.mock.calls.map(([page]) => page)).toEqual([33, 34, 35])
    store.dispose()
  })
  it('keeps the current batch and evicts old batches after eight pages', async () => {
    const fetch = vi.fn(async (page: number) => result(page))
    const store = new MediaPageStore(index, fetch, result(0))
    for (let page = 1; page <= 10; page++) {
      store.request('reader', [page * 24])
      await settle()
    }
    store.request('reader', [10 * 24])
    await settle()
    expect(fetch).toHaveBeenCalledTimes(10)
    store.request('reader', [0])
    await settle()
    expect(fetch).toHaveBeenCalledTimes(11)
    store.dispose()
  })
  it('does not loop on failures, supports retry, and stops on a changed index', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result(0))
      .mockRejectedValueOnce(new Error(MEDIA_INDEX_CONFLICT))
    const store = new MediaPageStore(index, fetch)
    store.request('reader', [0])
    await settle()
    expect(store.failed(0)).toBe(true)
    store.request('reader', [0])
    expect(fetch).toHaveBeenCalledTimes(1)
    store.retry()
    await settle()
    expect(store.failed(0)).toBe(false)
    store.request('reader', [24])
    await settle()
    expect(store.invalidated).toBe(true)
    store.request('reader', [48])
    expect(fetch).toHaveBeenCalledTimes(3)
    store.dispose()
  })
})
