import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPixivArtworkExecutorRegistrations } from '../executors.ts'
import type { PixivArtworkSyncTrackedState } from '../sync-report.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Pixiv artwork enrichment executor', () => {
  it('continues after the first 200 unchecked identities', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ref(index + 1))
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([ref(201)])
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: { artworkExternalRef: { count: vi.fn().mockResolvedValue(201), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(context({ mode: 'DISCOVER' }, { enqueueChild }) as never)

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
        payload: expect.objectContaining({ artworkId: 201, expectedPixivArtworkId: '1201' }),
        queuePriority: 900
      })
    )
  })

  it('materializes 5001 refresh candidates in oldest-first pages', async () => {
    const totalCandidates = 5_001
    const attemptedAt = new Date('2026-08-01T00:00:00.000Z')
    const findMany = vi
      .fn()
      .mockImplementation(({ where }: { where: { AND?: [{}, { OR?: Array<{ artworkId?: { gt: number } }> }] } }) => {
        const cursorArtworkId = where.AND?.[1].OR?.find(({ artworkId }) => artworkId)?.artworkId?.gt ?? 0
        const start = cursorArtworkId + 1
        return Promise.resolve(
          Array.from({ length: Math.min(200, totalCandidates - start + 1) }, (_, index) => ({
            ...ref(start + index),
            lastAttemptAt: start + index <= 200 ? null : attemptedAt
          }))
        )
      })
    const enqueueChild = vi.fn().mockResolvedValue({ id: 'child', created: true })
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: { artworkExternalRef: { count: vi.fn().mockResolvedValue(totalCandidates), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    const outcome = await registration!.execute(
      context({ mode: 'DISCOVER', refreshExisting: true, adoptSourceText: true }, { enqueueChild }) as never
    )

    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { totalCandidates, pageCount: 26, discovered: totalCandidates, enqueued: totalCandidates, reused: 0 }
    })
    expect(findMany).toHaveBeenCalledTimes(26)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: expect.not.objectContaining({ status: null }),
      orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artworkId: 'asc' }]
    })
    expect(enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ adoptSourceText: true }) })
    )
  })

  it('rechecks explicitly selected artwork even when it already has a status', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([ref(7)])
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: { artworkExternalRef: { count: vi.fn().mockResolvedValue(1), findMany } } as never,
      pixivDataRoot: '/pixiv-data'
    })

    await registration!.execute(
      context(
        { mode: 'DISCOVER', artworkIds: [7], refreshExisting: false, adoptSourceText: false },
        { enqueueChild: vi.fn().mockResolvedValue({ id: 'child-7', created: true }) }
      ) as never
    )

    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({ artworkId: { in: [7] } })
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('status')
  })

  it('skips an ambiguous Pixiv identity before making a network request', async () => {
    const fetchImpl = vi.fn()
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: {
        artworkExternalRef: {
          findFirst: vi.fn().mockResolvedValue({
            artwork: {
              title: 'Title',
              description: null,
              titleOverridden: false,
              descriptionOverridden: false,
              externalRefs: [{ id: 'ref-1' }, { id: 'ref-2' }]
            }
          })
        }
      } as never,
      pixivDataRoot: '/pixiv-data',
      fetchImpl: fetchImpl as typeof fetch
    })

    await expect(registration!.execute(context(itemPayload()) as never)).resolves.toMatchObject({
      kind: 'skipped',
      reason: 'PRECONDITION_NOT_MET'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('updates source-owned fields and exact Pixiv SOURCE tags while preserving manual text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artwork-executor-'))
    temporaryRoots.push(root)
    const artworkUpdate = vi.fn().mockResolvedValue(undefined)
    const refUpdate = vi.fn().mockResolvedValue(undefined)
    const tagDelete = vi.fn().mockResolvedValue({ count: 1 })
    const tagUpdate = vi.fn().mockResolvedValue({ count: 0 })
    const tagRelationUpsert = vi.fn().mockResolvedValue(undefined)
    const aiRelationUpdate = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn().mockResolvedValue(undefined)
    const beforeArtwork = trackedArtwork({
      title: 'Manual title',
      description: 'Old source description',
      titleOverridden: true
    })
    const afterArtwork = trackedArtwork({
      ...beforeArtwork,
      description: 'Latest source description',
      bookmarkCount: 99,
      isAiGenerated: true,
      originalUrl: 'https://i.pximg.net/original.jpg',
      size: '1200x800',
      sourceDate: new Date('2026-08-01T00:00:00.000Z'),
      sourceUrl: 'https://www.pixiv.net/artworks/1001',
      thumbnailUrl: 'https://i.pximg.net/regular.jpg',
      xRestrict: '1',
      pixivAiType: 2,
      pixivType: 0,
      sanityLevel: 6
    })
    const observedArtwork = {
      title: 'Manual title',
      description: 'Old source description',
      titleOverridden: true,
      descriptionOverridden: false,
      externalRefs: [{ id: 'ref-1' }]
    }
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'ref-1' }]),
      artworkExternalRef: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ref-1',
          artworkId: 1,
          providerKey: 'pixiv',
          externalId: '1001',
          onlineSnapshotHash: null,
          onlineSnapshotPath: null,
          artwork: beforeArtwork
        }),
        update: refUpdate
      },
      artwork: { update: artworkUpdate, findUniqueOrThrow: vi.fn().mockResolvedValue(afterArtwork) },
      seriesArtwork: {
        findUnique: vi.fn().mockResolvedValue(null),
        delete: vi.fn()
      },
      tag: {
        upsert: vi.fn().mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 }),
        findFirst: vi.fn().mockResolvedValue({ id: 99 })
      },
      artworkTag: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ tag: { name: 'old-tag' } }])
          .mockResolvedValueOnce([{ tag: { name: 'tag-a' } }, { tag: { name: 'tag-b' } }]),
        deleteMany: tagDelete,
        updateMany: tagUpdate,
        upsert: tagRelationUpsert,
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 98, provenance: 'SOURCE', sourceRefId: 'ref-1' })
          .mockResolvedValueOnce({ id: 99, provenance: 'DERIVED', sourceRefId: null }),
        create: vi.fn().mockResolvedValue(undefined),
        update: aiRelationUpdate
      }
    }
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: {
        artworkExternalRef: { findFirst: vi.fn().mockResolvedValue({ artwork: observedArtwork }) }
      } as never,
      pixivDataRoot: root,
      sleep: async () => undefined,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
      fetchImpl: (async () => pixivResponse()) as typeof fetch
    })

    const outcome = await registration!.execute(
      context(itemPayload(), {
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
      }) as never
    )

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(artworkUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        description: 'Latest source description',
        bookmarkCount: 99,
        isAiGenerated: true,
        sourceUrl: 'https://www.pixiv.net/artworks/1001',
        pixivAiType: 2
      })
    })
    const updateData = artworkUpdate.mock.calls[0]?.[0].data
    expect(updateData).not.toHaveProperty('likeCount')
    expect(updateData).not.toHaveProperty('artist')
    expect(updateData).not.toHaveProperty('series')
    expect(tagDelete).toHaveBeenCalledWith({
      where: { artworkId: 1, provenance: 'SOURCE', sourceRefId: 'ref-1', tagId: { notIn: [11, 12] } }
    })
    expect(tagRelationUpsert).toHaveBeenCalledTimes(2)
    expect(aiRelationUpdate).toHaveBeenCalledWith({
      where: { id: 98 },
      data: { provenance: 'DERIVED', sourceRefId: null }
    })
    expect(refUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          onlineSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          onlineSnapshotPath: expect.stringMatching(/^artworks\/1001\/metadata\/[a-f0-9]{64}\.json$/)
        })
      })
    )
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ appliedTextFields: ['description'], tagCount: 2 }) })
    )
    const report = JSON.parse(await fs.readFile(path.join(root, 'artworks', '1001', 'sync-reports', 'job-1.json'), 'utf8'))
    expect(report).toMatchObject({
      changeKind: 'UPDATED',
      tags: { added: ['tag-a', 'tag-b'], removed: ['old-tag'] },
      snapshots: { before: null, changed: true }
    })
  })

  it('keeps a concurrent manual title edit and records PARTIAL when adopting source text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pixiv-artwork-executor-'))
    temporaryRoots.push(root)
    const artworkUpdate = vi.fn().mockResolvedValue(undefined)
    const refUpdate = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn().mockResolvedValue(undefined)
    const beforeArtwork = trackedArtwork({
      title: 'New manual title',
      description: 'Old description',
      titleOverridden: true,
      descriptionOverridden: true
    })
    const afterArtwork = trackedArtwork({
      ...beforeArtwork,
      description: 'Latest source description',
      descriptionOverridden: false,
      bookmarkCount: 99,
      isAiGenerated: true,
      originalUrl: 'https://i.pximg.net/original.jpg',
      size: '1200x800',
      sourceDate: new Date('2026-08-01T00:00:00.000Z'),
      sourceUrl: 'https://www.pixiv.net/artworks/1001',
      thumbnailUrl: 'https://i.pximg.net/regular.jpg',
      xRestrict: '1',
      pixivAiType: 2,
      pixivType: 0,
      sanityLevel: 6
    })
    const observedArtwork = {
      title: 'Old title',
      description: 'Old description',
      titleOverridden: true,
      descriptionOverridden: true,
      externalRefs: [{ id: 'ref-1' }]
    }
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'ref-1' }]),
      artworkExternalRef: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ref-1',
          artworkId: 1,
          providerKey: 'pixiv',
          externalId: '1001',
          onlineSnapshotHash: null,
          onlineSnapshotPath: null,
          artwork: beforeArtwork
        }),
        update: refUpdate
      },
      artwork: { update: artworkUpdate, findUniqueOrThrow: vi.fn().mockResolvedValue(afterArtwork) },
      seriesArtwork: {
        findUnique: vi.fn().mockResolvedValue(null),
        delete: vi.fn()
      },
      tag: {
        upsert: vi.fn().mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 }),
        findFirst: vi.fn().mockResolvedValue({ id: 99 })
      },
      artworkTag: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue(undefined),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 99, provenance: 'DERIVED', sourceRefId: null }),
        create: vi.fn().mockResolvedValue(undefined)
      }
    }
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: { artworkExternalRef: { findFirst: vi.fn().mockResolvedValue({ artwork: observedArtwork }) } } as never,
      pixivDataRoot: root,
      sleep: async () => undefined,
      fetchImpl: (async () => pixivResponse()) as typeof fetch
    })

    await registration!.execute(
      context(
        { ...itemPayload(), adoptSourceText: true },
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

    expect(artworkUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('title')
    expect(artworkUpdate.mock.calls[0]?.[0].data).toMatchObject({
      description: 'Latest source description',
      descriptionOverridden: false
    })
    expect(refUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) })
    )
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ skippedConcurrentFields: ['title'] }) })
    )
    const report = JSON.parse(await fs.readFile(path.join(root, 'artworks', '1001', 'sync-reports', 'job-1.json'), 'utf8'))
    expect(report).toMatchObject({ changeKind: 'PARTIAL', protectedFields: ['title'] })
  })

  it('does not publish NO_DATA after the Pixiv identity becomes ambiguous', async () => {
    const skip = vi.fn().mockResolvedValue(undefined)
    const updateMany = vi.fn()
    const observedArtwork = {
      title: 'Title',
      description: null,
      titleOverridden: false,
      descriptionOverridden: false,
      externalRefs: [{ id: 'ref-1' }]
    }
    const [registration] = createPixivArtworkExecutorRegistrations({
      database: { artworkExternalRef: { findFirst: vi.fn().mockResolvedValue({ artwork: observedArtwork }) } } as never,
      pixivDataRoot: '/pixiv-data',
      sleep: async () => undefined,
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch
    })

    const outcome = await registration!.execute(
      context(itemPayload(), {
        finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
          await operation({
            transaction: {
              $queryRaw: vi.fn().mockResolvedValue([]),
              artworkExternalRef: { updateMany }
            },
            executionStatus: 'RUNNING',
            controlStatus: 'CONTINUE',
            complete: vi.fn(),
            skip
          })
          return { kind: 'transactionally-finalized' }
        }
      }) as never
    )

    expect(outcome).toEqual({ kind: 'transactionally-finalized' })
    expect(skip).toHaveBeenCalledWith(expect.objectContaining({ reason: 'PRECONDITION_NOT_MET' }))
    expect(updateMany).not.toHaveBeenCalled()
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
  return { id: `ref-${artworkId}`, artworkId, externalId: String(1_000 + artworkId), lastAttemptAt: null }
}

function itemPayload() {
  return {
    mode: 'ARTWORK' as const,
    artworkId: 1,
    expectedExternalRefId: 'ref-1',
    expectedPixivArtworkId: '1001',
    adoptSourceText: false
  }
}

function pixivResponse() {
  return new Response(
    JSON.stringify({
      error: false,
      body: {
        id: '1001',
        title: 'Latest source title',
        description: 'Latest source description',
        userId: '2001',
        userName: 'Artist',
        createDate: '2026-08-01T00:00:00.000Z',
        pageCount: 1,
        width: 1200,
        height: 800,
        bookmarkCount: 99,
        likeCount: 77,
        xRestrict: 1,
        aiType: 2,
        illustType: 0,
        sl: 6,
        seriesNavData: null,
        urls: {
          original: 'https://i.pximg.net/original.jpg',
          regular: 'https://i.pximg.net/regular.jpg'
        },
        tags: { tags: [{ tag: 'tag-a' }, { tag: 'tag-b' }] }
      }
    }),
    { status: 200 }
  )
}

function trackedArtwork(overrides: Partial<PixivArtworkSyncTrackedState> = {}) {
  return { ...trackedArtworkDefaults(), ...overrides }
}

function trackedArtworkDefaults(): PixivArtworkSyncTrackedState {
  return {
    title: 'Title',
    description: null,
    titleOverridden: false,
    descriptionOverridden: false,
    bookmarkCount: null,
    isAiGenerated: null,
    originalUrl: null,
    size: null,
    sourceDate: null,
    sourceUrl: null,
    thumbnailUrl: null,
    xRestrict: null,
    pixivAiType: null,
    pixivType: null,
    sanityLevel: null
  }
}
