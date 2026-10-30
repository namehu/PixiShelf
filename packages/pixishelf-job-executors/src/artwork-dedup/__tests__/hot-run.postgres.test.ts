import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Prisma,
  PrismaClient,
  freezeArtworkDedupRun,
  artworkDedupHotReuseCheckpoint,
  beginMediaContentSourceWrite,
  finishMediaContentSourceWrite
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { createArtworkDedupExecutor, executeArtworkDedup, type ArtworkDedupDependencies } from '../executor.ts'
import { DedupReaderSupervisor } from '../reader.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/dedup_hot_reuse_core_20261030'
  )
    throw new Error('Dedicated synthetic hot-run core DB required')
}
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `dedup-executor-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-10-23T00:00:00Z'))
const capabilities = [
  { jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [8, 9] }
]
const repository = db
  ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20_000 })
  : null
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint:
    process.env.ARTWORK_DEDUP_TEST_READER_ENTRYPOINT ?? new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: process.env.ARTWORK_DEDUP_TEST_READER_ENTRYPOINT ? [] : ['--import', workerRequire.resolve('tsx')]
}
let root: string
const artists: number[] = []
const artworks: number[] = []
const mediaIds: number[] = []
const runs: string[] = []
const jobs: string[] = []
const externalMediaRoots: string[] = []
let roots: string[] = []
function context(
  job: ClaimedJob,
  controller = new AbortController()
): ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  return {
    job,
    payload: job.payload as ArtworkDedupScanPayload,
    signal: controller.signal,
    progress: (update) => repository!.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (operation) => repository!.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository!.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
function dependencies(extra: Partial<ArtworkDedupDependencies> = {}): ArtworkDedupDependencies {
  return {
    database: db!,
    sourceRoot: root,
    archiveRoot: root,
    readerOptions,
    now: () => clock.now().getTime(),
    ...extra
  }
}
beforeAll(async () => {
  if (db) root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-executor-')))
})
afterAll(async () => {
  if (!db) return
  roots = (
    await db.artworkDedupMedia.findMany({
      where: { runId: { in: runs } },
      distinct: ['rootIdentity'],
      select: { rootIdentity: true }
    })
  ).map((r) => r.rootIdentity)
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.image.deleteMany({ where: { OR: [{ id: { in: mediaIds } }, { artworkId: { in: artworks } }] } })
  await db.artwork.deleteMany({ where: { id: { in: artworks } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: roots } } })
  await db.$disconnect()
  if (root) await fs.rm(root, { recursive: true, force: true })
  for (const directory of externalMediaRoots) await fs.rm(directory, { recursive: true, force: true })
}, 60_000)

suite('v9 task-local metadata and whole-run reuse', () => {
  it.each(['cancel', 'lease', 'rollback'] as const)(
    'v9 hot batch saves no media, cursor or count after %s',
    async (change) => {
      const artistId = await fixture([[2, 2, 2]])
      const cold = await start(artistId, 'FULL', false, 8)
      await finish(cold.jobId)
      const hot = await start(artistId, 'INCREMENTAL', false, 9),
        job = await claim(hot.jobId)
      const supervisor = new DedupReaderSupervisor(readerOptions),
        create = supervisor.create.bind(supervisor)
      let changed = false
      supervisor.create = () => {
        const reader = create(),
          inspect = reader.inspect.bind(reader)
        reader.inspect = async (input) => {
          const result = await inspect(input)
          if (!changed) {
            changed = true
            if (change === 'lease')
              await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
            if (change === 'cancel')
              await db!.systemJob.update({
                where: { id: job.id },
                data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
              })
          }
          return result
        }
        return reader
      }
      const ctx = context(job),
        mutate = ctx.mutateInTransaction
      ctx.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
        operation: (tx: TTransaction) => Promise<TResult>
      ) =>
        mutate<TTransaction, TResult>(async (tx) => {
          const result = await operation(tx)
          if (changed && change === 'rollback') throw new Error('hot batch rollback')
          return result
        })
      try {
        const outcome = executeArtworkDedup(ctx, dependencies({ supervisor }))
        if (change === 'lease') await expect(outcome).rejects.toThrow()
        else await outcome
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
          statMedia: 0,
          cacheHitMedia: 0,
          hashedMedia: 0
        })
        expect(await db!.artworkDedupItem.findFirstOrThrow({ where: { runId: hot.runId } })).toMatchObject({
          afterImageId: 0
        })
        expect(await db!.artworkDedupMedia.count({ where: { runId: hot.runId } })).toBe(0)
      } finally {
        if (change === 'lease') {
          await db!.systemJob.update({
            where: { id: job.id },
            data: { leaseToken: job.leaseToken, status: 'CANCELLING', cancelRequestedAt: clock.now() }
          })
          const controller = new AbortController()
          controller.abort(new Error('fixture cleanup'))
          await executeArtworkDedup(context(job, controller), dependencies())
        }
      }
    },
    20_000
  )

  it('copies exact, contains and partial graphs with current order, without review authority or historical dependencies', async () => {
    const artistId = await fixture([[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4], [1, 2, 3, 4, 6], [99]])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const original = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })
    expect(original.groupCount).toBeGreaterThan(1)
    const images = await db!.image.findMany({
      where: { artwork: { creators: { some: { artistId } } } },
      orderBy: { id: 'asc' }
    })
    for (const image of images) await db!.image.update({ where: { id: image.id }, data: { sortOrder: -image.id } })
    await db!.artwork.updateMany({
      where: { id: { in: images.map((i) => i.artworkId!) } },
      data: { title: 'new title' }
    })
    const hot = await start(artistId, 'INCREMENTAL', false, 9)
    await finish(hot.jobId)
    const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
    expect(result).toMatchObject({
      groupCount: original.groupCount,
      cacheHitMedia: images.length,
      statMedia: images.length,
      hashedMedia: 0,
      readBytes: 0n,
      visualCheckpoint: { version: 4, kind: 'hot-run-reuse', sourceRunId: cold.runId, stage: 'done' }
    })
    const pages = await db!.artworkDedupVisualPage.findMany({ where: { pair: { runId: hot.runId } } })
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages)
      for (const side of ['left', 'right'] as const) {
        const id = page[`${side}ImageId`]
        if (id === null) continue
        const image = images.find((i) => i.id === id)!
        const order = images.filter((i) => i.artworkId === image.artworkId).sort((a, b) => b.id - a.id)
        expect(page[`${side}Index`]).toBe(order.findIndex((i) => i.id === id))
      }
    expect(await db!.artworkDedupReview.count({ where: { runId: hot.runId } })).toBe(0)
    expect(await db!.artworkDedupOperation.count({ where: { runId: hot.runId } })).toBe(0)
    await db!.artworkDedupRun.delete({ where: { id: cold.runId } })
    expect(await db!.artworkDedupVisualPage.count({ where: { pair: { runId: hot.runId } } })).toBe(pages.length)
  }, 30_000)

  it('reuses completed visual evidence without feature decoding, original reads or candidate work', async () => {
    const artistId = await visualFixture(3)
    const cold = await start(artistId, 'INCREMENTAL', true, 8)
    await finish(cold.jobId)
    const original = await db!.artworkDedupVisualPair.findMany({
      where: { runId: cold.runId },
      select: { relationKind: true, summary: true }
    })
    expect(original.length).toBeGreaterThan(0)
    const hot = await start(artistId, 'INCREMENTAL', true, 9)
    await finish(hot.jobId)
    const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
    expect(result).toMatchObject({
      visualSearchComplete: true,
      readBytes: 0n,
      visualComparedComparisons: 0,
      visualCheckpoint: { version: 4, stage: 'done' }
    })
    expect(
      await db!.artworkDedupVisualPair.findMany({
        where: { runId: hot.runId },
        select: { relationKind: true, summary: true }
      })
    ).toEqual(original)
    expect(result.performanceSummary).toMatchObject({ counters: { copiedRows: expect.any(Number), reusedArtworks: 2 } })
  }, 30_000)

  it.each(['declared', 'decoded'] as const)(
    'reuses complete mixed-media coverage with %s exclusions',
    async (kind) => {
      const artistId = await visualFixture(3)
      const images = await db!.image.findMany({
        where: { artwork: { creators: { some: { artistId } } } },
        orderBy: { id: 'asc' }
      })
      const animated = Buffer.from(
        'UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA',
        'base64'
      )
      for (const image of [images[0]!, images[3]!]) {
        if (kind === 'declared') await db!.image.update({ where: { id: image.id }, data: { mediaType: 'ANIMATION' } })
        else await fs.writeFile(path.join(root, image.path), animated)
      }
      const cold = await start(artistId, 'INCREMENTAL', true, 8)
      await finish(cold.jobId)
      const hot = await start(artistId, 'INCREMENTAL', true, 9)
      await finish(hot.jobId)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
        visualStatus: 'INCOMPLETE',
        visualIncompleteReasons: ['UNSUPPORTED_MEDIA'],
        visualSearchComplete: true,
        readBytes: 0n,
        visualCheckpoint: { version: 4, stage: 'done' },
        performanceSummary: { progress: { uncheckedMedia: 2 } }
      })
    },
    30_000
  )

  it.each(['feature-cache', 'identity', 'feature-version', 'search-version', 'incomplete', 'options'] as const)(
    'does not whole-run reuse after %s changes',
    async (change) => {
      const artistId = await visualFixture(2)
      const cold = await start(artistId, 'INCREMENTAL', true, 8)
      await finish(cold.jobId)
      const first = await db!.artworkDedupMedia.findFirstOrThrow({ where: { runId: cold.runId } })
      if (change === 'feature-cache') await db!.mediaVisualFingerprint.delete({ where: { imageId: first.imageId } })
      if (change === 'identity')
        await db!.mediaVisualFingerprint.update({ where: { imageId: first.imageId }, data: { identity: 'old' } })
      if (change === 'feature-version')
        await db!.mediaVisualFingerprint.update({
          where: { imageId: first.imageId },
          data: { algorithmVersion: 'old' }
        })
      if (change === 'search-version')
        await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { visualSearchVersion: 'old' } })
      if (change === 'incomplete')
        await db!.artworkDedupRun.update({
          where: { id: cold.runId },
          data: {
            visualSearchComplete: false,
            visualIncompleteReasons: ['VISUAL_FILE_BUDGET'],
            visualStatus: 'INCOMPLETE'
          }
        })
      const hot = await start(artistId, 'INCREMENTAL', change !== 'options', 9)
      await finish(hot.jobId)
      const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
      expect(artworkDedupHotReuseCheckpoint(result.visualCheckpoint)).toBeNull()
    },
    30_000
  )

  it.each(['modify', 'insert', 'delete', 'missing', 'full'] as const)(
    'uses the existing changed-input path for %s',
    async (change) => {
      const artistId = await fixture([
        [2, 2, 2],
        [2, 2, 2]
      ])
      const cold = await start(artistId, 'FULL', false, 8)
      await finish(cold.jobId)
      const image = await db!.image.findFirstOrThrow({
        where: { artwork: { creators: { some: { artistId } } } },
        orderBy: { id: 'asc' }
      })
      if (change === 'modify') await fs.writeFile(path.join(root, image.path), Buffer.alloc(3, 3))
      if (change === 'missing') await db!.mediaContentFingerprint.delete({ where: { imageId: image.id } })
      if (change === 'delete') await db!.image.delete({ where: { id: image.id } })
      if (change === 'insert') {
        const relative = `${image.artworkId}/new.bin`
        await fs.writeFile(path.join(root, relative), Buffer.alloc(4, 4))
        await db!.image.create({ data: { artworkId: image.artworkId, path: relative } })
      }
      const hot = await start(artistId, change === 'full' ? 'FULL' : 'INCREMENTAL', false, 9)
      await finish(hot.jobId)
      const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
      expect(result).toMatchObject({
        status: 'COMPLETED',
        hashedMedia: change === 'full' ? 6 : change === 'delete' ? 0 : 1,
        cacheHitMedia: change === 'full' ? 0 : change === 'insert' ? 6 : 5
      })
      expect(artworkDedupHotReuseCheckpoint(result.visualCheckpoint)).toBeNull()
    },
    30_000
  )

  it('commits a 500-original prefix and resumes in a new executor without recounting', async () => {
    const artistId = await fixture([Array<number>(505).fill(2)])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 9)
    const supervisor = new DedupReaderSupervisor(readerOptions),
      create = supervisor.create.bind(supervisor)
    let inspected = 0
    supervisor.create = () => {
      const reader = create(),
        inspect = reader.inspect.bind(reader)
      reader.inspect = async (input) => {
        const value = await inspect(input)
        if (++inspected === 500) clock.advance(10_000)
        return value
      }
      return reader
    }
    await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'RETRY_WAIT',
      statMedia: 500,
      cacheHitMedia: 0
    })
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'COMPLETED',
      statMedia: 505,
      cacheHitMedia: 505,
      hashedMedia: 0,
      visualCheckpoint: { version: 4, stage: 'done' }
    })
  }, 30_000)

  it.each([false, true])(
    'resumes a durable copy checkpoint, source loss=%s',
    async (loseSource) => {
      const artistId = await fixture([
        [1, 2, 3, 4, 5],
        [1, 2, 3, 4, 6]
      ])
      const cold = await start(artistId, 'FULL', false, 8)
      await finish(cold.jobId)
      const hot = await start(artistId, 'INCREMENTAL', false, 9),
        ctx = context(await claim(hot.jobId)),
        mutate = ctx.mutateInTransaction
      ctx.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
        operation: (tx: TTransaction) => Promise<TResult>,
        observe?: import('@pixishelf/job-runtime').FencedMutationTransactionObserver
      ) =>
        mutate<TTransaction, TResult>(async (tx) => {
          const value = await operation(tx)
          const run = await (tx as unknown as Prisma.TransactionClient).artworkDedupRun.findUniqueOrThrow({
            where: { id: hot.runId }
          })
          if (artworkDedupHotReuseCheckpoint(run.visualCheckpoint)?.stage === 'members') clock.advance(10_000)
          return value
        }, observe)
      await executeArtworkDedup(ctx, dependencies())
      const partial = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
      expect(partial).toMatchObject({
        status: 'RETRY_WAIT',
        stage: 'CANDIDATES',
        visualCheckpoint: { version: 4, stage: 'members' }
      })
      if (loseSource) await db!.artworkDedupRun.delete({ where: { id: cold.runId } })
      await finish(hot.jobId)
      const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
      expect(result.groupCount).toBe(1)
      expect(artworkDedupHotReuseCheckpoint(result.visualCheckpoint)?.stage ?? null).toBe(loseSource ? null : 'done')
    },
    30_000
  )

  it('restarts bounded evidence copying when order changes after the first 1000 pages', async () => {
    const artistId = await fixture([
      [...Array<number>(808).fill(1), ...Array<number>(202).fill(2)],
      [...Array<number>(808).fill(1), ...Array<number>(202).fill(3)]
    ])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 9),
      ctx = context(await claim(hot.jobId)),
      mutate = ctx.mutateInTransaction
    ctx.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
      operation: (tx: TTransaction) => Promise<TResult>,
      observe?: import('@pixishelf/job-runtime').FencedMutationTransactionObserver
    ) =>
      mutate<TTransaction, TResult>(async (tx) => {
        const value = await operation(tx)
        const run = await (tx as unknown as Prisma.TransactionClient).artworkDedupRun.findUniqueOrThrow({
          where: { id: hot.runId }
        })
        const checkpoint = artworkDedupHotReuseCheckpoint(run.visualCheckpoint)
        if (checkpoint?.stage === 'pages' && checkpoint.ordinal > 0) clock.advance(10_000)
        return value
      }, observe)
    await executeArtworkDedup(ctx, dependencies())
    expect(await db!.artworkDedupVisualPage.count({ where: { pair: { runId: hot.runId } } })).toBe(1000)
    const ids = (await db!.artworkDedupItem.findMany({ where: { runId: hot.runId }, select: { artworkId: true } })).map(
      (i) => i.artworkId
    )
    const moved = await db!.image.findFirstOrThrow({ where: { artworkId: ids[0]! }, orderBy: { id: 'desc' } })
    await db!.image.update({ where: { id: moved.id }, data: { sortOrder: -moved.id } })
    await finish(hot.jobId)
    const pages = await db!.artworkDedupVisualPage.findMany({
      where: { pair: { runId: hot.runId } },
      orderBy: { ordinal: 'asc' }
    })
    expect(pages).toHaveLength(1212)
    expect(new Set(pages.map((p) => p.leftImageId).filter((id) => id !== null)).size).toBe(1010)
    expect(new Set(pages.map((p) => p.rightImageId).filter((id) => id !== null)).size).toBe(1010)
    expect(pages[0]!.leftIndex).toBe(0)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      statMedia: 2020,
      cacheHitMedia: 2020,
      hashedMedia: 0,
      visualCheckpoint: { stage: 'done', copiedRows: 3235, reusedRelations: 1 },
      performanceSummary: {
        counters: { copiedRows: 3235, reusedRelations: 1, discardedCopyRows: 3023, discardedReusedRelations: 1 }
      }
    })
  }, 60_000)

  it('retries only projection when order changes immediately before publication', async () => {
    const artistId = await fixture([
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 6]
    ])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 9)
    const supervisor = new DedupReaderSupervisor(readerOptions),
      create = supervisor.create.bind(supervisor)
    let changed = false
    supervisor.create = () => {
      const reader = create(),
        close = reader.close.bind(reader)
      reader.close = async (...args) => {
        await close(...args)
        if (changed) return
        changed = true
        const ids = (
          await db!.artworkDedupItem.findMany({ where: { runId: hot.runId }, select: { artworkId: true } })
        ).map((i) => i.artworkId)
        const moved = await db!.image.findFirstOrThrow({ where: { artworkId: ids[0]! }, orderBy: { id: 'desc' } })
        await db!.image.update({ where: { id: moved.id }, data: { sortOrder: -moved.id } })
      }
      return reader
    }
    await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'RETRY_WAIT',
      stage: 'CANDIDATES',
      visualCheckpoint: { stage: 'items' }
    })
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'COMPLETED',
      statMedia: 10,
      hashedMedia: 0,
      visualCheckpoint: { stage: 'done', copiedRows: 19 },
      performanceSummary: {
        counters: { copiedRows: 19, reusedRelations: 1, discardedCopyRows: 19, discardedReusedRelations: 1 }
      }
    })
  }, 30_000)

  it('revalidates media classification changed after the final copy', async () => {
    const artistId = await visualFixture(3)
    const cold = await start(artistId, 'INCREMENTAL', true, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', true, 9)
    const image = await db!.image.findFirstOrThrow({ where: { artwork: { creators: { some: { artistId } } } } })
    const supervisor = new DedupReaderSupervisor(readerOptions),
      create = supervisor.create.bind(supervisor)
    let changed = false
    supervisor.create = () => {
      const reader = create(),
        close = reader.close.bind(reader)
      reader.close = async (...args) => {
        await close(...args)
        if (changed) return
        changed = true
        await db!.image.update({ where: { id: image.id }, data: { mediaType: 'ANIMATION' } })
      }
      return reader
    }
    await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'RETRY_WAIT',
      stage: 'CANDIDATES'
    })
    await finish(hot.jobId)
    const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
    expect(result).toMatchObject({
      status: 'COMPLETED',
      visualStatus: 'INCOMPLETE',
      visualIncompleteReasons: ['UNSUPPORTED_MEDIA'],
      performanceSummary: { counters: { copiedRows: 0, reusedRelations: 0 } }
    })
    expect(artworkDedupHotReuseCheckpoint(result.visualCheckpoint)).toBeNull()
  }, 30_000)

  it.each(['source', 'directory'] as const)(
    'rechecks final publication after %s changes following result copy',
    async (change) => {
      const artistId = await fixture([
        [2, 2],
        [2, 2]
      ])
      const cold = await start(artistId, 'FULL', false, 8)
      await finish(cold.jobId)
      const hot = await start(artistId, 'INCREMENTAL', false, 9)
      const image = await db!.image.findFirstOrThrow({ where: { artwork: { creators: { some: { artistId } } } } })
      const supervisor = new DedupReaderSupervisor(readerOptions),
        create = supervisor.create.bind(supervisor)
      let changed = false,
        sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
      supervisor.create = () => {
        const reader = create(),
          close = reader.close.bind(reader)
        reader.close = async (...args) => {
          await close(...args)
          if (changed) return
          changed = true
          expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
            stage: 'DONE',
            visualCheckpoint: { stage: 'done' }
          })
          if (change === 'source')
            sourceWrite = await db!.$transaction((tx) =>
              beginMediaContentSourceWrite(tx, {
                artworkIds: [image.artworkId!],
                imageIds: [image.id],
                writeToken: randomUUID(),
                now: clock.now()
              })
            )
          else {
            const media = await db!.artworkDedupMedia.findFirstOrThrow({
              where: { runId: hot.runId, imageId: image.id }
            })
            await db!.mediaContentDirectoryState.update({
              where: { id: media.directoryId },
              data: { generation: { increment: 1 } }
            })
          }
        }
        return reader
      }
      try {
        await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
        expect(changed).toBe(true)
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
          status: 'FAILED',
          groupCount: 0
        })
        expect(await db!.artworkDedupGroup.count({ where: { runId: hot.runId } })).toBe(0)
      } finally {
        if (sourceWrite)
          await db!.$transaction((tx) =>
            finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' })
          )
      }
    },
    30_000
  )

  it('reuses a complete empty artist scope', async () => {
    const artistId = await fixture([])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 9)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      artworkCount: 0,
      groupCount: 0,
      visualCheckpoint: { version: 4, stage: 'done' }
    })
  })

  it('reuses an unchanged complete negative result', async () => {
    const artistId = await fixture([[7], [13]])
    const cold = await start(artistId, 'FULL', false, 8)
    await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 9)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      groupCount: 0,
      visualCheckpoint: { version: 4, stage: 'done' }
    })
  })
})

async function fixture(
  works: number[][],
  options: { source?: 'LOCAL_IMPORT' | 'URL_ARCHIVE'; mediaRoot?: string } = {}
) {
  const artist = await db!.artist.create({ data: { name: `${prefix}-${artists.length}` } })
  artists.push(artist.id)
  for (const sizes of works) {
    const artwork = await db!.artwork.create({
      data: {
        title: `${prefix}-${artworks.length}`,
        source: options.source ?? 'LOCAL_IMPORT',
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: `${prefix}-${artworks.length}`, present: true } }
          }
        }
      }
    })
    artworks.push(artwork.id)
    await fs.mkdir(path.join(options.mediaRoot ?? root, String(artwork.id)))
    for (let i = 0; i < sizes.length; i++) {
      const relative = `${artwork.id}/${i}.bin`
      await fs.writeFile(path.join(options.mediaRoot ?? root, relative), Buffer.alloc(sizes[i]!, sizes[i]))
      mediaIds.push((await db!.image.create({ data: { artworkId: artwork.id, path: relative, sortOrder: i } })).id)
    }
  }
  return artist.id
}
async function visualFixture(count: number) {
  const nonce = randomUUID()
  const artistId = await fixture([Array<number>(count).fill(1), Array<number>(count).fill(2)])
  const images = await db!.image.findMany({
    where: { artwork: { creators: { some: { artistId } } } },
    orderBy: { id: 'asc' }
  })
  for (const [index, image] of images.entries()) {
    const pixels = Buffer.from(
      Array.from(
        { length: 192 * 192 * 3 },
        (_, i) =>
          (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 +
            Math.floor(Math.floor(i / 576) / 20) * 71 +
            (index % count) * 3) %
          255
      )
    )
    const original = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } })
      .withMetadata({ exif: { IFD0: { ImageDescription: nonce } } })
      .png()
      .toBuffer()
    const content =
      index < images.length - 1
        ? original
        : await sharp(original)
            .extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' })
            .withMetadata()
            .png()
            .toBuffer()
    await fs.writeFile(path.join(root, image.path), content)
  }
  return artistId
}
async function sharedVisualFixture(values: number[][]) {
  const artistId = await fixture(values.map((work) => work.map(() => 1)))
  const images = await db!.image.findMany({
    where: { artwork: { creators: { some: { artistId } } } },
    orderBy: { id: 'asc' }
  })
  const contents = new Map<number, Buffer>(),
    nonce = randomUUID()
  for (const value of new Set(values.flat())) {
    let seed = value + 1
    const pixels = Buffer.from(
      Array.from({ length: 64 * 64 * 3 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0
        return seed >>> 24
      })
    )
    contents.set(
      value,
      await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } })
        .withMetadata({ exif: { IFD0: { ImageDescription: nonce } } })
        .png()
        .toBuffer()
    )
  }
  for (const [i, value] of values.flat().entries())
    await fs.writeFile(path.join(root, images[i]!.path), contents.get(value)!)
  return { artistId, images, contents }
}
async function start(
  artistId: number,
  mode: 'INCREMENTAL' | 'FULL' = 'INCREMENTAL',
  includeSuspectedVersions = false,
  definitionVersion?: number
) {
  const value = await db!.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId,
      requestedBy: prefix,
      idempotencyKey: randomUUID(),
      mode,
      includeSuspectedVersions
    })
    const job = await tx.systemJob.create({
      data: {
        id: `${prefix}-${jobs.length}`,
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: definitionVersion ?? (includeSuspectedVersions ? 3 : 1),
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        maxAttempts: 3,
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return { runId: run.id, jobId: job.id }
  })
  runs.push(value.runId)
  jobs.push(value.jobId)
  return value
}
async function claim(id: string) {
  const job = await repository!.claim(prefix, capabilities)
  expect(job?.id).toBe(id)
  return job!
}
async function finish(id: string) {
  await executeArtworkDedup(context(await claim(id)), dependencies())
  const job = await db!.systemJob.findUniqueOrThrow({ where: { id } })
  expect(job.status, `${job.errorCode}: ${job.error}`).toBe('COMPLETED')
}
