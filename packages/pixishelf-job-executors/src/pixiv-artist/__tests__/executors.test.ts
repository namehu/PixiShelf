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

  it('discovers checked identities and propagates the explicit refresh policy', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'ref-1', artistId: 1, externalId: '101' }])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtistExecutorRegistrations({
      database: { artistExternalRef: { findMany } } as never,
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
