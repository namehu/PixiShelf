import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppTransaction } from '@/lib/prisma'

const mocks = vi.hoisted(() => ({
  findArtwork: vi.fn(), findImages: vi.fn(), detail: vi.fn()
}))
vi.mock('server-only', () => ({}))
vi.mock('@/services/artwork-service/index', () => ({
  getArtworkDetailRecord: mocks.detail, publishedKeyframeSummaryInclude: {}
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: (callback: (tx: unknown) => unknown) => callback({
    artwork: { findUnique: mocks.findArtwork }, image: { findMany: mocks.findImages }
  }) }
}))
import { getArtworkReaderInitial, getReaderMediaPage, loadReaderIndex } from '../reader'

const tx = { artwork: { findUnique: mocks.findArtwork }, image: { findMany: mocks.findImages } } as unknown as AppTransaction
function row(id: number, path = `/${id}.jpg`) {
  return { id, path, mediaType: 'IMAGE', width: 100, height: 150, size: 100n, webpAnimationStatus: null,
    sortOrder: id, artworkId: 1, createdAt: new Date(), updatedAt: new Date(), chaptersPath: null,
    chaptersCount: 0, chaptersDuration: null, chaptersUpdatedAt: null, chaptersHash: null, animationMetadata: null }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findArtwork.mockResolvedValue({ title: 'Synthetic', mediaRevision: 1 })
  mocks.detail.mockImplementation(async (_id, _tx, ids: number[]) => ({ images: ids.map((id) => ({ id })), title: 'Synthetic' }))
})
describe('reader payload bounds and media identity', () => {
  it.each([24, 600, 3000])('hydrates only 24 logical items for an SSR artwork with %i items', async (count) => {
    mocks.findImages.mockResolvedValue(Array.from({ length: count }, (_, index) => row(index + 1)))
    const initial = await getArtworkReaderInitial(1)
    expect(initial?.total).toBe(count)
    expect(initial?.artwork.images).toHaveLength(24)
    expect(mocks.detail.mock.calls[0]?.[2]).toHaveLength(24)
    expect(mocks.findImages.mock.calls[0]?.[0]).toMatchObject({
      select: { id: true, width: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    })
    expect(JSON.stringify(initial)).not.toContain('memberMediaIds')
  })
  it('hydrates the complete APNG/video group even when physical members straddle a page boundary', async () => {
    const rows = Array.from({ length: 23 }, (_, index) => row(index + 1))
    rows.push({ ...row(24, '/paired.webm'), mediaType: 'VIDEO' })
    rows.push(...Array.from({ length: 30 }, (_, index) => row(index + 25)))
    rows.push({ ...row(99, '/paired.apng'), mediaType: 'ANIMATION' })
    mocks.findImages.mockImplementation(async (args) => args.where.id ? rows.filter((item) => args.where.id.in.includes(item.id)) : rows)
    const { index } = await loadReaderIndex(tx, 1)
    expect(index.items[23]?.memberMediaIds).toEqual([24, 99])
    const page = await getReaderMediaPage(1, index.fingerprint, 0)
    expect(page.images).toHaveLength(24)
    expect(page.images[23]?.raw?.id).toBe(99)
    expect(mocks.findImages.mock.calls.at(-1)?.[0].where.id.in).toContain(99)
  })
  it('rejects stale order or dimensions even when mediaRevision is unchanged', async () => {
    const rows = [row(1), row(2)]
    mocks.findImages.mockResolvedValue(rows)
    const before = await loadReaderIndex(tx, 1)
    mocks.findImages.mockResolvedValue([...rows].reverse())
    await expect(getReaderMediaPage(1, before.index.fingerprint, 0)).rejects.toMatchObject({ code: 'CONFLICT' })
    mocks.findImages.mockResolvedValue([row(1), { ...row(2), height: 300 }])
    await expect(getReaderMediaPage(1, before.index.fingerprint, 0)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.findImages.mock.calls.every(([args]) => !args.include)).toBe(true)
  })
  it('rejects missing/deleted artwork without reading media', async () => {
    mocks.findArtwork.mockResolvedValue(null)
    expect(await getArtworkReaderInitial(1)).toBeNull()
    expect(mocks.findImages).not.toHaveBeenCalled()
  })
})
