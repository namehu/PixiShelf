import { describe, expect, it, vi } from 'vitest'
import type { ArchiveDefaultTagBackfillPayload } from '@pixishelf/job-contracts'
import { executeArchiveDefaultTagBackfill } from '../archive-default-tag-backfill.js'

const payload: ArchiveDefaultTagBackfillPayload = {
  defaultTagIds: [2, 5],
  targetMaxArtworkId: 20,
  targetArtworkCount: 2,
  expectedExistingRelations: 1,
  expectedMissingRelations: 3,
  snapshotDigest: 'a'.repeat(64)
}

describe('archive default-tag backfill executor', () => {
  it('appends only missing MANUAL relations and completes with durable totals', async () => {
    const fixture = createFixture({
      tags: [{ id: 2 }, { id: 5 }],
      artworks: [{ id: 10 }, { id: 11 }],
      createdRelations: 3,
      nextArtwork: null
    })

    await expect(executeArchiveDefaultTagBackfill(fixture.context)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(fixture.transaction.artworkTag.createMany).toHaveBeenCalledWith({
      data: [
        { artworkId: 10, tagId: 2, provenance: 'MANUAL' },
        { artworkId: 10, tagId: 5, provenance: 'MANUAL' },
        { artworkId: 11, tagId: 2, provenance: 'MANUAL' },
        { artworkId: 11, tagId: 5, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
    expect(fixture.scope.complete).toHaveBeenCalledWith({
      result: {
        kind: 'COMPLETED',
        targetArtworks: 2,
        processedArtworks: 2,
        addedRelations: 3,
        existingRelations: 1,
        skippedArtworks: 0,
        failedArtworks: 0,
        skippedTagIds: []
      },
      message: '历史归档标签补全完成：检查 2 个作品，新增 3 个标签关系'
    })
  })

  it('persists a checkpoint and yields the writer lane without consuming an attempt', async () => {
    const fixture = createFixture({
      tags: [{ id: 2 }, { id: 5 }],
      artworks: [{ id: 10 }],
      createdRelations: 1,
      nextArtwork: { id: 11 }
    })
    const now = new Date('2026-08-28T08:00:00.000Z')

    await executeArchiveDefaultTagBackfill(fixture.context, { now: () => now })

    expect(fixture.transaction.systemJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        result: {
          kind: 'CHECKPOINT',
          afterArtworkId: 10,
          processedArtworks: 1,
          addedRelations: 1,
          existingRelations: 1,
          skippedTagIds: []
        },
        stage: 'YIELDING'
      })
    })
    expect(fixture.scope.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        availableAt: new Date('2026-08-28T08:00:01.000Z'),
        preserveAttempt: true,
        errorCode: 'RESOURCE_BUSY'
      })
    )
  })

  it('skips deleted configured tags and honors cancellation at a batch boundary', async () => {
    const deletedTagFixture = createFixture({
      tags: [{ id: 2 }],
      artworks: [{ id: 10 }],
      createdRelations: 1,
      nextArtwork: null
    })
    await executeArchiveDefaultTagBackfill(deletedTagFixture.context)
    expect(deletedTagFixture.scope.complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ skippedTagIds: [5] }) })
    )

    const cancelledFixture = createFixture({ executionStatus: 'CANCELLING' })
    await executeArchiveDefaultTagBackfill(cancelledFixture.context)
    expect(cancelledFixture.scope.cancel).toHaveBeenCalledWith('历史归档标签补全已取消，已追加的标签会保留')
    expect(cancelledFixture.transaction.artwork.findMany).not.toHaveBeenCalled()
  })
})

function createFixture(
  options: {
    executionStatus?: 'RUNNING' | 'PAUSING' | 'CANCELLING'
    tags?: Array<{ id: number }>
    artworks?: Array<{ id: number }>
    createdRelations?: number
    nextArtwork?: { id: number } | null
  } = {}
) {
  const transaction = {
    systemJob: {
      findUnique: vi.fn().mockResolvedValue({ result: null }),
      update: vi.fn().mockResolvedValue({ id: 'job-1' })
    },
    tag: { findMany: vi.fn().mockResolvedValue(options.tags ?? []) },
    artwork: {
      findMany: vi.fn().mockResolvedValue(options.artworks ?? []),
      findFirst: vi.fn().mockResolvedValue(options.nextArtwork ?? null)
    },
    artworkTag: { createMany: vi.fn().mockResolvedValue({ count: options.createdRelations ?? 0 }) }
  }
  const scope = {
    transaction,
    executionStatus: options.executionStatus ?? ('RUNNING' as const),
    controlStatus: 'CONTINUE' as const,
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined)
  }
  const context = {
    job: { id: 'job-1' },
    payload,
    signal: new AbortController().signal,
    finalizeInTransaction: async (operation: (value: typeof scope) => Promise<void>) => {
      await operation(scope)
      return { kind: 'transactionally-finalized' as const }
    }
  } as never
  return { context, scope, transaction }
}
