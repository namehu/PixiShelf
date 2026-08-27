import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'

import { reconcilePixivArtworkSeries } from '../series-sync.ts'

const checkedAt = new Date('2026-08-27T00:00:00.000Z')

describe('Pixiv artwork series synchronization', () => {
  it('removes only the source-owned membership for an explicit no-series response', async () => {
    const transaction = mockTransaction()
    transaction.seriesArtwork.findUnique.mockResolvedValueOnce({ seriesId: 9 })

    const result = await reconcilePixivArtworkSeries(asTransaction(transaction), {
      artworkId: 1,
      artworkExternalRefId: 'artwork-ref-1',
      observation: { state: 'NONE' },
      checkedAt,
      jobId: 'job-1',
      refreshExisting: false,
      observedSeries: null
    })

    expect(transaction.seriesArtwork.delete).toHaveBeenCalledWith({ where: { sourceRefId: 'artwork-ref-1' } })
    expect(transaction.artworkExternalRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seriesSyncStatus: 'NO_DATA' }) })
    )
    expect(result).toMatchObject({ status: 'NO_DATA', membershipRemoved: true })
  })

  it('does not mutate memberships when the series field is incomplete', async () => {
    const transaction = mockTransaction()

    const result = await reconcilePixivArtworkSeries(asTransaction(transaction), {
      artworkId: 1,
      artworkExternalRefId: 'artwork-ref-1',
      observation: { state: 'UNKNOWN' },
      checkedAt,
      jobId: 'job-1',
      refreshExisting: false,
      observedSeries: null
    })

    expect(transaction.seriesArtwork.findUnique).not.toHaveBeenCalled()
    expect(transaction.seriesArtwork.create).not.toHaveBeenCalled()
    expect(transaction.seriesArtwork.delete).not.toHaveBeenCalled()
    expect(result.status).toBe('PARTIAL')
  })

  it('creates a provider identity and source-owned membership without title matching', async () => {
    const transaction = mockTransaction()
    transaction.seriesArtwork.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    transaction.seriesExternalRef.findUnique.mockResolvedValue(null)
    transaction.series.create.mockResolvedValue({
      id: 9,
      title: 'Remote series',
      description: null,
      coverImageUrl: null,
      source: 'PIXIV',
      externalId: '88',
      titleOverridden: false,
      descriptionOverridden: false,
      createdAt: checkedAt,
      updatedAt: checkedAt,
      externalRefs: [
        {
          id: 'series-ref-88',
          seriesId: 9,
          providerKey: 'pixiv',
          externalId: '88',
          sourceTitle: 'Remote series'
        }
      ]
    })
    transaction.seriesArtwork.count.mockResolvedValue(1)

    const result = await reconcilePixivArtworkSeries(asTransaction(transaction), {
      artworkId: 1,
      artworkExternalRefId: 'artwork-ref-1',
      observation: { state: 'PRESENT', id: '88', title: 'Remote series', order: 4 },
      checkedAt,
      jobId: 'job-1',
      refreshExisting: false,
      observedSeries: null
    })

    expect(transaction.series.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Remote series',
          externalRefs: { create: expect.objectContaining({ providerKey: 'pixiv', externalId: '88' }) }
        })
      })
    )
    expect(transaction.seriesArtwork.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seriesId: 9,
        artworkId: 1,
        provenance: 'SOURCE',
        sourceRefId: 'artwork-ref-1',
        sourceOrder: 4,
        sortOrder: 4
      })
    })
    expect(result).toMatchObject({ status: 'SUCCESS', seriesId: 9, membershipCreated: true })
  })

  it('preserves an existing manual membership and overridden title', async () => {
    const transaction = mockTransaction()
    transaction.seriesArtwork.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        seriesId: 9,
        artworkId: 1,
        sortOrder: 2,
        sourceOrder: null,
        orderOverridden: false,
        provenance: 'MANUAL',
        sourceRefId: null
      })
    transaction.seriesExternalRef.findUnique.mockResolvedValue({
      id: 'series-ref-88',
      seriesId: 9,
      providerKey: 'pixiv',
      externalId: '88',
      sourceTitle: 'Old remote title',
      series: { id: 9, title: 'My title', titleOverridden: true }
    })
    transaction.seriesArtwork.count.mockResolvedValue(1)

    const result = await reconcilePixivArtworkSeries(asTransaction(transaction), {
      artworkId: 1,
      artworkExternalRefId: 'artwork-ref-1',
      observation: { state: 'PRESENT', id: '88', title: 'New remote title', order: 4 },
      checkedAt,
      jobId: 'job-1',
      refreshExisting: false,
      observedSeries: null
    })

    expect(transaction.series.update).not.toHaveBeenCalled()
    expect(transaction.seriesArtwork.create).not.toHaveBeenCalled()
    expect(transaction.seriesArtwork.delete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'PARTIAL', protectedFields: ['title', 'membership'] })
  })

  it('does not overwrite a source order changed after refresh observation', async () => {
    const transaction = mockTransaction()
    transaction.seriesArtwork.findUnique
      .mockResolvedValueOnce({ seriesId: 9 })
      .mockResolvedValueOnce({
        seriesId: 9,
        artworkId: 1,
        sortOrder: 9,
        sourceOrder: 2,
        orderOverridden: true,
        excludedAt: null,
        provenance: 'SOURCE',
        sourceRefId: 'artwork-ref-1'
      })
    transaction.seriesExternalRef.findUnique.mockResolvedValue({
      id: 'series-ref-88',
      seriesId: 9,
      providerKey: 'pixiv',
      externalId: '88',
      sourceTitle: 'Remote series',
      series: { id: 9, title: 'Remote series', titleOverridden: false }
    })

    const result = await reconcilePixivArtworkSeries(asTransaction(transaction), {
      artworkId: 1,
      artworkExternalRefId: 'artwork-ref-1',
      observation: { state: 'PRESENT', id: '88', title: 'Remote series', order: 4 },
      checkedAt,
      jobId: 'job-1',
      refreshExisting: true,
      observedSeries: {
        externalRefId: 'series-ref-88',
        seriesId: 9,
        title: 'Remote series',
        titleOverridden: false,
        membership: {
          sortOrder: 2,
          sourceOrder: 2,
          orderOverridden: false,
          excludedAt: null,
          provenance: 'SOURCE',
          sourceRefId: 'artwork-ref-1'
        }
      }
    })

    expect(transaction.seriesArtwork.update).toHaveBeenCalledWith({
      where: { seriesId_artworkId: { seriesId: 9, artworkId: 1 } },
      data: { sourceOrder: 4 }
    })
    expect(result).toMatchObject({ status: 'PARTIAL', protectedFields: ['order'] })
  })
})

function mockTransaction() {
  return {
    seriesArtwork: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      count: vi.fn().mockResolvedValue(0)
    },
    seriesExternalRef: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    series: {
      create: vi.fn(),
      update: vi.fn()
    },
    artworkExternalRef: {
      update: vi.fn()
    }
  }
}

function asTransaction(transaction: ReturnType<typeof mockTransaction>) {
  return transaction as unknown as Prisma.TransactionClient
}
