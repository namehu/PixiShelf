import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeArchiveQualityAudit } from '../quality-audit-executor.ts'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('../quality-evidence.ts', () => ({ refreshArchiveQualityEvidence: refresh }))

function setup(options: { status?: string; count?: number; result?: unknown; parentResult?: unknown } = {}) {
  const checkpoint = {
    kind: 'CHECKPOINT',
    afterArtworkId: 20,
    processedArtworks: 2,
    originalPages: 1,
    displayPages: 2,
    unknownPages: 3
  }
  const transaction = {
    systemJob: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ result: options.result ?? null, parentJobId: options.parentResult ? 'parent' : null }),
      findUnique: vi.fn().mockResolvedValue({ result: options.parentResult }),
      update: vi.fn()
    },
    artwork: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: options.count ?? 0 }, (_, index) => ({
            id: 21 + index,
            archiveRevisions: [{ id: `rev-${index}` }]
          }))
        )
    }
  }
  const scope = {
    executionStatus: options.status ?? 'RUNNING',
    transaction,
    complete: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    release: vi.fn()
  }
  const context = {
    payload: { targetMaxArtworkId: 100, targetArtworkCount: 100 },
    job: { id: 'job' },
    signal: new AbortController().signal,
    finalizeInTransaction: (operation: (scope: unknown) => Promise<unknown>) => operation(scope)
  } as unknown as Parameters<typeof executeArchiveQualityAudit>[0]
  return { context, scope, transaction, checkpoint }
}

describe('durable archive quality audit batches', () => {
  beforeEach(() =>
    refresh.mockReset().mockResolvedValue({ qualityOriginalCount: 1, qualityDisplayCount: 2, qualityUnknownCount: 3 })
  )
  it('persists one bounded batch and yields the writer without consuming an attempt', async () => {
    const { context, scope, transaction } = setup({ count: 10 })
    await executeArchiveQualityAudit(context, () => new Date('2026-11-05T00:00:00Z'))
    expect(refresh).toHaveBeenCalledTimes(10)
    expect(transaction.systemJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({
            afterArtworkId: 30,
            processedArtworks: 10,
            originalPages: 10,
            displayPages: 20,
            unknownPages: 30
          })
        })
      })
    )
    expect(scope.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveAttempt: true,
        schedulingYield: true,
        availableAt: new Date('2026-11-05T00:00:01Z')
      })
    )
  })
  it('continues a failed parent from its saved cursor and commits the final summary', async () => {
    const parentResult = {
      kind: 'CHECKPOINT',
      afterArtworkId: 20,
      processedArtworks: 2,
      originalPages: 1,
      displayPages: 2,
      unknownPages: 3
    }
    const { context, scope, transaction } = setup({ count: 1, parentResult })
    await executeArchiveQualityAudit(context)
    expect(transaction.artwork.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 20, lte: 100 } }) })
    )
    expect(scope.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          kind: 'COMPLETED',
          afterArtworkId: 21,
          processedArtworks: 3,
          originalPages: 2,
          displayPages: 4,
          unknownPages: 6
        }
      })
    )
  })
  it('pauses before querying or changing quality evidence', async () => {
    const { context, scope, transaction } = setup({ status: 'PAUSING', count: 10 })
    await executeArchiveQualityAudit(context)
    expect(scope.pause).toHaveBeenCalled()
    expect(transaction.artwork.findMany).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
  it('cancels without removing previously committed evidence', async () => {
    const { context, scope, transaction } = setup({ status: 'CANCELLING' })
    await executeArchiveQualityAudit(context)
    expect(scope.cancel).toHaveBeenCalled()
    expect(transaction.systemJob.update).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
