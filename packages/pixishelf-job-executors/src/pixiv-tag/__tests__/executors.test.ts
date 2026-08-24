import { describe, expect, it, vi } from 'vitest'
import { createPixivTagExecutorRegistrations } from '../executors.ts'

describe('Pixiv tag enrichment executor', () => {
  it('discovers eligible tags and freezes each tag identity in a child payload', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 7, name: 'original' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child-1', created: true })
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)

    expect(outcome).toMatchObject({ kind: 'completed', result: { discovered: 1, enqueued: 1, reused: 0 } })
    expect(enqueueChild).toHaveBeenCalledWith({
      type: 'PIXIV_TAG_ENRICHMENT',
      payload: { mode: 'TAG', tagId: 7, expectedName: 'original', force: false },
      queuePriority: 900,
      idempotencyKey: 'pixiv-tag:job-1:tag:7:v1'
    })
  })

  it('limits forced discovery to the explicitly selected tag ids', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const [registration] = createPixivTagExecutorRegistrations({
      database: { tag: { findMany } } as never,
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
