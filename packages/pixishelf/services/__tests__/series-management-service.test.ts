import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  raw: vi.fn(),
  execute: vi.fn(),
  series: vi.fn(),
  transaction: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
import {
  getSeriesManagementDetail,
  saveSeriesManagementChanges,
  seriesMembershipFingerprint
} from '../series-management-service'
const member = (artworkId: number, sortOrder = artworkId, provenance: 'SOURCE' | 'MANUAL' | 'LEGACY' = 'MANUAL') => ({
  artworkId,
  sortOrder,
  provenance,
  sourceOrder: null,
  orderOverridden: false,
  excludedAt: null as Date | null,
  sourceRefId: null,
  artwork: { deletedAt: null as Date | null }
})
const tx = {
  series: { findUnique: mocks.series },
  artwork: { count: mocks.count },
  seriesArtwork: {
    findMany: mocks.members,
    updateMany: mocks.update,
    deleteMany: mocks.remove,
    createMany: mocks.create
  },
  $queryRaw: mocks.raw,
  $executeRaw: mocks.execute
}
function baseline(rows: ReturnType<typeof member>[]) {
  mocks.members
    .mockResolvedValueOnce(rows.map((r) => ({ artworkId: r.artworkId })))
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(rows)
  return seriesMembershipFingerprint(7, rows)
}
describe('series management atomic changes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.transaction.mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx))
    mocks.raw.mockResolvedValue([{ id: 7 }])
    mocks.execute.mockResolvedValue(0)
    mocks.update.mockResolvedValue({ count: 1 })
    mocks.remove.mockResolvedValue({ count: 1 })
    mocks.create.mockResolvedValue({ count: 1 })
  })
  it('rejects a stale draft before any membership write', async () => {
    baseline([member(10)])
    await expect(
      saveSeriesManagementChanges({
        seriesId: 7,
        expectedFingerprint: '0'.repeat(64),
        finalArtworkIds: [],
        explicitReorder: false
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('rejects duplicate IDs before starting a transaction', async () => {
    await expect(
      saveSeriesManagementChanges({
        seriesId: 7,
        expectedFingerprint: '0'.repeat(64),
        finalArtworkIds: [10, 10],
        explicitReorder: true
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('excludes SOURCE, deletes manual relations and appends new members without taking order ownership', async () => {
    const rows = [member(10, 1, 'SOURCE'), member(20, 2), member(30, 3)]
    const expectedFingerprint = baseline(rows)
    mocks.count.mockResolvedValue(2)
    await saveSeriesManagementChanges({
      seriesId: 7,
      expectedFingerprint,
      finalArtworkIds: [30, 40],
      explicitReorder: false
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { seriesId: 7, artworkId: { in: [10] } },
      data: { excludedAt: expect.any(Date) }
    })
    expect(mocks.remove).toHaveBeenCalledWith({ where: { seriesId: 7, artworkId: { in: [20] } } })
    expect(mocks.create).toHaveBeenCalledWith({
      data: [{ seriesId: 7, artworkId: 40, sortOrder: 4, provenance: 'MANUAL' }]
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('restores source members at their stored position without changing ownership', async () => {
    const hidden = { ...member(20, 2, 'SOURCE'), excludedAt: new Date(0) }
    const expectedFingerprint = baseline([member(10, 1), hidden, member(30, 3)])
    mocks.count.mockResolvedValue(3)
    await saveSeriesManagementChanges({
      seriesId: 7,
      expectedFingerprint,
      finalArtworkIds: [10, 20, 30],
      explicitReorder: false
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { seriesId: 7, artworkId: { in: [20] } },
      data: { excludedAt: null }
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects undeclared reorder before writing', async () => {
    const expectedFingerprint = baseline([member(10, 1), member(20, 2)])
    mocks.count.mockResolvedValue(2)
    await expect(
      saveSeriesManagementChanges({
        seriesId: 7,
        expectedFingerprint,
        finalArtworkIds: [20, 10],
        explicitReorder: false
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([
    [0, 'BAD_REQUEST'],
    [1, 'CONFLICT']
  ])('rejects missing or deleted candidates before writing (existing count %s)', async (existingCount, code) => {
    const expectedFingerprint = baseline([])
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(existingCount)
    await expect(
      saveSeriesManagementChanges({
        seriesId: 7,
        expectedFingerprint,
        finalArtworkIds: [10],
        explicitReorder: false
      })
    ).rejects.toMatchObject({ code })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('writes 2,000 positions in one parameterized update and checks its affected count', async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => member(index + 1))
    const expectedFingerprint = baseline(rows)
    mocks.count.mockResolvedValue(2000)
    mocks.execute.mockResolvedValueOnce(0).mockResolvedValueOnce(2000)
    await saveSeriesManagementChanges({
      seriesId: 7,
      expectedFingerprint,
      finalArtworkIds: rows.map((r) => r.artworkId).reverse(),
      explicitReorder: true
    })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    const sql = mocks.execute.mock.calls[1]![0] as { values: unknown[]; text: string }
    expect(sql.values).toHaveLength(4001)
    expect(sql.values.slice(0, 4)).toEqual([2000, 1, 1999, 2])
    expect(sql.text).toContain('UPDATE "SeriesArtwork"')
  })
  it('fingerprints excluded relations and soft deletion, independently of read ordering', () => {
    const rows = [member(10), member(20)]
    expect(seriesMembershipFingerprint(7, rows)).toBe(seriesMembershipFingerprint(7, [...rows].reverse()))
    expect(seriesMembershipFingerprint(7, rows)).not.toBe(
      seriesMembershipFingerprint(7, [rows[0]!, { ...rows[1]!, excludedAt: new Date(0) }])
    )
    expect(seriesMembershipFingerprint(7, rows)).not.toBe(
      seriesMembershipFingerprint(7, [rows[0]!, { ...rows[1]!, artwork: { deletedAt: new Date(0) } }])
    )
  })
  it('reads one media cover per artwork in a repeatable snapshot', async () => {
    mocks.series.mockResolvedValue({ id: 7, title: 'series', coverImageUrl: null, externalRefs: [] })
    mocks.members.mockResolvedValue([
      {
        ...member(10),
        artwork: {
          id: 10,
          title: 'artwork',
          deletedAt: null,
          thumbnailUrl: null,
          artist: null,
          creators: [],
          _count: { images: 200 },
          images: [{ path: '/cover.jpg', mediaType: 'IMAGE', videoMetadata: null }]
        }
      }
    ])
    const result = await getSeriesManagementDetail(7)
    expect(result.artworks[0]).toMatchObject({ thumbnailUrl: '/cover.jpg', mediaCount: 200 })
    expect(mocks.members.mock.calls[0]![0]).toMatchObject({ select: { artwork: { select: { images: { take: 1 } } } } })
    expect(mocks.transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: 'RepeatableRead' })
  })
})
