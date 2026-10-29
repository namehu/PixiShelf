// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { listArtworkDedupComparisons } from '../artwork-dedup-review-service'

const summary = {
  evidenceVersion: 'visual-v1',
  leftArtworkId: 1,
  rightArtworkId: 2,
  leftFileCount: '2',
  rightFileCount: '3',
  pairedCount: '2',
  exactCount: '1',
  similarCount: '1',
  leftUnmatchedCount: '0',
  rightUnmatchedCount: '1',
  leftUncheckedCount: '0',
  rightUncheckedCount: '0'
}
type ComparisonRow = Pick<Prisma.ArtworkDedupVisualPageGetPayload<Record<string, never>>,
  'ordinal' | 'kind' | 'leftImageId' | 'rightImageId' | 'leftIndex' | 'rightIndex'>

function fixture() {
  const tx = {
    artworkDedupRun: { findUnique: vi.fn(async () => ({ status: 'COMPLETED', version: 4 })) },
    artworkDedupVisualPair: {
      findUnique: vi.fn(async () => ({ id: 'visual-1', runId: 'run-1', leftArtworkId: 1, rightArtworkId: 2, summary }))
    },
    artworkDedupVisualPage: {
      findMany: vi.fn(async (): Promise<ComparisonRow[]> => [
        { ordinal: 1, kind: 'SIMILAR', leftImageId: 11, rightImageId: 21, leftIndex: 0, rightIndex: 1 },
        { ordinal: 2, kind: 'UNMATCHED', leftImageId: null, rightImageId: 22, leftIndex: null, rightIndex: 2 }
      ])
    },
    image: {
      findMany: vi.fn(async () => [
        { id: 11, artworkId: 1 },
        { id: 21, artworkId: 999 }
      ])
    }
  }
  const database = {
    $transaction: async <T>(body: (value: Prisma.TransactionClient) => Promise<T>) => body(tx as never)
  }
  vi.spyOn(database, '$transaction')
  const input = {
    expectedUserId: 'user-a',
    runId: 'run-1',
    groupId: 'visual-1',
    filter: 'DIFFERENT' as const,
    limit: 1
  }
  return { tx, database, input }
}
describe('visual comparison service', () => {
  it('filters unchecked originals independently and never supplies their thumbnail URL', async () => {
    const { tx, database, input } = fixture()
    tx.artworkDedupVisualPage.findMany.mockResolvedValue([
      { ordinal: 3, kind: 'UNCHECKED', leftImageId: 11, rightImageId: null, leftIndex: 4, rightIndex: null }
    ])
    const page = await listArtworkDedupComparisons('user-a', { ...input, filter: 'UNCHECKED' }, database)
    expect(page.items).toEqual([{ id: 3, kind: 'UNCHECKED', left: { artworkId: 1, imageId: 11, index: 4, thumbnailUrl: null }, right: null }])
    expect(tx.artworkDedupVisualPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pairId: 'visual-1', ordinal: { gt: 0 }, kind: 'UNCHECKED' }
    }))
  })
  it('reads partial exact and unmatched evidence through the same bounded, account-bound media projection', async () => {
    const { tx, database, input } = fixture()
    const partial = {
      ...summary,
      evidenceVersion: 'sha256-multiset-overlap-v1',
      leftFileCount: '5',
      rightFileCount: '5',
      pairedCount: '4',
      exactCount: '4',
      similarCount: '0',
      leftUnmatchedCount: '1',
      rightUnmatchedCount: '1'
    }
    tx.artworkDedupVisualPair.findUnique.mockResolvedValue({
      id: 'partial-1',
      runId: 'run-1',
      leftArtworkId: 1,
      rightArtworkId: 2,
      summary: partial
    })
    tx.artworkDedupVisualPage.findMany.mockResolvedValue([
      { ordinal: 1, kind: 'EXACT', leftImageId: 11, rightImageId: 21, leftIndex: 0, rightIndex: 0 },
      { ordinal: 5, kind: 'UNMATCHED', leftImageId: null, rightImageId: 22, leftIndex: null, rightIndex: 4 }
    ])
    const page = await listArtworkDedupComparisons(
      'user-a',
      { ...input, groupId: 'partial-1', filter: 'ALL', limit: 2 },
      database
    )
    expect(page.visual).toEqual(partial)
    expect(page.items.map((item) => item.kind)).toEqual(['EXACT', 'UNMATCHED'])
    expect(page.items[0]?.right?.thumbnailUrl).toBeNull()
    expect(page.items[1]).toMatchObject({
      left: null,
      right: { artworkId: 2, imageId: 22, index: 4, thumbnailUrl: null }
    })
    expect(page.nextCursor).toBeNull()
    expect(tx.artworkDedupVisualPage.findMany).toHaveBeenCalledWith({
      where: { pairId: 'partial-1', ordinal: { gt: 0 } },
      orderBy: { ordinal: 'asc' },
      take: 3
    })
    expect(JSON.stringify(page)).not.toMatch(/path|lease|otherAccount|[a-f0-9]{64}/)
  })

  it('returns bounded image IDs and account-bound URLs, with unavailable references left visible', async () => {
    const { tx, database, input } = fixture()
    const page = await listArtworkDedupComparisons('user-a', input, database)
    expect(page.items).toEqual([
      {
        id: 1,
        kind: 'SIMILAR',
        left: {
          artworkId: 1,
          imageId: 11,
          index: 0,
          thumbnailUrl: '/api/artwork-dedup/cover/1?expectedUserId=user-a&imageId=11'
        },
        right: { artworkId: 2, imageId: 21, index: 1, thumbnailUrl: null }
      }
    ])
    expect(page.nextCursor).toBeTruthy()
    expect(tx.artworkDedupVisualPage.findMany).toHaveBeenCalledWith({
      where: { pairId: 'visual-1', ordinal: { gt: 0 }, kind: { not: 'EXACT' } },
      orderBy: { ordinal: 'asc' },
      take: 2
    })
    expect(tx.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, artworkId: true },
        where: expect.objectContaining({ artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } })
      })
    )
    expect(JSON.stringify(page)).not.toMatch(/path|lease|otherAccount|[a-f0-9]{64}/)
    await expect(
      listArtworkDedupComparisons('user-a', { ...input, cursor: page.nextCursor!, filter: 'ALL' }, database)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('rejects stale accounts before opening a transaction and wrong-run pairs before reading images', async () => {
    const { tx, database, input } = fixture()
    await expect(listArtworkDedupComparisons('user-b', input, database)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(database.$transaction).not.toHaveBeenCalled()
    await expect(
      listArtworkDedupComparisons('user-a', { ...input, runId: 'other-run' }, database)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(tx.artworkDedupVisualPage.findMany).not.toHaveBeenCalled()
    expect(tx.image.findMany).not.toHaveBeenCalled()
  })
})
