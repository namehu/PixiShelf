import { describe, expect, it, vi } from 'vitest'
import { createPixivTagExecutorRegistrations } from '../executors.ts'

describe('Pixiv tag enrichment executor', () => {
  it('discovers eligible tags and freezes each tag identity in a child payload', async () => {
    const count = vi.fn().mockResolvedValue(1)
    const findMany = vi.fn().mockResolvedValue([{ id: 7, name: 'original' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child-1', created: true })
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count, findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 1, pageCount: 1, discovered: 1, enqueued: 1, reused: 0 }
    })
    expect(enqueueChild).toHaveBeenCalledWith({
      type: 'PIXIV_TAG_ENRICHMENT',
      payload: { mode: 'TAG', tagId: 7, expectedName: 'original', force: false },
      queuePriority: 900,
      idempotencyKey: 'pixiv-tag:job-1:tag:7:v1'
    })
  })

  it('limits forced discovery to the explicitly selected tag ids', async () => {
    const count = vi.fn().mockResolvedValue(0)
    const findMany = vi.fn().mockResolvedValue([])
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count, findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await registration!.execute(context({ mode: 'DISCOVER', force: true, tagIds: [3, 7] }) as never)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { gt: 0, in: [3, 7] }
        })
      })
    )
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [3, 7] } })
      })
    )
  })

  it('reuses all 200 children when an exact-page discovery is retried idempotently', async () => {
    const page = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, name: `tag-${index + 1}` }))
    const findMany = vi.fn().mockResolvedValue(page)
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'existing-child', created: false })
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count: vi.fn().mockResolvedValue(200), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 200, pageCount: 1, discovered: 200, enqueued: 0, reused: 200 }
    })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(enqueueChild).toHaveBeenCalledTimes(200)
  })

  it('continues after the first 200 unexamined tags in a default batch', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, name: `tag-${index + 1}` }))
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 201, name: 'tag-201' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 201, pageCount: 2, discovered: 201, enqueued: 201 }
    })
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ where: { id: { gt: 200 } } })
    expect(enqueueChild).toHaveBeenCalledTimes(201)
  })

  it('materializes more than 5000 candidates as one logical batch across stable database pages', async () => {
    const totalCandidates = 5_001
    const findMany = vi.fn().mockImplementation(({ where }: { where: { id: { gt: number } } }) => {
      const start = where.id.gt + 1
      if (start > totalCandidates) return Promise.resolve([])
      return Promise.resolve(
        Array.from({ length: Math.min(200, totalCandidates - start + 1) }, (_, index) => ({
          id: start + index,
          name: `tag-${start + index}`
        }))
      )
    })
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const progress = vi.fn().mockResolvedValue(undefined)
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count: vi.fn().mockResolvedValue(totalCandidates), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(
      context({ mode: 'DISCOVER', force: false }, { enqueueChild, progress }) as never
    )

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates, pageCount: 26, discovered: totalCandidates, enqueued: totalCandidates, reused: 0 }
    })
    expect(findMany).toHaveBeenCalledTimes(26)
    expect(enqueueChild).toHaveBeenCalledTimes(totalCandidates)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        progress: 95,
        data: { totalCandidates, pageCount: 26, discovered: totalCandidates, enqueued: totalCandidates, reused: 0 }
      })
    )
  })

  it('stops discovery without materializing another page after cancellation', async () => {
    const controller = new AbortController()
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, name: `tag-${index + 1}` }))
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 201, name: 'tag-201' }])
    const enqueueChild = vi.fn().mockImplementation(async () => {
      if (enqueueChild.mock.calls.length === 200) controller.abort(new Error('cancelled'))
      return { id: 'child', created: true }
    })
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(
      context({ mode: 'DISCOVER', force: false }, { enqueueChild, signal: controller.signal }) as never
    )

    expect(outcome).toEqual({ kind: 'released', message: 'Pixiv 标签发现已停止，等待恢复' })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(enqueueChild).toHaveBeenCalledTimes(200)
  })

  it('fills only missing fields and preserves manual translation ownership', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const upsert = vi.fn().mockResolvedValue(undefined)
    const transaction = {
      tag: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          name_zh: '人工中文',
          name_en: null,
          abstract: '人工描述之外的既有简介',
          image: 'existing.jpg',
          translateType: 'MANUAL'
        }),
        update
      },
      tagExternalMetadata: { upsert }
    }
    const database = {
      tag: { findFirst: vi.fn().mockResolvedValue({ id: 7 }) }
    }
    const response = new Response(
      JSON.stringify({
        error: false,
        body: {
          tagTranslation: { original: { zh: 'Pixiv 中文', en: 'Pixiv English' } },
          pixpedia: { abstract: 'Pixiv 简介' }
        }
      }),
      { status: 200 }
    )
    const [registration] = createPixivTagExecutorRegistrations({
      database: database as never,
      pixivDataRoot: '/pixiv-data',
      fetchImpl: (async () => response) as typeof fetch,
      sleep: async () => undefined,
      now: () => new Date('2026-08-24T00:00:00.000Z')
    })

    const outcome = await registration!.execute(
      context(
        { mode: 'TAG', tagId: 7, expectedName: 'original', force: true },
        {
          finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
            await operation({
              transaction,
              executionStatus: 'RUNNING',
              controlStatus: 'CONTINUE',
              complete: vi.fn(),
              skip: vi.fn()
            })
            return { kind: 'transactionally-finalized' }
          }
        }
      ) as never
    )

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { name_en: 'Pixiv English' } })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'SUCCESS',
          normalizedPayload: {
            nameZh: 'Pixiv 中文',
            nameEn: 'Pixiv English',
            abstract: 'Pixiv 简介',
            imageAvailable: false,
            imageFile: null
          },
          lastSystemJobId: 'job-1'
        }),
        update: expect.objectContaining({ status: 'SUCCESS', lastSystemJobId: 'job-1' })
      })
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
