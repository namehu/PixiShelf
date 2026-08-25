import { describe, expect, it, vi } from 'vitest'
import { createPixivArtistExecutorRegistrations } from '../executors.ts'

describe('Pixiv artist enrichment executor', () => {
  it('discovers at most 200 unchecked identities and freezes their ids in child payloads', async () => {
    const refs = Array.from({ length: 200 }, (_, index) => ({
      id: `ref-${index + 1}`,
      artistId: index + 1,
      externalId: String(index + 101)
    }))
    const findMany = vi.fn().mockResolvedValue(refs)
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })
    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)
    expect(outcome).toMatchObject({ kind: 'completed', result: { discovered: 200, enqueued: 200 } })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: null }), take: 200 })
    )
    expect(enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_ARTIST_ENRICHMENT',
        payload: expect.objectContaining({ artistId: 1, expectedExternalRefId: 'ref-1', expectedPixivUserId: '101' })
      })
    )
  })

  it('skips an item when its confirmed Pixiv identity changed', async () => {
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      pixivDataRoot: '/pixiv-data'
    })
    await expect(
      registration!.execute(
        context({
          mode: 'ARTIST',
          artistId: 1,
          expectedExternalRefId: 'ref-1',
          expectedPixivUserId: '101',
          force: true
        }) as never
      )
    ).resolves.toMatchObject({ kind: 'skipped', reason: 'PRECONDITION_NOT_MET' })
  })

  it('fills only empty image fields and never replaces the main artist name', async () => {
    const artistUpdate = vi.fn().mockResolvedValue(undefined)
    const refUpdate = vi.fn().mockResolvedValue(undefined)
    const database = {
      artistExternalRef: {
        findFirst: vi.fn().mockResolvedValue({ artist: { avatar: 'manual.jpg', backgroundImg: null } })
      }
    }
    const transaction = {
      artistExternalRef: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ref-1',
          artist: { id: 1, avatar: 'manual.jpg', backgroundImg: null }
        }),
        update: refUpdate
      },
      artist: { update: artistUpdate }
    }
    const [registration] = createPixivArtistExecutorRegistrations({
      database: database as never,
      pixivDataRoot: '/pixiv-data',
      sleep: async () => undefined,
      fetchImpl: (async (url: string | URL) =>
        String(url).includes('/ajax/user/')
          ? new Response(JSON.stringify({ error: false, body: { userId: '101', name: 'Pixiv Name' } }), { status: 200 })
          : new Response(null, { status: 404 })) as typeof fetch,
      now: () => new Date('2026-08-25T00:00:00.000Z')
    })
    const outcome = await registration!.execute(
      context(
        { mode: 'ARTIST', artistId: 1, expectedExternalRefId: 'ref-1', expectedPixivUserId: '101', force: true },
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
    expect(artistUpdate).not.toHaveBeenCalled()
    expect(refUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceName: 'Pixiv Name', status: 'SUCCESS', lastSystemJobId: 'job-1' })
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
