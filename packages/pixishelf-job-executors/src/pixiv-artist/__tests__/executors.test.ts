import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPixivArtistExecutorRegistrations } from '../executors.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv artist enrichment executor', () => {
  it('discovers one page of unchecked identities and freezes their ids in child payloads', async () => {
    const refs = Array.from({ length: 200 }, (_, index) => ({
      id: `ref-${index + 1}`,
      artistId: index + 1,
      externalId: String(index + 101)
    }))
    const findMany = vi.fn().mockResolvedValue(refs)
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { count: vi.fn().mockResolvedValue(200), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })
    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 200, pageCount: 1, discovered: 200, enqueued: 200, reused: 0 }
    })
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

  it('discovers checked identities and propagates the explicit refresh policy', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'ref-1', artistId: 1, externalId: '101' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { count: vi.fn().mockResolvedValue(1), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await registration!.execute(
      context({ mode: 'DISCOVER', force: false, refreshExisting: true }, { enqueueChild }) as never
    )

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: null }),
        orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artistId: 'asc' }]
      })
    )
    expect(enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ refreshExisting: true }) })
    )
  })

  it('continues after the first 200 unchecked identities in a default batch', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `ref-${index + 1}`,
      artistId: index + 1,
      externalId: String(index + 101)
    }))
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 'ref-201', artistId: 201, externalId: '301' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 201, pageCount: 2, discovered: 201, enqueued: 201, reused: 0 }
    })
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { AND: [expect.anything(), { artistId: { gt: 200 } }] },
      take: 200
    })
    expect(enqueueChild).toHaveBeenCalledTimes(201)
  })

  it('materializes more than 5000 refresh candidates as one logical batch in oldest-first pages', async () => {
    const totalCandidates = 5_001
    const attemptedAt = new Date('2026-08-01T00:00:00.000Z')
    const findMany = vi
      .fn()
      .mockImplementation(({ where }: { where: { AND?: [{}, { OR?: Array<{ artistId?: { gt: number } }> }] } }) => {
        const cursorArtistId = where.AND?.[1].OR?.find(({ artistId }) => artistId)?.artistId?.gt ?? 0
        const start = cursorArtistId + 1
        return Promise.resolve(
          Array.from({ length: Math.min(200, totalCandidates - start + 1) }, (_, index) => ({
            id: `ref-${start + index}`,
            artistId: start + index,
            externalId: String(start + index + 100),
            lastAttemptAt: start + index <= 200 ? null : attemptedAt
          }))
        )
      })
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const progress = vi.fn().mockResolvedValue(undefined)
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { count: vi.fn().mockResolvedValue(totalCandidates), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(
      context({ mode: 'DISCOVER', force: false, refreshExisting: true }, { enqueueChild, progress }) as never
    )

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates, pageCount: 26, discovered: totalCandidates, enqueued: totalCandidates, reused: 0 }
    })
    expect(findMany).toHaveBeenCalledTimes(26)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artistId: 'asc' }],
      take: 200
    })
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        AND: [
          expect.anything(),
          {
            OR: [{ lastAttemptAt: null, artistId: { gt: 200 } }, { lastAttemptAt: { not: null } }]
          }
        ]
      }
    })
    expect(findMany.mock.calls[2]?.[0]).toMatchObject({
      where: {
        AND: [
          expect.anything(),
          {
            OR: [{ lastAttemptAt: { gt: attemptedAt } }, { lastAttemptAt: attemptedAt, artistId: { gt: 400 } }]
          }
        ]
      }
    })
    expect(enqueueChild).toHaveBeenCalledTimes(totalCandidates)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        progress: 95,
        data: { totalCandidates, pageCount: 26, discovered: totalCandidates, enqueued: totalCandidates, reused: 0 }
      })
    )
  })

  it('reuses every child when an exact-page discovery is retried idempotently', async () => {
    const refs = Array.from({ length: 200 }, (_, index) => ({
      id: `ref-${index + 1}`,
      artistId: index + 1,
      externalId: String(index + 101)
    }))
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'existing-child', created: false })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: {
        artistExternalRef: { count: vi.fn().mockResolvedValue(200), findMany: vi.fn().mockResolvedValue(refs) }
      } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await expect(
      registration!.execute(context({ mode: 'DISCOVER', force: false }, { enqueueChild }) as never)
    ).resolves.toMatchObject({
      kind: 'completed',
      result: { totalCandidates: 200, pageCount: 1, discovered: 200, enqueued: 0, reused: 200 }
    })
  })

  it('stops discovery without materializing another page after cancellation', async () => {
    const controller = new AbortController()
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `ref-${index + 1}`,
      artistId: index + 1,
      externalId: String(index + 101)
    }))
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 'ref-201', artistId: 201, externalId: '301' }])
    const enqueueChild = vi.fn().mockImplementation(async () => {
      if (enqueueChild.mock.calls.length === 200) controller.abort(new Error('cancelled'))
      return { id: 'child', created: true }
    })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await expect(
      registration!.execute(
        context({ mode: 'DISCOVER', force: false }, { enqueueChild, signal: controller.signal }) as never
      )
    ).resolves.toEqual({ kind: 'released', message: 'Pixiv 艺术家发现已停止，等待恢复' })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(enqueueChild).toHaveBeenCalledTimes(200)
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

  it('refreshes existing Pixiv images without replacing the main artist name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artist-executor-'))
    temporaryRoots.push(root)
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#224466' } })
      .png()
      .toBuffer()
    const artistUpdate = vi.fn().mockResolvedValue(undefined)
    const refUpdate = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn().mockResolvedValue(undefined)
    const database = {
      artistExternalRef: {
        findFirst: vi.fn().mockResolvedValue({
          artist: { avatar: 'old-avatar.jpg', backgroundImg: 'old-background.jpg' }
        })
      }
    }
    const transaction = {
      artistExternalRef: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ref-1',
          artist: { id: 1, avatar: 'old-avatar.jpg', backgroundImg: 'old-background.jpg' }
        }),
        update: refUpdate
      },
      artist: { update: artistUpdate }
    }
    const [registration] = createPixivArtistExecutorRegistrations({
      database: database as never,
      pixivDataRoot: root,
      sleep: async () => undefined,
      fetchImpl: (async (url: string | URL) =>
        String(url).includes('/ajax/user/')
          ? new Response(
              JSON.stringify({
                error: false,
                body: {
                  userId: '101',
                  name: 'Latest Pixiv Name',
                  imageBig: 'https://i.pximg.net/avatar.png',
                  background: { url: 'https://i.pximg.net/background.png' }
                }
              }),
              { status: 200 }
            )
          : new Response(Uint8Array.from(image), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-08-25T00:00:00.000Z')
    })

    await registration!.execute(
      context(
        {
          mode: 'ARTIST',
          artistId: 1,
          expectedExternalRefId: 'ref-1',
          expectedPixivUserId: '101',
          force: true,
          refreshExisting: true
        },
        {
          finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
            await operation({
              transaction,
              executionStatus: 'RUNNING',
              controlStatus: 'CONTINUE',
              complete,
              skip: vi.fn()
            })
            return { kind: 'transactionally-finalized' }
          }
        }
      ) as never
    )

    expect(artistUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        avatar: expect.stringMatching(/^avatar-[a-f0-9]{64}\.png$/),
        backgroundImg: expect.stringMatching(/^background-[a-f0-9]{64}\.png$/)
      }
    })
    expect(artistUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('name')
    expect(refUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceName: 'Latest Pixiv Name',
          normalizedPayload: expect.objectContaining({ refreshExisting: true, skippedConcurrentFields: [] })
        })
      })
    )
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ appliedFields: ['avatar', 'backgroundImg'], skippedConcurrentFields: [] })
      })
    )
  })

  it('does not overwrite an image changed after a refresh started', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artist-executor-'))
    temporaryRoots.push(root)
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#224466' } })
      .png()
      .toBuffer()
    const artistUpdate = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn().mockResolvedValue(undefined)
    const transaction = {
      artistExternalRef: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ref-1',
          artist: { id: 1, avatar: 'new-manual-avatar.jpg', backgroundImg: null }
        }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      artist: { update: artistUpdate }
    }
    const [registration] = createPixivArtistExecutorRegistrations({
      database: {
        artistExternalRef: {
          findFirst: vi.fn().mockResolvedValue({ artist: { avatar: 'old-avatar.jpg', backgroundImg: null } })
        }
      } as never,
      pixivDataRoot: root,
      sleep: async () => undefined,
      fetchImpl: (async (url: string | URL) =>
        String(url).includes('/ajax/user/')
          ? new Response(
              JSON.stringify({
                error: false,
                body: { userId: '101', name: 'Pixiv Name', imageBig: 'https://i.pximg.net/avatar.png' }
              }),
              { status: 200 }
            )
          : new Response(Uint8Array.from(image), { status: 200 })) as typeof fetch
    })

    await registration!.execute(
      context(
        {
          mode: 'ARTIST',
          artistId: 1,
          expectedExternalRefId: 'ref-1',
          expectedPixivUserId: '101',
          force: true,
          refreshExisting: true
        },
        {
          finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
            await operation({
              transaction,
              executionStatus: 'RUNNING',
              controlStatus: 'CONTINUE',
              complete,
              skip: vi.fn()
            })
            return { kind: 'transactionally-finalized' }
          }
        }
      ) as never
    )

    expect(artistUpdate).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ appliedFields: [], skippedConcurrentFields: ['avatar'] })
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
