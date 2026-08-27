import { describe, expect, it, vi } from 'vitest'
import { createPixivSeriesExecutorRegistrations } from '../executors.ts'

describe('Pixiv series reconciliation executor', () => {
  it('continues discovery after the first 200 unchecked artworks', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ref(index + 1))
    const findMany = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([ref(201)])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivSeriesExecutorRegistrations({
      database: { artworkExternalRef: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(
      context({ mode: 'DISCOVER', refreshExisting: false }, { enqueueChild }) as never
    )

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 201, pageCount: 2, discovered: 201, enqueued: 201, reused: 0 }
    })
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { AND: [expect.anything(), { artworkId: { gt: 200 } }] },
      take: 200
    })
    expect(enqueueChild).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          artworkId: 201,
          expectedPixivArtworkId: '1201',
          refreshExisting: false
        }),
        queuePriority: 900
      })
    )
  })

  it('orders a full refresh by the oldest series attempt and propagates refresh mode', async () => {
    const attemptedAt = new Date('2026-08-01T00:00:00.000Z')
    const findMany = vi.fn().mockResolvedValueOnce([{ ...ref(1), seriesLastAttemptAt: attemptedAt }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivSeriesExecutorRegistrations({
      database: { artworkExternalRef: { count: vi.fn().mockResolvedValue(1), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await registration!.execute(
      context({ mode: 'DISCOVER', refreshExisting: true }, { enqueueChild }) as never
    )

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: expect.not.objectContaining({ seriesSyncStatus: null }),
      orderBy: [{ seriesLastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artworkId: 'asc' }]
    })
    expect(enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ refreshExisting: true }) })
    )
  })
})

function context(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    job: { id: 'job-1', attempt: 1, maxAttempts: 3 },
    payload,
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    enqueueChild: vi.fn(),
    mutateInTransaction: vi.fn(),
    finalizeInTransaction: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

function ref(artworkId: number) {
  return {
    id: `ref-${artworkId}`,
    artworkId,
    externalId: String(1_000 + artworkId),
    seriesLastAttemptAt: null
  }
}
