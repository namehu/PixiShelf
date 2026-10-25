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
function fixture() {
  const tx = {
    artworkDedupRun: { findUnique: vi.fn(async () => ({ status: 'COMPLETED', version: 4 })) },
    artworkDedupVisualPair: {
      findUnique: vi.fn(async () => ({ id: 'visual-1', runId: 'run-1', leftArtworkId: 1, rightArtworkId: 2, summary }))
    },
    artworkDedupVisualPage: {
      findMany: vi.fn(async () => [
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
    expect(JSON.stringify(page)).not.toMatch(/path|sha256|lease|otherAccount/)
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
