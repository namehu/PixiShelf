import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Prisma,
  PrismaClient,
  freezeArtworkDedupRun,
  lockArtworkDedupRelationCache,
  ARTWORK_DEDUP_RELATION_CACHE_VERSION,
  beginMediaContentPathWrite,
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
import { DedupReaderSupervisor, DedupReaderError } from '../reader.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
let queryMeasurement: { queries: number; transactions: number; cacheReads: number; cacheWrites: number } | undefined
db?.$on('query', event => {
  if (!queryMeasurement) return
  queryMeasurement.queries++
  if (event.query === 'BEGIN') queryMeasurement.transactions++
  if (event.query.includes('MediaVisualFingerprint')) {
    if (/^SELECT/i.test(event.query.trim())) queryMeasurement.cacheReads++
    if (/^(INSERT|UPDATE)/i.test(event.query.trim())) queryMeasurement.cacheWrites++
  }
})
const suite = url ? describe.sequential : describe.skip
const prefix = `dedup-executor-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-10-23T00:00:00Z'))
const capabilities = [
  { jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1, 3, 4, 5, 6, 7, 8] }
]
const repository = db
  ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20_000 })
  : null
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
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
})

suite('durable detection executor with real isolated media', () => {
  it('v8 new executor instance resumes a PostgreSQL file checkpoint without recounting committed media', async () => {
    const artistId = await fixture([[32, 32, 32], [32, 32, 32]])
    const started = await start(artistId, 'FULL', false, 8)
    const first = createArtworkDedupExecutor(dependencies({ sliceBytes: 32n }), 8)
    await first.execute(context(await claim(started.jobId)))
    const saved = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: started.runId } })
    const cursor = await db!.artworkDedupItem.findFirstOrThrow({ where: { runId: started.runId, status: 'HASHING', afterImageId: { gt: 0 } } })
    const pending = await db!.systemJob.findUniqueOrThrow({ where: { id: started.jobId } })
    expect(saved.hashedMedia).toBeGreaterThan(0)
    expect(saved.hashedMedia).toBeLessThan(6)
    expect(cursor.afterImageId).toBeGreaterThan(0)
    expect(pending.status).toBe('RETRY_WAIT')
    expect(pending.progressData).toMatchObject({ kind: 'artwork-dedup', phase: 'ORIGINALS', completed: saved.hashedMedia, waitReason: 'SCHEDULER' })
    clock.advance(3000)
    const replacement = createArtworkDedupExecutor(dependencies(), 8)
    await replacement.execute(context(await claim(started.jobId)))
    const completed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: started.runId } })
    expect(completed).toMatchObject({ status: 'COMPLETED', hashedMedia: 6, readBytes: 192n })
    expect(await db!.artworkDedupMedia.count({ where: { runId: started.runId } })).toBe(6)
    expect(completed.performanceSummary).toMatchObject({ complete: true, counters: { readBytes: 192 } })
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: started.jobId } })).progressData).toMatchObject({ phase: 'COMPLETED' })
  }, 30_000)

  it('v7 preserves mixed original members, invalidates old exclusion evidence, and reuses only unchanged full signatures', async () => {
    const artistId = await fixture([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]])
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: [{ artworkId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] })
    const animated = Buffer.from('UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA', 'base64')
    const stills = await Promise.all(Array.from({ length: 4 }, async (_, n) => {
      const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * (41 + n * 7) + Math.floor(Math.floor(i / 576) / 20) * 71) % 255))
      return sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer()
    }))
    for (const [i, image] of images.entries()) {
      const index = i < 5 ? i : i - 5
      const bytes = index === 0 ? (i < 5 ? animated : Buffer.concat([animated, Buffer.from('different animation')])) : index === 5 ? await sharp({ create: { width: 192, height: 192, channels: 3, background: 'white' } }).png().toBuffer()
        : i === 9 ? await sharp(stills[3]!).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).png().toBuffer() : stills[index - 1]!
      await fs.writeFile(path.join(root, image.path), bytes)
      await db!.image.update({ where: { id: image.id }, data: { mediaType: 'IMAGE' } })
    }
    const old = await start(artistId, 'INCREMENTAL', true, 6)
    await finish(old.jobId)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: old.runId, relationKind: 'VISUAL' } })).toBe(0)
    await db!.artworkDedupRun.update({ where: { id: old.runId }, data: { relationCacheVersion: 'original-multiset-v1:partial80-v1:visual-local1-v1' } })
    let previousSignature: string | null = null
    for (const phase of ['mixed', 'hot', 'full', 'declared', 'changed'] as const) {
      if (phase === 'declared') {
        await db!.image.update({ where: { id: images[0]!.id }, data: { mediaType: 'ANIMATION' } })
        await db!.image.update({ where: { id: images[5]!.id }, data: { mediaType: 'VIDEO' } })
      }
      if (phase === 'changed') await fs.writeFile(path.join(root, images[0]!.path), Buffer.concat([animated, Buffer.from('changed original')]))
      const scan = await start(artistId, phase === 'full' ? 'FULL' : 'INCREMENTAL', true, 7)
      await finish(scan.jobId)
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: scan.runId } })
      expect(run).toMatchObject({ status: 'COMPLETED', visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['UNSUPPORTED_MEDIA'], visualCheckpoint: { version: 2 } })
      const pair = await db!.artworkDedupVisualPair.findFirstOrThrow({ where: { runId: scan.runId, relationKind: 'VISUAL' }, include: { pages: { orderBy: { ordinal: 'asc' } } } })
      expect(pair.summary).toMatchObject({ evidenceVersion: 'dct63-grid3-crop-local1-mixed-v2', leftFileCount: '5', rightFileCount: '6', pairedCount: '4', exactCount: '3', similarCount: '1', leftUnmatchedCount: '0', rightUnmatchedCount: '1', leftUncheckedCount: '1', rightUncheckedCount: '1' })
      expect(pair.pages.filter(p => p.kind === 'UNCHECKED')).toMatchObject([
        { leftImageId: images[0]!.id, rightImageId: null, leftIndex: 0 },
        { leftImageId: null, rightImageId: images[5]!.id, rightIndex: 0 }
      ])
      expect(pair.pages.find(p => p.kind === 'SIMILAR')).toMatchObject({ leftIndex: 4, rightIndex: 4 })
      const signature = (await db!.artworkDedupItem.findUniqueOrThrow({ where: { runId_artworkId: { runId: scan.runId, artworkId: images[0]!.artworkId! } } })).visualSignature
      if (phase === 'hot') expect(run).toMatchObject({ readBytes: 0n, visualComparedComparisons: 0 })
      if (phase === 'full' || phase === 'mixed' || phase === 'changed') expect(run.visualComparedComparisons).toBeGreaterThan(0)
      if (phase === 'full' || phase === 'changed') expect(run.readBytes).toBeGreaterThan(0n)
      if (phase === 'changed') expect(signature).not.toBe(previousSignature)
      previousSignature = signature
    }
  }, 90_000)

  it('reuses verified multi-frame exclusions and completed visual pairs without treating incomplete coverage as complete', async () => {
    const artistId = await fixture([[1], [2], [3], [4]])
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71) % 255))
    const still = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer()
    const variant = await sharp(still).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).png().toBuffer()
    const animated = Buffer.from('UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA', 'base64')
    for (const [index, image] of images.entries()) await fs.writeFile(path.join(root, image.path), index === 0 ? still : index === 1 ? variant : animated)
    for (const phase of ['cold', 'hot', 'full'] as const) {
      const run = await start(artistId, phase === 'full' ? 'FULL' : 'INCREMENTAL', true, 6)
      await finish(run.jobId)
      const result = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(result).toMatchObject({ status: 'COMPLETED', visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['UNSUPPORTED_MEDIA'], retryReadBytes: 0n })
      if (phase === 'cold') {
        // A fully published eligible subset is reusable, but budget/error or unfinished evidence is not.
        await db!.$transaction(async tx => {
          const target = { ...result, id: randomUUID() }
          expect(await lockArtworkDedupRelationCache(tx, target, true)).toBe(result.id)
          for (const reasons of [['VISUAL_TIME_BUDGET'], ['UNSUPPORTED_MEDIA', 'VISUAL_CANDIDATE_BUDGET'], ['INCOMPLETE_ORIGINALS']]) {
            await tx.artworkDedupRun.update({ where: { id: result.id }, data: { visualIncompleteReasons: reasons } })
            expect(await lockArtworkDedupRelationCache(tx, target, true)).toBeNull()
          }
          await tx.artworkDedupRun.update({ where: { id: result.id }, data: { visualIncompleteReasons: result.visualIncompleteReasons, visualCheckpoint: { phase: 'PAIR' } } })
          expect(await lockArtworkDedupRelationCache(tx, target, true)).toBeNull()
          await tx.artworkDedupRun.update({ where: { id: result.id }, data: { visualCheckpoint: result.visualCheckpoint as Prisma.InputJsonValue } })
        })
      }
      if (phase === 'hot') {
        expect(result.readBytes).toBe(0n)
        expect(result.visualComparedComparisons).toBe(0)
        expect(result.visualReusedComparisons).toBeGreaterThan(0)
      } else expect(result.readBytes).toBeGreaterThan(0n)
      for (const image of images.slice(2)) {
        expect((await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: image.id } })).views)
          .toEqual({ kind: 'visual-exclusion', version: 1, reason: 'MULTI_FRAME' })
        expect(await db!.artworkDedupMedia.findUniqueOrThrow({ where: { runId_artworkId_imageId: { runId: run.runId, artworkId: image.artworkId!, imageId: image.id } } }))
          .toMatchObject({ visualStatus: 'UNCHECKED', visualViews: null })
      }
    }
    for (const image of images.slice(2)) await fs.writeFile(path.join(root, image.path), still)
    const changed = await start(artistId, 'INCREMENTAL', true, 6)
    await finish(changed.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: changed.runId } })).toMatchObject({ visualStatus: 'COMPLETE' })
    for (const image of images.slice(2)) expect(Array.isArray((await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: image.id } })).views)).toBe(true)
  }, 60000)
  it.each(['pause', 'crash', 'cancel'] as const)('F03 v6 persisted budget waiting closes the reader before %s finalization', async scenario => {
    const artistId = await visualFixture(2)
    const created = await start(artistId, 'FULL', true, 6), claimed = await claim(created.jobId)
    const execution = context(claimed), mutate = execution.mutateInTransaction.bind(execution)
    let injected = false
    execution.mutateInTransaction = async <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) => {
      const result = await mutate<TTransaction, TResult>(operation)
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })
      if (!injected && (run.visualCheckpoint as { phase?: string } | null)?.phase === 'QUERY') {
        injected = true
        await db!.artworkDedupRun.update({ where: { id: created.runId }, data: { visualComparedComparisons: 200000, visualBudgetWaiting: true } })
      }
      return result
    }
    const finalize = execution.finalizeInTransaction.bind(execution)
    execution.finalizeInTransaction = async operation => {
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })
      expect(run).toMatchObject({ readerToken: null, readerState: 'IDLE', visualBudgetWaiting: true })
      if (scenario === 'crash') throw new Error('Fixture crash after reader exit, before queue pause')
      if (scenario === 'cancel') await db!.systemJob.update({ where: { id: created.jobId }, data: { status: 'CANCELLING' } })
      return finalize(operation)
    }
    if (scenario === 'crash') {
      await expect(executeArtworkDedup(execution, dependencies())).rejects.toThrow('Fixture crash')
      clock.advance(120000)
      expect(await repository!.recoverExpiredExecution()).toMatchObject({ jobId: created.jobId, status: 'RETRY_WAIT' })
      await executeArtworkDedup(context(await claim(created.jobId)), dependencies())
    } else await executeArtworkDedup(execution, dependencies())
    const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })
    expect(after).toMatchObject({ status: scenario === 'cancel' ? 'CANCELLED' : 'PAUSED', visualComparisonRound: 1,
      visualRoundStartComparisons: 0, visualComparedComparisons: 200000, visualBudgetWaiting: scenario !== 'cancel', visualStatus: 'PENDING', readerToken: null })
    expect(await repository!.claim(prefix, capabilities)).toBeNull()
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: created.runId, relationKind: 'VISUAL' } })).toBe(0)
    if (scenario !== 'cancel') expect(await db!.systemJobEvent.findFirst({ where: { jobId: created.jobId, type: 'job.paused' } })).toMatchObject({ data: { reason: 'ACTION_REQUIRED' } })
  }, 30_000)

  it('F02 shared content processes 120 of 200 originals cold, zero hot, and all 200 in FULL', async () => {
    const values = [Array.from({ length: 100 }, (_, i) => i), Array.from({ length: 100 }, (_, i) => i < 80 ? i : i + 20)]
    const { artistId, images, contents } = await sharedVisualFixture(values)
    const measurements = [], relations = []
    for (const phase of ['cold', 'hot', 'full', 'modify-one', 'new-copy'] as const) {
      if (phase === 'modify-one') await fs.writeFile(path.join(root, images[99]!.path), await sharp(contents.get(99)!).withMetadata({ exif: { IFD0: { ImageDescription: randomUUID() } } }).png({ compressionLevel: 1 }).toBuffer())
      if (phase === 'new-copy') {
        const other = await fixture([[1, 1]])
        const copied = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId: other } } } } })
        for (const [i, image] of copied.entries()) await fs.writeFile(path.join(root, image.path), contents.get(i)!)
        await db!.artworkArtist.updateMany({ where: { artistId: other }, data: { artistId } })
      }
      const measured = await measureSharedScan(artistId, phase === 'full' ? 'FULL' : 'INCREMENTAL')
      measurements.push({ phase, ...measured.metrics, statMedia: measured.run.statMedia, hashedMedia: measured.run.hashedMedia })
      expect(measured.metrics.visualCalls).toBe(phase === 'cold' ? 120 : phase === 'full' ? 200 : phase === 'modify-one' ? 1 : 0)
      expect(measured.run.hashedMedia).toBe(phase === 'cold' || phase === 'full' ? 200 : phase === 'modify-one' ? 1 : phase === 'new-copy' ? 2 : 0)
      expect(measured.run.statMedia).toBeGreaterThanOrEqual(phase === 'new-copy' ? 202 : 200)
      expect(measured.metrics.contentReads).toBe(measured.run.hashedMedia)
      expect(measured.run.readBytes).toBe(BigInt(measured.metrics.visualBytes) + BigInt(measured.metrics.contentBytes))
      const rows = await db!.artworkDedupMedia.findMany({ where: { runId: measured.run.id } })
      expect(rows.every(row => row.visualStatus === 'READY')).toBe(true)
      const cache = await db!.mediaVisualFingerprint.findMany({ where: { imageId: { in: rows.map(row => row.imageId) } } })
      expect(cache).toHaveLength(rows.length)
      for (const row of rows) expect(cache.find(entry => entry.imageId === row.imageId)).toMatchObject({ contentSha256: row.sha256, contentSize: row.size })
      if (phase === 'cold' || phase === 'hot' || phase === 'full') relations.push(await db!.artworkDedupVisualPair.findMany({ where: { runId: measured.run.id }, select: { summary: true, pages: { select: { kind: true, leftImageId: true, rightImageId: true }, orderBy: { ordinal: 'asc' } } } }))
    }
    expect(relations[0]).toHaveLength(1)
    expect(relations[1]).toEqual(relations[0]); expect(relations[2]).toEqual(relations[0])
    expect(measurements.slice(0, 3).map(m => [m.cacheReads, m.cacheWrites])).toEqual([[8, 4], [4, 0], [0, 4]])
    console.info('F02_SHARED_CONTENT ' + JSON.stringify(measurements))
  }, 120_000)

  it('F02 shared content reuses same-page views and a committed prefix after reader restart', async () => {
    const { artistId, images } = await sharedVisualFixture([[0, 0], [0, 1]])
    const created = await start(artistId, 'INCREMENTAL', true, 4)
    const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    let visualCalls = 0
    supervisor.create = () => {
      const reader = create(), visual = reader.visual.bind(reader)
      reader.visual = async input => { visualCalls++; return visual(input) }
      return reader
    }
    const started = clock.now().getTime()
    await executeArtworkDedup(context(await claim(created.jobId)), dependencies({ supervisor, now: () => started + (visualCalls ? 10_000 : 0) }))
    expect(visualCalls).toBe(1)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })).toMatchObject({ status: 'RETRY_WAIT', visualAfterImageId: images[0]!.id })
    clock.advance(13_001)
    const restarted = await measureSharedScan(artistId, 'INCREMENTAL', created)
    expect(restarted.metrics.visualCalls).toBe(1)
    const target = await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: images[1]!.id } })
    const donor = await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: images[0]!.id } })
    expect(target.views).toEqual(donor.views)
    expect(target.identity).not.toBe(donor.identity)
    expect(target.imageId).not.toBe(donor.imageId)
    await db!.image.delete({ where: { id: images[0]!.id } })
    expect(await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: images[1]!.id } })).toEqual(target)
    expect((await measureSharedScan(artistId)).metrics.visualCalls).toBe(0)
  }, 30_000)

  it.each(['algorithm', 'normalization', 'size', 'invalid', 'legacy', 'deleted'] as const)('F02 shared content treats %s donor as a miss and preserves legacy own hits', async mismatch => {
    const { artistId, images, contents } = await sharedVisualFixture([[0]])
    await measureSharedScan(artistId)
    const donor = images[0]!
    if (mismatch === 'deleted') await db!.image.delete({ where: { id: donor.id } })
    else await db!.mediaVisualFingerprint.update({ where: { imageId: donor.id }, data:
      mismatch === 'algorithm' ? { algorithmVersion: 'old' } : mismatch === 'normalization' ? { normalizationVersion: 'old' } :
      mismatch === 'size' ? { contentSize: 1n } : mismatch === 'invalid' ? { views: [{ broken: true }] } : { contentSha256: null, contentSize: null } })
    if (mismatch !== 'deleted') {
      const own = await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: donor.id } })
      if (mismatch === 'legacy') {
        expect((await measureSharedScan(artistId)).metrics.visualCalls).toBe(0)
        expect(await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: donor.id } })).toEqual(own)
      }
      // Donor remains a cache source but is outside the new run's artist scope.
      await db!.artworkArtistEvidence.updateMany({ where: { membership: { artworkId: donor.artworkId! } }, data: { present: false } })
    }
    const other = await fixture([[1, 1]])
    const copies = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId: other } } } } })
    for (const image of copies) await fs.writeFile(path.join(root, image.path), contents.get(0)!)
    const measured = await measureSharedScan(other)
    expect(measured.metrics.visualCalls).toBe(1)
    expect(measured.run.hashedMedia).toBe(2)
    expect(await db!.mediaVisualFingerprint.count({ where: { imageId: { in: copies.map(image => image.id) } } })).toBe(2)
  }, 30_000)

  it.each(['cancel', 'lease', 'source', 'directory', 'transaction'] as const)('F02 shared content rolls back copied targets after %s changes', async change => {
    const donor = await sharedVisualFixture([[0]])
    await measureSharedScan(donor.artistId)
    const artistId = await fixture([[1, 1]])
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    for (const image of images) await fs.writeFile(path.join(root, image.path), donor.contents.get(0)!)
    const run = await start(artistId, 'INCREMENTAL', true, 4), job = await claim(run.jobId)
    const controller = new AbortController(), execution = context(job, controller)
    const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    let visualCalls = 0, changed = false, rollbackCommit = false
    let sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
    supervisor.create = () => {
      const reader = create(), visual = reader.visual.bind(reader)
      reader.visual = async input => { visualCalls++; return visual(input) }
      return reader
    }
    const mutate = execution.mutateInTransaction.bind(execution)
    queryMeasurement = { queries: 0, transactions: 0, cacheReads: 0, cacheWrites: 0 }
    execution.mutateInTransaction = async <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) => {
      const result = await mutate<TTransaction, TResult>(async tx => { const result = await operation(tx); if (rollbackCommit) throw new Error('Fixture shared commit rollback'); return result })
      // Shared donor JSON has been loaded. The next transaction is still required
      // to authorize each target, even though no target needs a visual read.
      if (!changed && queryMeasurement!.cacheReads >= 2) {
        changed = true
        if (change === 'cancel') {
          await db!.systemJob.update({ where: { id: job.id }, data: { status: 'CANCELLING', cancelRequestedAt: clock.now() } })
          await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { status: 'CANCELLING' } })
          controller.abort(new Error('Fixture shared cancellation'))
        }
        if (change === 'lease') await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
        if (change === 'source') sourceWrite = await db!.$transaction(tx => beginMediaContentSourceWrite(tx, { artworkIds: [images[0]!.artworkId!], imageIds: [images[0]!.id], writeToken: randomUUID(), now: clock.now() }))
        if (change === 'directory') {
          const source = await db!.mediaContentSource.findUniqueOrThrow({ where: { imageId: images[0]!.id } })
          await db!.mediaContentDirectoryState.update({ where: { id: source.directoryStateId! }, data: { generation: { increment: 1 } } })
        }
        if (change === 'transaction') rollbackCommit = true
      }
      return result
    }
    try {
      const pending = executeArtworkDedup(execution, dependencies({ supervisor }))
      if (change === 'lease') await expect(pending).rejects.toThrow()
      else await pending
      expect(changed).toBe(true)
      expect(visualCalls).toBe(0)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ visualAfterImageId: 0, readerToken: null })
      expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, visualStatus: { not: 'PENDING' } } })).toBe(0)
      expect(await db!.mediaVisualFingerprint.count({ where: { imageId: { in: images.map(image => image.id) } } })).toBe(0)
    } finally {
      queryMeasurement = undefined
      if (sourceWrite) await db!.$transaction(tx => finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' }))
      if (change === 'lease') {
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
        await repository!.fail({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt, errorCode: 'INTERNAL_ERROR', error: 'Fixture complete' })
      }
    }
  }, 30_000)

  it('F02 relation byte cache reuses negatives, updates affected pairs and reprojects current order without reviews', async () => {
    const artistId = await fixture([[1, 2, 3, 4, 5], [1, 2, 3, 4, 6], [1, 2, 3, 4, 6], [1, 2, 3, 4, 6, 7], [10, 11, 12, 13, 14]])
    const ids = (await db!.artwork.findMany({ where: { creators: { some: { artistId } } }, orderBy: { id: 'asc' } })).map(a => a.id)
    const measurements: unknown[] = []
    const scan = async (phase: string, mode: 'INCREMENTAL' | 'FULL' = 'INCREMENTAL') => {
      const created = await start(artistId, mode, false, 4)
      await finish(created.jobId)
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })
      measurements.push({ phase, reused: run.originalReusedPairs, compared: run.originalComparedPairs, bytes: String(run.readBytes) })
      expect(run).toMatchObject({ status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION })
      return run
    }
    const cold = await scan('cold')
    expect(cold.originalComparedPairs).toBeGreaterThan(0)
    const reviewed = await db!.artworkDedupVisualPair.findFirstOrThrow({ where: { runId: cold.id, relationKind: 'PARTIAL' } })
    await db!.artworkDedupReviewState.create({ data: { runId: cold.id, userId: prefix, reviews: { create: { groupId: reviewed.id, keeperArtworkId: reviewed.leftArtworkId } } } })
    const hot = await scan('hot')
    expect(hot).toMatchObject({ originalComparedPairs: 0, readBytes: 0n, groupCount: cold.groupCount })
    expect(hot.originalReusedPairs).toBe(cold.originalComparedPairs)
    expect(await db!.artworkDedupReview.count({ where: { runId: hot.id } })).toBe(0)
    expect(await db!.artworkDedupOperation.count({ where: { runId: hot.id } })).toBe(0)
    const changedImage = await db!.image.findFirstOrThrow({ where: { artworkId: ids[0]! }, orderBy: { id: 'desc' } })
    await fs.writeFile(path.join(root, changedImage.path), Buffer.alloc(8, 8))
    const changed = await scan('change-one')
    expect(changed.originalComparedPairs).toBeGreaterThan(0)
    expect(changed.originalReusedPairs).toBeGreaterThan(0)
    const newArtist = await fixture([[10, 11, 12, 13, 15]])
    const newArt = await db!.artwork.findFirstOrThrow({ where: { creators: { some: { artistId: newArtist } } } })
    await db!.artworkArtist.updateMany({ where: { artworkId: newArt.id }, data: { artistId } })
    const added = await scan('new-on-old-negative')
    expect(await db!.artworkDedupVisualPair.findUnique({ where: { runId_leftArtworkId_rightArtworkId: { runId: added.id, leftArtworkId: ids[4]!, rightArtworkId: newArt.id } } })).not.toBeNull()
    expect(added.originalComparedPairs).toBeGreaterThan(0)
    expect(added.originalReusedPairs).toBeGreaterThan(0)
    await db!.artwork.update({ where: { id: ids[0]! }, data: { title: 'Updated title' } })
    const ordered = await db!.image.findMany({ where: { artworkId: ids[0]! }, orderBy: { id: 'asc' } })
    for (const [i, image] of ordered.entries()) await db!.image.update({ where: { id: image.id }, data: { sortOrder: ordered.length - i } })
    const reordered = await scan('title-and-sort')
    expect(reordered.originalComparedPairs).toBe(0)
    const pair = await db!.artworkDedupVisualPair.findFirstOrThrow({ where: { runId: reordered.id, leftArtworkId: ids[0]!, relationKind: 'PARTIAL' }, include: { pages: true } })
    expect(pair.pages.find(p => p.leftImageId === changedImage.id)?.leftIndex).toBe(0)
    await db!.artwork.delete({ where: { id: ids[1]! } })
    const deleted = await scan('delete-representative')
    expect(deleted.originalComparedPairs).toBeGreaterThan(0)
    expect(deleted.originalReusedPairs).toBeGreaterThan(0)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: deleted.id, OR: [{ leftArtworkId: ids[1]! }, { rightArtworkId: ids[1]! }] } })).toBe(0)
    await db!.artworkArtist.updateMany({ where: { artworkId: ids[2]! }, data: { artistId: newArtist } })
    const moved = await scan('artist-changed')
    expect(moved.originalComparedPairs).toBe(0)
    expect(await db!.artworkDedupItem.count({ where: { runId: moved.id, artworkId: ids[2]! } })).toBe(0)
    await db!.artworkDedupRun.updateMany({ where: { artistId }, data: { relationCacheVersion: 'obsolete-algorithm' } })
    const algorithm = await scan('algorithm-version')
    expect(algorithm.originalReusedPairs).toBe(0)
    const full = await scan('full', 'FULL')
    expect(full.originalReusedPairs).toBe(0)
    expect(full.originalComparedPairs).toBe(algorithm.originalComparedPairs)
    expect(full.groupCount).toBe(algorithm.groupCount)
    console.info('F02_RELATION_BYTE ' + JSON.stringify(measurements))
  }, 120_000)

  it.each([4, 5])('F02 relation visual v%i cache measures cold hot modify-one and FULL while preserving current indexes', async (definitionVersion) => {
    const artistId = await fixture([[1], [2], [3]])
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71) % 255))
    const original = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).withMetadata({ exif: { IFD0: { ImageDescription: randomUUID() } } }).png().toBuffer()
    for (const [i, image] of images.entries()) await fs.writeFile(path.join(root, image.path), i === 0 ? original : await sharp(original).extend({ top: i * 10, bottom: i * 10, left: i * 10, right: i * 10, background: 'white' }).withMetadata().png().toBuffer())
    const measurements = [], summaries = []
    for (const phase of ['cold', 'hot', 'modify-one', 'full'] as const) {
      if (phase === 'modify-one') {
        const file = path.join(root, images[0]!.path)
        await fs.writeFile(file, await sharp(await fs.readFile(file)).withMetadata().png({ compressionLevel: 1 }).toBuffer())
      }
      const run = await start(artistId, phase === 'full' ? 'FULL' : 'INCREMENTAL', true, definitionVersion)
      const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
      let visualCalls = 0
      supervisor.create = () => { const reader = create(), visual = reader.visual.bind(reader); reader.visual = async input => { visualCalls++; return visual(input) }; return reader }
      const started = performance.now()
      queryMeasurement = { queries: 0, transactions: 0, cacheReads: 0, cacheWrites: 0 }
      try { await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor })) } finally {
        measurements.push({ phase, elapsedMs: Math.round(performance.now() - started), ...queryMeasurement, visualCalls, reused: 0, compared: 0, bytes: '0' }); queryMeasurement = undefined
      }
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(stored).toMatchObject({ status: 'COMPLETED', visualStatus: 'COMPLETE', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION })
      Object.assign(measurements.at(-1)!, { reused: stored.visualReusedComparisons, compared: stored.visualComparedComparisons, bytes: String(stored.readBytes), events: await db!.systemJobEvent.count({ where: { jobId: run.jobId } }), candidates: stored.visualCandidatePairs.length, postings: await db!.artworkDedupVisualPosting.count({ where: { runId: run.runId } }) })
      summaries.push((await db!.artworkDedupVisualPair.findMany({ where: { runId: run.runId }, orderBy: { leftArtworkId: 'asc' }, select: { summary: true } })).map(p => p.summary))
      if (phase === 'hot') expect(stored).toMatchObject({ visualComparedComparisons: 0, readBytes: 0n })
      if (phase === 'modify-one') { expect(stored.visualComparedComparisons).toBe(2); expect(stored.visualReusedComparisons).toBe(1) }
      if (phase === 'full') expect(stored.visualReusedComparisons).toBe(0)
    }
    expect(summaries[0]).toHaveLength(3)
    expect(summaries[1]).toEqual(summaries[0]); expect(summaries[2]).toEqual(summaries[0]); expect(summaries[3]).toEqual(summaries[0])
    expect(measurements.map(m => m.visualCalls)).toEqual([3, 0, 1, 3])
    console.info('F02_RELATION_VISUAL ' + JSON.stringify(measurements))
  }, 60_000)

  it('F02 relation representative demotion restores a formerly PARTIAL-suppressed visual result', async () => {
    const artistId = await fixture([Array(5).fill(1), Array(5).fill(1), Array(5).fill(2)])
    const ids = (await db!.artwork.findMany({ where: { creators: { some: { artistId } } }, orderBy: { id: 'asc' } })).map(a => a.id)
    const images = await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: [{ artworkId: 'asc' }, { sortOrder: 'asc' }] })
    for (const [index, image] of images.entries()) {
      const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71 + (index % 5) * 3) % 255))
      const original = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer()
      await fs.writeFile(path.join(root, image.path), index === 14 ? await sharp(original).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).png().toBuffer() : original)
    }
    await db!.artworkArtistEvidence.updateMany({ where: { membership: { artworkId: ids[0]! } }, data: { present: false } })
    const cold = await start(artistId, 'INCREMENTAL', true, 4); await finish(cold.jobId)
    expect(await db!.artworkDedupVisualPair.findFirst({ where: { runId: cold.runId, leftArtworkId: ids[1]!, rightArtworkId: ids[2]! } })).toMatchObject({ relationKind: 'PARTIAL' })
    await db!.artworkArtistEvidence.updateMany({ where: { membership: { artworkId: ids[0]! } }, data: { present: true } })
    const changed = await start(artistId, 'INCREMENTAL', true, 4); await finish(changed.jobId)
    expect(await db!.artworkDedupVisualPair.findFirst({ where: { runId: changed.runId, leftArtworkId: ids[1]!, rightArtworkId: ids[2]! } })).toMatchObject({ relationKind: 'VISUAL' })
    expect(await db!.artworkDedupVisualPair.findFirst({ where: { runId: changed.runId, leftArtworkId: ids[0]!, rightArtworkId: ids[2]! } })).toMatchObject({ relationKind: 'PARTIAL' })
    const reorder = images.filter(i => i.artworkId === ids[1]!)
    for (const [i, image] of reorder.entries()) await db!.image.update({ where: { id: image.id }, data: { sortOrder: 10 - i } })
    const hot = await start(artistId, 'INCREMENTAL', true, 4); await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({ visualComparedComparisons: 0, originalComparedPairs: 0 })
    const pair = await db!.artworkDedupVisualPair.findFirstOrThrow({ where: { runId: hot.runId, leftArtworkId: ids[1]!, relationKind: 'VISUAL' }, include: { pages: { orderBy: { ordinal: 'asc' } } } })
    expect(pair.pages[0]).toMatchObject({ leftImageId: reorder.at(-1)!.id, leftIndex: 0 })
  }, 60_000)

  it('F02 relation historical GC waits for the checkpoint lock and completed projections survive source deletion', async () => {
    const artistId = await fixture([[1, 2, 3, 4, 5], [1, 2, 3, 4, 6]])
    const cold = await start(artistId, 'INCREMENTAL', false, 4); await finish(cold.jobId)
    const hot = await start(artistId, 'INCREMENTAL', false, 4); await finish(hot.jobId)
    const current = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })
    await db!.$transaction(async tx => {
      expect(await lockArtworkDedupRelationCache(tx, current)).toBe(cold.runId)
      await expect(db!.$transaction(async deleting => {
        await deleting.$executeRawUnsafe("SET LOCAL lock_timeout = '50ms'")
        await deleting.artworkDedupRun.delete({ where: { id: cold.runId } })
      })).rejects.toThrow()
    })
    await db!.artworkDedupRun.delete({ where: { id: cold.runId } })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: hot.runId } })).toBe(1)
    await db!.artworkDedupRun.delete({ where: { id: hot.runId } })
    const miss = await start(artistId, 'INCREMENTAL', false, 4); await finish(miss.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: miss.runId } })).toMatchObject({ originalReusedPairs: 0, originalComparedPairs: 1 })
  }, 30_000)

  it.each(['cancel', 'lease', 'source', 'directory'] as const)('F02 relation final publication rejects %s after cached evidence was materialized', async change => {
    const artistId = await visualFixture(2)
    const cold = await start(artistId, 'INCREMENTAL', true, 4); await finish(cold.jobId)
    const run = await start(artistId, 'INCREMENTAL', true, 4), job = await claim(run.jobId)
    const controller = new AbortController(), supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    const image = await db!.image.findFirstOrThrow({ where: { artwork: { creators: { some: { artistId } } } } })
    let changed = false, sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
    supervisor.create = () => {
      const reader = create(), close = reader.close.bind(reader)
      reader.close = async (...args) => {
        await close(...args)
        if (changed) return
        changed = true
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ stage: 'DONE', visualComparedComparisons: 0, relationCacheVersion: null })
        if (change === 'cancel') {
          await db!.systemJob.update({ where: { id: job.id }, data: { status: 'CANCELLING', cancelRequestedAt: clock.now() } })
          await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { status: 'CANCELLING' } })
          controller.abort(new Error('Fixture cancellation'))
        }
        if (change === 'lease') await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
        if (change === 'source') sourceWrite = await db!.$transaction(tx => beginMediaContentSourceWrite(tx, { artworkIds: [image.artworkId!], imageIds: [image.id], writeToken: randomUUID(), now: clock.now() }))
        if (change === 'directory') {
          const media = await db!.artworkDedupMedia.findFirstOrThrow({ where: { runId: run.runId, imageId: image.id } })
          await db!.mediaContentDirectoryState.update({ where: { id: media.directoryId }, data: { generation: { increment: 1 } } })
        }
      }
      return reader
    }
    try {
      const execution = executeArtworkDedup(context(job, controller), dependencies({ supervisor }))
      if (change === 'lease') await expect(execution).rejects.toThrow()
      else await execution
      expect(changed).toBe(true)
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(stored.relationCacheVersion).toBeNull()
      if (change === 'cancel') expect(stored.status).toBe('CANCELLED')
      if (change === 'source') { expect(stored.changedArtworks).toBe(1); expect(stored.groupCount).toBe(0) }
      if (change === 'directory') expect(stored).toMatchObject({ status: 'FAILED', groupCount: 0 })
    } finally {
      if (sourceWrite) await db!.$transaction(tx => finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' }))
      if (change === 'lease') {
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
        await repository!.fail({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt, errorCode: 'INTERNAL_ERROR', error: 'Fixture complete' })
      }
    }
  }, 30_000)

  it('F03 v5 QUERY rejects a changed real lease after reading the group without committing it', async () => {
    const artistId = await visualFixture(1)
    const run = await start(artistId, 'INCREMENTAL', true, 5), job = await claim(run.jobId)
    const execution = context(job), mutate = execution.mutateInTransaction.bind(execution)
    let checkpoint: Prisma.JsonValue | undefined, changed = false
    execution.mutateInTransaction = async <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) => {
      const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      const result = await mutate<TTransaction, TResult>(operation)
      if (!changed && (before.visualCheckpoint as { phase?: string } | null)?.phase === 'QUERY') {
        checkpoint = before.visualCheckpoint
        changed = true
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
      }
      return result
    }
    try {
      await expect(executeArtworkDedup(execution, dependencies())).rejects.toThrow()
      expect(changed).toBe(true)
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(stored.visualCheckpoint).toEqual(checkpoint)
      expect([stored.visualComparedComparisons, stored.visualReusedComparisons]).toEqual([0, 0])
      expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: run.runId } })).toBe(0)
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.runId, relationKind: 'VISUAL' } })).toBe(0)
    } finally {
      await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
      await repository!.fail({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt, errorCode: 'INTERNAL_ERROR', error: 'Fixture complete' })
    }
  }, 30_000)

  it.each(['lease-expired', 'directory'] as const)('F03 v5 PUBLISH rejects %s before publishing staged evidence', async change => {
    const artistId = await visualFixture(1)
    const run = await start(artistId, 'INCREMENTAL', true, 5), job = await claim(run.jobId)
    const execution = context(job), mutate = execution.mutateInTransaction.bind(execution)
    let changed = false
    execution.mutateInTransaction = async <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) => {
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      if (!changed && (stored.visualCheckpoint as { phase?: string } | null)?.phase === 'PUBLISH') {
        changed = true
        expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.runId, relationKind: 'VISUAL' } })).toBe(0)
        if (change === 'lease-expired') await db!.systemJob.update({ where: { id: job.id }, data: { leaseExpiresAt: clock.now() } })
        else {
          const row = await db!.artworkDedupMedia.findFirstOrThrow({ where: { runId: run.runId } })
          await db!.mediaContentDirectoryState.update({ where: { id: row.directoryId }, data: { generation: { increment: 1 } } })
        }
      }
      return mutate<TTransaction, TResult>(operation)
    }
    try {
      const pending = executeArtworkDedup(execution, dependencies())
      if (change === 'lease-expired') await expect(pending).rejects.toThrow()
      else await pending
      expect(changed).toBe(true)
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(stored.status).not.toBe('COMPLETED')
      expect(stored.visualStatus).not.toBe('COMPLETE')
      expect(stored.relationCacheVersion).toBeNull()
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: run.runId, relationKind: 'VISUAL' } })).toBe(0)
      if (change === 'directory') expect(stored).toMatchObject({ status: 'FAILED', errorCode: 'ROOT_CHANGED' })
    } finally {
      if (change === 'lease-expired') {
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseExpiresAt: job.leaseExpiresAt } })
        await repository!.fail({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt, errorCode: 'INTERNAL_ERROR', error: 'Fixture complete' })
      }
    }
  }, 30_000)

  it('F01 finds 100/100 shared80 despite rare unmatched pages, preserves containment and hot zero-read evidence', async () => {
    const shared = Array.from({ length: 80 }, (_, i) => i + 1)
    const artistId = await fixture([[...shared, ...Array.from({ length: 20 }, (_, i) => i + 101)].reverse(),
      [...shared, ...Array.from({ length: 20 }, (_, i) => i + 151)], shared, [201, 202]])
    const ids = (await db!.artwork.findMany({ where: { creators: { some: { artistId } } }, orderBy: { id: 'asc' } })).map(a => a.id)
    await db!.image.updateMany({ where: { artworkId: ids[0]! }, data: { mediaType: 'ANIMATION' } })
    await db!.image.updateMany({ where: { artworkId: ids[1]! }, data: { mediaType: 'VIDEO' } })
    const legacy = await start(artistId, 'INCREMENTAL', false, 3)
    await finish(legacy.jobId)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: legacy.runId } })).toBe(0)
    for (let n = 0; n < 2; n++) {
      const scan = await start(artistId, 'INCREMENTAL', false, 4)
      await finish(scan.jobId)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: scan.runId } })).toMatchObject({ readBytes: 0n, hashedMedia: 0, groupCount: 3, visualStatus: 'NOT_REQUESTED' })
      const pair = await db!.artworkDedupVisualPair.findFirstOrThrow({ where: { runId: scan.runId } })
      expect(pair).toMatchObject({ relationKind: 'PARTIAL', leftArtworkId: ids[0], rightArtworkId: ids[1], summary: {
        exactCount: '80', pairedCount: '80', similarCount: '0', leftUnmatchedCount: '20', rightUnmatchedCount: '20', leftUncheckedCount: '0', rightUncheckedCount: '0' } })
      expect(await db!.artworkDedupVisualPage.count({ where: { pairId: pair.id, kind: 'EXACT' } })).toBe(80)
      expect(await db!.artworkDedupVisualPage.count({ where: { pairId: pair.id, kind: 'UNMATCHED' } })).toBe(40)
      expect(await db!.artworkDedupRelation.count({ where: { runId: scan.runId } })).toBe(2)
    }
    const first = await db!.image.findFirstOrThrow({ where: { artworkId: ids[0]! } })
    await fs.unlink(path.join(root, first.path))
    const missing = await start(artistId, 'INCREMENTAL', false, 4)
    await finish(missing.jobId)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: missing.runId } })).toBe(0)
  }, 60_000)
  it('F01 preserves occurrence counts and the integer threshold for short works', async () => {
    for (const [left, right, expected] of [
      [[1, 1, 1, 2, 3], [1, 1, 1, 2, 4], 1],
      [[1, 1, 1, 2, 3], [1, 1, 2, 2, 4], 0],
      [[1, 2, 3, 4], [1, 2, 3, 5], 0],
      [[1], [2], 0], [[1, 2], [2, 1], 0]
    ] as const) {
      const artistId = await fixture([[...left], [...right]])
      const scan = await start(artistId, 'INCREMENTAL', false, 4)
      await finish(scan.jobId)
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: scan.runId } })).toBe(expected)
    }
  }, 60_000)
  it('F01 keeps partial evidence when optional visual input is unsupported', async () => {
    const artistId = await fixture([[1, 2, 3, 4, 5], [1, 2, 3, 4, 6]])
    const scan = await start(artistId, 'INCREMENTAL', true, 4)
    await finish(scan.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: scan.runId } })).toMatchObject({ visualStatus: 'INCOMPLETE', groupCount: 1 })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: scan.runId, relationKind: 'PARTIAL' } })).toBe(1)
  }, 30_000)
  it('persists visual features, reuses hot cache without content reads, and invalidates changed originals', async () => {
    const artistId = await fixture([[1], [2]])
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71) % 255))
    const original = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer()
    const changed = await sharp(original).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).png().toBuffer()
    await fs.writeFile(path.join(root, images[0]!.path), original)
    await fs.writeFile(path.join(root, images[1]!.path), changed)
    const cold = await start(artistId, 'INCREMENTAL', true)
    await finish(cold.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })).toMatchObject({ visualStatus: 'COMPLETE', groupCount: 1 })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: cold.runId } })).toBe(1)
    expect(await db!.mediaVisualFingerprint.count({ where: { imageId: { in: images.map(i => i.id) } } })).toBe(2)
    const hot = await start(artistId, 'INCREMENTAL', true)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({ visualStatus: 'COMPLETE', readBytes: 0n, hashedMedia: 0, groupCount: 1 })
    const full = await start(artistId, 'FULL', true)
    await finish(full.jobId)
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: full.runId } })).readBytes).toBeGreaterThan(0n)
    const previous = await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: images[1]!.id } })
    await fs.writeFile(path.join(root, images[1]!.path), await sharp({ create: { width: 192, height: 192, channels: 3, background: 'white' } }).png().toBuffer())
    const invalidated = await start(artistId, 'INCREMENTAL', true)
    await finish(invalidated.jobId)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: invalidated.runId } })).toBe(0)
    expect((await db!.mediaVisualFingerprint.findUniqueOrThrow({ where: { imageId: images[1]!.id } })).identity).not.toBe(previous.identity)
    await db!.image.update({ where: { id: images[0]!.id }, data: { mediaType: 'ANIMATION' } })
    const mixed = await start(artistId, 'INCREMENTAL', true)
    await finish(mixed.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: mixed.runId } })).toMatchObject({ visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['UNSUPPORTED_MEDIA'] })
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: mixed.jobId } })).toMatchObject({
      status: 'COMPLETED', message: '原件检查完成，疑似版本检查未完成',
      result: { checked: 2, processed: 2, changed: 0, failed: 0, skipped: 0 }
    })
  }, 60_000)
  it('F02 measures actual cold/hot/modify-one/full work across a 50-row page and preserves results', async () => {
    const artistId = await visualFixture(26)
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    const measurements = []
    const results = []
    for (const phase of ['cold', 'hot', 'modify-one', 'full'] as const) {
      if (phase === 'modify-one') {
        const file = path.join(root, images.at(-1)!.path)
        await fs.writeFile(file, await sharp(await fs.readFile(file)).withMetadata().png({ compressionLevel: 1 }).toBuffer())
      }
      const cacheBefore = new Map((await db!.mediaVisualFingerprint.findMany({ where: { imageId: { in: images.map(image => image.id) } } })).map(cache => [cache.imageId, cache.updatedAt.getTime()]))
      const run = await start(artistId, phase === 'full' ? 'FULL' : 'INCREMENTAL', true)
      const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
      let visualCalls = 0, visualBytes = 0n
      supervisor.create = () => {
        const reader = create(), visual = reader.visual.bind(reader)
        reader.visual = async input => { visualCalls++; const result = await visual(input); visualBytes += result.bytesRead; return result }
        return reader
      }
      const job = await claim(run.jobId)
      queryMeasurement = { queries: 0, transactions: 0, cacheReads: 0, cacheWrites: 0 }
      let metrics: Parameters<NonNullable<ArtworkDedupDependencies['onMeasurement']>>[0] | undefined
      const measurementStarted = performance.now()
      try {
        await executeArtworkDedup(context(job), dependencies({ supervisor, sliceMs: 120_000, onMeasurement: value => { metrics = value } }))
      } finally {
        measurements.push({ phase, elapsedMs: Math.round(performance.now() - measurementStarted), ...queryMeasurement, cacheWriteRows: 0, visualCalls, visualBytes: String(visualBytes),
          readerBytes: String(metrics?.bytesRead), readerCalls: metrics?.reads, pipelineTransactions: metrics?.transactions })
        queryMeasurement = undefined
      }
      const cacheAfter = await db!.mediaVisualFingerprint.findMany({ where: { imageId: { in: images.map(image => image.id) } } })
      measurements.at(-1)!.cacheWriteRows = cacheAfter.filter(cache => cacheBefore.get(cache.imageId) !== cache.updatedAt.getTime()).length
      const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(stored).toMatchObject({ status: 'COMPLETED', visualStatus: 'COMPLETE', visualAfterImageId: images.at(-1)!.id })
      expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, visualStatus: 'READY' } })).toBe(52)
      const pairs = await db!.artworkDedupVisualPair.findMany({ where: { runId: run.runId }, select: { summary: true, pages: { select: { kind: true, leftImageId: true, rightImageId: true }, orderBy: { ordinal: 'asc' } } } })
      results.push(pairs)
      expect(visualCalls).toBe(phase === 'hot' ? 0 : phase === 'modify-one' ? 1 : phase === 'full' ? 52 : 27)
      if (phase === 'hot') expect(stored.readBytes).toBe(0n)
    }
    console.info('F02_MEASUREMENT ' + JSON.stringify(measurements))
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    expect(results[2]).toEqual(results[3])
    expect(results[0]).toHaveLength(1)
    expect(measurements.map(m => [m.cacheReads, m.cacheWrites, m.cacheWriteRows])).toEqual([[4, 2, 52], [2, 0, 0], [3, 1, 1], [0, 2, 52]])
  }, 120_000)

  it('F02 commits only a short completed prefix on yield and resumes without decoding that prefix', async () => {
    const artistId = await visualFixture(3)
    const run = await start(artistId, 'INCREMENTAL', true)
    const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    let visualCalls = 0
    supervisor.create = () => {
      const reader = create(), visual = reader.visual.bind(reader)
      reader.visual = async input => { const result = await visual(input); visualCalls++; return result }
      return reader
    }
    const started = clock.now().getTime()
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor, now: () => started + (visualCalls >= 2 ? 10_000 : 0) }))
    const rows = await db!.artworkDedupMedia.findMany({ where: { runId: run.runId }, orderBy: { imageId: 'asc' } })
    expect(rows.map(row => row.visualStatus)).toEqual(['READY', 'READY', 'PENDING', 'PENDING', 'PENDING', 'PENDING'])
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'RETRY_WAIT', visualAfterImageId: rows[1]!.imageId })
    clock.advance(13_001)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor }))
    expect(visualCalls).toBe(4)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'COMPLETED', visualStatus: 'COMPLETE' })
  }, 30_000)

  it('F02 revalidates every prefetched hot identity before publishing without a decode', async () => {
    const artistId = await visualFixture(2)
    await finish((await start(artistId, 'INCREMENTAL', true)).jobId)
    const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    const before = await db!.mediaVisualFingerprint.findMany({ where: { imageId: { in: images.map(image => image.id) } }, orderBy: { imageId: 'asc' } })
    const run = await start(artistId, 'INCREMENTAL', true), execution = context(await claim(run.jobId))
    const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    let visualCalls = 0, changed = false
    supervisor.create = () => {
      const reader = create(), visual = reader.visual.bind(reader)
      reader.visual = async input => { visualCalls++; return visual(input) }
      return reader
    }
    const mutate = execution.mutateInTransaction.bind(execution)
    queryMeasurement = { queries: 0, transactions: 0, cacheReads: 0, cacheWrites: 0 }
    execution.mutateInTransaction = async <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) => {
      const result = await mutate<TTransaction, TResult>(operation)
      // The cache query has completed and released its transaction; mutate the last
      // identity before the next commit, with no mock of the PostgreSQL guards.
      if (queryMeasurement!.cacheReads && !changed) {
        changed = true
        await db!.image.update({ where: { id: images.at(-1)!.id }, data: { mediaType: 'ANIMATION' } })
      }
      return result
    }
    try {
      await executeArtworkDedup(execution, dependencies({ supervisor }))
      expect(changed).toBe(true)
      expect(visualCalls).toBe(0)
      expect(queryMeasurement.cacheWrites).toBe(0)
    } finally { queryMeasurement = undefined }
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'FAILED', errorCode: 'FILE_CHANGED', visualAfterImageId: 0, readerToken: null })
    expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, visualStatus: { not: 'PENDING' } } })).toBe(0)
    expect(await db!.mediaVisualFingerprint.findMany({ where: { imageId: { in: images.map(image => image.id) } }, orderBy: { imageId: 'asc' } })).toEqual(before)
  }, 30_000)

  it.each(['cancel', 'lease', 'source', 'directory', 'transaction'] as const)('F02 rejects an uncommitted prefix after %s changes', async change => {
    const artistId = await visualFixture(2)
    const run = await start(artistId, 'INCREMENTAL', true)
    const job = await claim(run.jobId), controller = new AbortController(), execution = context(job, controller)
    const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
    let calls = 0, rollbackCommit = false
    let sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
    const image = await db!.image.findFirstOrThrow({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
    supervisor.create = () => {
      const reader = create(), visual = reader.visual.bind(reader)
      reader.visual = async input => {
        const result = await visual(input)
        if (++calls === 2) {
          if (change === 'cancel') {
            await db!.systemJob.update({ where: { id: job.id }, data: { status: 'CANCELLING', cancelRequestedAt: clock.now() } })
            await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { status: 'CANCELLING' } })
            controller.abort(new Error('Fixture cancellation'))
          }
          if (change === 'lease') await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
          if (change === 'source') sourceWrite = await db!.$transaction(tx => beginMediaContentSourceWrite(tx, { artworkIds: [image.artworkId!], imageIds: [image.id], writeToken: randomUUID(), now: clock.now() }))
          if (change === 'directory') {
            const source = await db!.mediaContentSource.findUniqueOrThrow({ where: { imageId: image.id } })
            await db!.mediaContentDirectoryState.update({ where: { id: source.directoryStateId! }, data: { generation: { increment: 1 } } })
          }
          if (change === 'transaction') rollbackCommit = true
        }
        return result
      }
      return reader
    }
    const mutate = execution.mutateInTransaction.bind(execution)
    execution.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(operation: (tx: TTransaction) => Promise<TResult>) =>
      mutate<TTransaction, TResult>(async tx => { const result = await operation(tx); if (rollbackCommit) throw new Error('Fixture rollback'); return result })
    try {
      const pending = executeArtworkDedup(execution, dependencies({ supervisor }))
      if (change === 'lease') await expect(pending).rejects.toThrow()
      else await pending
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ visualAfterImageId: 0, readerToken: null })
      if (change === 'cancel') expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe('CANCELLED')
      if (change === 'source' || change === 'directory') expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'FAILED', errorCode: change === 'source' ? 'FILE_CHANGED' : 'ROOT_CHANGED' })
      expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, visualStatus: { not: 'PENDING' } } })).toBe(0)
      expect(await db!.mediaVisualFingerprint.count({ where: { image: { artwork: { creators: { some: { artistId } } } } } })).toBe(0)
    } finally {
      if (sourceWrite) await db!.$transaction(tx => finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' }))
      if (change === 'lease') {
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
        await repository!.fail({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt, errorCode: 'INTERNAL_ERROR', error: 'Fixture complete' })
      }
    }
  }, 30_000)
  it('keeps exact results after a visual deadline and confirms roots with a new reader before completion', async () => {
    const artistId = await fixture([[4], [4]])
    const run = await start(artistId, 'INCREMENTAL', true)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const create = supervisor.create.bind(supervisor)
    supervisor.create = () => {
      const reader = create()
      reader.visual = async () => { const error = new DedupReaderError('VISUAL_TIMEOUT'); await reader.close(error); throw error }
      return reader
    }
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'RETRY_WAIT', visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['VISUAL_TIME_BUDGET'], readerState: 'IDLE', readerToken: null })
    expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(1)
    clock.advance(3001)
    await finish(run.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: 'COMPLETED', groupCount: 1, visualStatus: 'INCOMPLETE' })
  }, 30_000)
  it('finds 80/100 containment despite order and names, excludes partial overlap and preserves multiplicity', async () => {
    const eighty = Array.from({ length: 80 }, (_, i) => i + 1)
    const hundred = [...eighty, ...Array.from({ length: 20 }, (_, i) => i + 101)]
    const otherHundred = [...eighty, ...Array.from({ length: 20 }, (_, i) => i + 151)]
    const artistId = await fixture([[...eighty].reverse(), hundred, otherHundred, [1, 1, 2]])
    const ids = (await db!.artwork.findMany({ where: { creators: { some: { artistId } } }, orderBy: { id: 'asc' } })).map((a) => a.id)
    const run = await start(artistId)
    await finish(run.jobId)
    const relations = await db!.artworkDedupRelation.findMany({ where: { runId: run.runId }, orderBy: { containerArtworkId: 'asc' } })
    expect(relations.map((r) => [r.containedArtworkId, r.containerArtworkId, r.containedFileCount, r.containerFileCount]))
      .toEqual([[ids[0], ids[1], 80n, 100n], [ids[0], ids[2], 80n, 100n]])
    expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
    const hot = await start(artistId)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({ hashedMedia: 0, cacheHitMedia: 283, statMedia: 283 })
    const first = await db!.image.findFirstOrThrow({ where: { artworkId: ids[0]! }, orderBy: { id: 'asc' } })
    await fs.writeFile(path.join(root, first.path), Buffer.alloc(80, 250))
    const changed = await start(artistId)
    await finish(changed.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: changed.runId } })).toMatchObject({ hashedMedia: 1, groupCount: 0 })
    expect(await db!.artworkDedupRelation.count({ where: { runId: changed.runId } })).toBe(0)
  }, 60_000)
  it('hashes every complete inventory for inclusion and reuses hot hashes with one stat pass', async () => {
    const artistId = await fixture([
      [11, 12, 11],
      [12, 11, 11],
      [11, 12],
      [31, 11, 11]
    ])
    const cold = await start(artistId)
    await finish(cold.jobId)
    const first = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })
    expect(first).toMatchObject({
      status: 'COMPLETED',
      stage: 'DONE',
      groupCount: 2,
      duplicateArtworks: 2,
      hashedMedia: 11,
      cacheHitMedia: 0,
      readBytes: 144n,
      readerState: 'IDLE',
      readerToken: null
    })
    expect(await db!.artworkDedupGroupMember.count({ where: { runId: cold.runId } })).toBe(2)
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: cold.jobId } })).toMatchObject({
      status: 'COMPLETED', message: '检测完成',
      result: { checked: 4, processed: 4, changed: 0, failed: 0, skipped: 0 }
    })
    const hot = await start(artistId)
    await finish(hot.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      hashedMedia: 0,
      cacheHitMedia: 11,
      readBytes: 0n,
      groupCount: 2,
      statMedia: 11
    })
    const full = await start(artistId, 'FULL')
    await finish(full.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: full.runId } })).toMatchObject({
      hashedMedia: 11,
      cacheHitMedia: 0,
      readBytes: 144n,
      groupCount: 2
    })
  }, 30_000)
  it('persists file cursors at the byte budget, releases the lane for three seconds and preserves attempt', async () => {
    const artistId = await fixture([
      [32, 32, 32],
      [32, 32, 32]
    ])
    const run = await start(artistId)
    const first = await claim(run.jobId)
    await executeArtworkDedup(context(first), dependencies({ sliceBytes: 32n }))
    const job = await db!.systemJob.findUniqueOrThrow({ where: { id: run.jobId } })
    expect(job).toMatchObject({
      status: 'RETRY_WAIT',
      attempt: 0,
      queuePriority: 900,
      effectivePriority: 900,
      availableAt: new Date(clock.now().getTime() + 3000)
    })
    const checkpoint = await db!.artworkDedupItem.findFirstOrThrow({
      where: { runId: run.runId, status: 'HASHING', afterImageId: { gt: 0 } }
    })
    expect(checkpoint.afterImageId).toBeGreaterThan(0)
    expect(await repository!.claim(prefix, capabilities)).toBeNull()
    clock.advance(3000)
    const second = await claim(run.jobId)
    await executeArtworkDedup(context(second), dependencies())
    const completed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      hashedMedia: 6,
      cacheHitMedia: 0,
      readBytes: 192n,
      groupCount: 1
    })
    expect(await db!.systemJobEvent.count({ where: { jobId: run.jobId } })).toBeLessThan(15)
  }, 20_000)
  it('pause/resume retains the same run and cursor; cancellation preserves committed file caches', async () => {
    const artistId = await fixture([
      [16, 16],
      [16, 16]
    ])
    const run = await start(artistId)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ sliceBytes: 16n }))
    const cached = await db!.mediaContentFingerprint.count({ where: { image: { artworkId: { in: artworks } } } })
    clock.advance(3000)
    const pausedClaim = await claim(run.jobId)
    await db!.systemJob.update({ where: { id: run.jobId }, data: { status: 'PAUSING', pauseRequestedAt: clock.now() } })
    const pauseController = new AbortController()
    pauseController.abort(new Error('Pause requested'))
    await executeArtworkDedup(context(pausedClaim, pauseController), dependencies())
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe('PAUSED')
    await db!.systemJob.update({
      where: { id: run.jobId },
      data: { status: 'PENDING', pauseRequestedAt: null, availableAt: clock.now() }
    })
    const resumed = await claim(run.jobId)
    await db!.systemJob.update({
      where: { id: run.jobId },
      data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
    })
    const cancelController = new AbortController()
    cancelController.abort(new Error('Cancel requested'))
    await executeArtworkDedup(context(resumed, cancelController), dependencies())
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe('CANCELLED')
    expect(await db!.mediaContentFingerprint.count({ where: { image: { artworkId: { in: artworks } } } })).toBe(cached)
    expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
  }, 20_000)
  it('missing originals stay incomplete and a root outage fails the whole run', async () => {
    const artistId = await fixture([[7], [7], [9]])
    const missing = await db!.image.findFirstOrThrow({
      where: { artwork: { creators: { some: { artistId } } } },
      orderBy: { id: 'asc' }
    })
    await fs.unlink(path.join(root, missing.path))
    const run = await start(artistId)
    await finish(run.jobId)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 0,
      failedArtworks: 1
    })
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: run.jobId } })).toMatchObject({
      status: 'COMPLETED', message: '检查结束，2 部完成，1 部未完成检查',
      result: { checked: 2, processed: 3, changed: 0, failed: 1, skipped: 0 }
    })
    const outage = await start(artistId)
    await executeArtworkDedup(
      context(await claim(outage.jobId)),
      dependencies({ sourceRoot: path.join(root, 'absent-root') })
    )
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: outage.runId } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'ROOT_CHANGED',
      groupCount: 0
    })
  }, 20_000)
  it('resumes a 501-media artwork after the durable stat cursor without restatting its first page', async () => {
    const artistId = await fixture([Array(501).fill(2)])
    const run = await start(artistId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    let inspected = 0
    supervisor.create = () => {
      const reader = original(),
        inspect = reader.inspect.bind(reader)
      reader.inspect = async (input) => {
        const value = await inspect(input)
        inspected++
        return value
      }
      return reader
    }
    const startTime = clock.now().getTime()
    await executeArtworkDedup(
      context(await claim(run.jobId)),
      dependencies({ supervisor, now: () => startTime + (inspected >= 104 ? 10000 : 0) })
    )
    expect(inspected).toBe(104)
    const checkpoint = await db!.artworkDedupItem.findFirstOrThrow({ where: { runId: run.runId } })
    expect(checkpoint).toMatchObject({ status: 'STATTING', memberCount: 501n })
    expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId } })).toBe(104)
    clock.advance(13000)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ supervisor }))
    expect(inspected).toBe(501)
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'COMPLETED',
      statMedia: 501,
      hashedMedia: 501
    })
  }, 30_000)
  it('keeps 501-media HASH batches complete across a 100-file checkpoint and a hot run', async () => {
    const artistId = await fixture([Array(501).fill(2), Array(501).fill(2)])
    const cold = await start(artistId)
    let reads = 0,
      inspections = 0
    const measured = (measurement: { reads: number; inspections: number }) => {
      reads += measurement.reads
      inspections += measurement.inspections
    }
    await executeArtworkDedup(
      context(await claim(cold.jobId)),
      dependencies({ sliceBytes: 200n, onMeasurement: measured })
    )
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })).toMatchObject({
      status: 'RETRY_WAIT',
      stage: 'HASH',
      hashedMedia: 100
    })
    const partial = await db!.artworkDedupItem.findFirstOrThrow({
      where: { runId: cold.runId, afterImageId: { gt: 0 } }
    })
    const ordered = await db!.image.findMany({
      where: { artworkId: partial.artworkId },
      orderBy: { id: 'asc' },
      select: { id: true }
    })
    expect(partial.afterImageId).toBe(ordered[99]!.id)
    clock.advance(3000)
    await executeArtworkDedup(context(await claim(cold.jobId)), dependencies({ onMeasurement: measured }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: cold.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 1,
      hashedMedia: 1002,
      cacheHitMedia: 0,
      readBytes: 2004n
    })
    expect({ reads, inspections }).toEqual({ reads: 1002, inspections: 1002 })
    const hot = await start(artistId)
    reads = 0
    inspections = 0
    await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ onMeasurement: measured }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
      status: 'COMPLETED',
      groupCount: 1,
      hashedMedia: 0,
      cacheHitMedia: 1002,
      readBytes: 0n
    })
    expect({ reads, inspections }).toEqual({ reads: 0, inspections: 1002 })
  }, 60_000)

  it.each(['insert', 'delete', 'source write', 'directory write'] as const)(
    'rejects a hot cache batch when %s starts after file inspection',
    async (change) => {
      const artistId = await fixture([
        [2, 2, 2],
        [2, 2, 2]
      ])
      const cold = await start(artistId)
      await finish(cold.jobId)
      const images = await db!.image.findMany({
        where: { artwork: { creators: { some: { artistId } } } },
        orderBy: { id: 'asc' }
      })
      const changedArtworkId = images[0]!.artworkId!
      const hot = await start(artistId)
      const supervisor = new DedupReaderSupervisor(readerOptions)
      const create = supervisor.create.bind(supervisor)
      let inspections = 0
      let sourceWrite: Awaited<ReturnType<typeof beginMediaContentSourceWrite>> | undefined
      let pathWriteId: string | undefined
      supervisor.create = () => {
        const reader = create(),
          inspect = reader.inspect.bind(reader)
        reader.inspect = async (input) => {
          const result = await inspect(input)
          // Mutate after the first hot STAT observation; publication must still reject it.
          if (++inspections === 1) {
            if (change === 'insert')
              await db!.image.create({ data: { artworkId: changedArtworkId, path: `${changedArtworkId}/new.bin` } })
            if (change === 'delete') await db!.image.delete({ where: { id: images[2]!.id } })
            if (change === 'source write')
              sourceWrite = await db!.$transaction((tx) =>
                beginMediaContentSourceWrite(tx, {
                  artworkIds: [],
                  imageIds: [images[0]!.id],
                  writeToken: randomUUID(),
                  now: clock.now()
                })
              )
            if (change === 'directory write') {
              const source = await db!.mediaContentSource.findUniqueOrThrow({
                where: { imageId: images[0]!.id },
                include: { directory: true }
              })
              const directory = source.directory!
              const held = await db!.$transaction((tx) =>
                beginMediaContentPathWrite(tx, {
                  directory: {
                    logicalRoot: 'source-media:v1',
                    rootIdentity: directory.rootIdentity,
                    relativeDirectory: directory.relativeDirectory
                  },
                  scope: { kind: 'DIRECTORY' },
                  owner: { ownerUserId: null, sessionId: randomUUID(), sessionVersion: 1n, execution: null },
                  writeToken: randomUUID(),
                  upload: null,
                  parent: null,
                  now: clock.now()
                })
              )
              expect(held.status).toBe('READY')
              if (held.status !== 'READY') throw new Error(held.status)
              pathWriteId = held.value.writeId
            }
          }
          return result
        }
        return reader
      }
      try {
        await executeArtworkDedup(context(await claim(hot.jobId)), dependencies({ supervisor }))
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.runId } })).toMatchObject({
          status: 'COMPLETED',
          changedArtworks: 1,
          groupCount: 0,
          hashedMedia: 0,
          cacheHitMedia: 3
        })
        expect(
          await db!.artworkDedupItem.findUniqueOrThrow({
            where: { runId_artworkId: { runId: hot.runId, artworkId: changedArtworkId } }
          })
        ).toMatchObject({ status: 'CHANGED', afterImageId: 0 })
        expect(
          await db!.artworkDedupMedia.count({
            where: { runId: hot.runId, artworkId: changedArtworkId, sha256: { not: null } }
          })
        ).toBe(0)
      } finally {
        if (sourceWrite)
          await db!.$transaction((tx) =>
            finishMediaContentSourceWrite(tx, { token: sourceWrite!, outcome: 'verified-rollback' })
          )
        if (pathWriteId) await db!.mediaContentPathWrite.delete({ where: { id: pathWriteId } })
      }
    },
    20_000
  )
  it('fails a resumed sparse run when its configured root changed before any candidate hashing', async () => {
    const artistId = await fixture([[2, 2, 2, 2, 2]])
    const run = await start(artistId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    let inspected = 0
    supervisor.create = () => {
      const reader = original(),
        inspect = reader.inspect.bind(reader)
      reader.inspect = async (input) => {
        const value = await inspect(input)
        inspected++
        return value
      }
      return reader
    }
    const startTime = clock.now().getTime()
    await executeArtworkDedup(
      context(await claim(run.jobId)),
      dependencies({ supervisor, now: () => startTime + (inspected >= 4 ? 10000 : 0) })
    )
    const moved = root + '-moved'
    await fs.rename(root, moved)
    await fs.mkdir(root)
    try {
      clock.advance(13000)
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies())
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'FAILED',
        errorCode: 'ROOT_CHANGED',
        hashedMedia: 0,
        groupCount: 0
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rename(moved, root)
    }
  }, 15_000)
  describe('archive root mapping', () => {
    it.each([
      { boundary: 'STAT', from: 'nested', to: 'nested' },
      { boundary: 'HASH', from: 'nested', to: 'nested' },
      { boundary: 'retry', from: 'nested', to: 'nested' },
      { boundary: 'STAT', from: 'nested', to: 'separate' },
      { boundary: 'STAT', from: 'separate', to: 'nested' }
    ] as const)(
      'rejects $from to $to changes at $boundary before reading old paths',
      async ({ boundary, from, to }) => {
        const media = await archiveFixture(from, to)
        const run = await start(media.artistId)
        await mappingCheckpoint(run.jobId, media.before, boundary === 'HASH' ? 'HASH' : 'STAT')
        const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        expect(before).toMatchObject({ status: 'RETRY_WAIT', stage: boundary === 'HASH' ? 'HASH' : 'STAT' })
        const savedMedia = await db!.artworkDedupMedia.findMany({
          where: { runId: run.runId },
          orderBy: { imageId: 'asc' }
        })
        expect(savedMedia).toHaveLength(2)
        expect(savedMedia.every((m) => m.canonicalPath.startsWith(media.beforePrefix))).toBe(true)
        expect(before.hashedMedia).toBe(boundary === 'HASH' ? 1 : 0)
        let nextJob = run.jobId
        if (boundary === 'retry') nextJob = await retryMappingRun(run)
        clock.advance(13000)
        let reads = -1,
          inspections = -1
        await executeArtworkDedup(
          context(await claim(nextJob)),
          dependencies({
            archiveRoot: media.after,
            onMeasurement: (measurement) => {
              reads = measurement.reads
              inspections = measurement.inspections
            }
          })
        )
        const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        expect(after).toMatchObject({
          status: 'FAILED',
          errorCode: 'ROOT_CHANGED',
          groupCount: 0,
          rootBindings: before.rootBindings
        })
        expect(after.executionVersion).toBe(boundary === 'retry' ? 2 : 1)
        expect(reads).toBe(0)
        expect(inspections).toBe(0)
        expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
        expect(
          await db!.artworkDedupMedia.findMany({ where: { runId: run.runId }, orderBy: { imageId: 'asc' } })
        ).toEqual(boundary === 'retry' ? [] : savedMedia)
      },
      20_000
    )

    it('rechecks the prefix at the end of a slice before publishing groups', async () => {
      const media = await archiveFixture('nested', 'nested')
      const run = await start(media.artistId)
      const supervisor = new DedupReaderSupervisor(readerOptions)
      const create = supervisor.create.bind(supervisor)
      const configured = dependencies({ archiveRoot: media.before, supervisor })
      supervisor.create = () => {
        const reader = create(),
          read = reader.read.bind(reader)
        reader.read = async (input) => {
          const result = await read(input)
          configured.archiveRoot = media.after
          return result
        }
        return reader
      }
      await executeArtworkDedup(context(await claim(run.jobId)), configured)
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'FAILED',
        errorCode: 'ROOT_CHANGED',
        groupCount: 0,
        rootBindings: { version: 1, archiveRelativePrefix: media.beforePrefix }
      })
      expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
    }, 15_000)

    it('continues unchanged nested prefixes through STAT and HASH checkpoints', async () => {
      const media = await archiveFixture('nested', 'nested')
      const run = await start(media.artistId)
      await mappingCheckpoint(run.jobId, media.before, 'STAT')
      const saved = (await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).rootBindings
      expect(saved).toMatchObject({ version: 1, archiveRelativePrefix: media.beforePrefix })
      clock.advance(13000)
      await mappingCheckpoint(run.jobId, media.before, 'HASH')
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'RETRY_WAIT',
        stage: 'HASH',
        hashedMedia: 1,
        rootBindings: saved
      })
      clock.advance(3000)
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ archiveRoot: media.before }))
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'COMPLETED',
        groupCount: 1,
        hashedMedia: 2,
        rootBindings: saved
      })
    }, 20_000)

    it.each(['legacy nested', 'legacy empty', 'missing prefix', 'null with progress'] as const)(
      'refuses %s bindings without silently authorizing the current mapping',
      async (kind) => {
        const media = await archiveFixture(kind === 'legacy empty' ? 'same' : 'nested', 'nested')
        const run = await start(media.artistId)
        await mappingCheckpoint(run.jobId, media.before, 'STAT')
        const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
        const bindings = before.rootBindings as Prisma.JsonObject
        const legacy =
          kind === 'null with progress'
            ? null
            : {
                source: bindings.source!,
                archive: bindings.archive!,
                ...(kind === 'missing prefix' ? { version: 1 } : {})
              }
        await db!.artworkDedupRun.update({ where: { id: run.runId }, data: { rootBindings: legacy ?? Prisma.DbNull } })
        clock.advance(13000)
        await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ archiveRoot: media.before }))
        expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
          status: 'FAILED',
          errorCode: 'ROOT_CHANGED',
          groupCount: 0,
          hashedMedia: 0,
          rootBindings: legacy
        })
        expect(await db!.artworkDedupGroup.count({ where: { runId: run.runId } })).toBe(0)
      },
      20_000
    )
  })
  it('rolls back a cache batch when its PostgreSQL connection dies and never publishes an old result', async () => {
    const artistId = await fixture([[13], [13]])
    const run = await start(artistId)
    const job = await claim(run.jobId)
    const execution = context(job)
    const mutate = execution.mutateInTransaction
    let killNextCommit = false
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    supervisor.create = () => {
      const reader = original(),
        read = reader.read.bind(reader)
      reader.read = async (input) => {
        const value = await read(input)
        killNextCommit = true
        return value
      }
      return reader
    }
    execution.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
      operation: (tx: TTransaction) => Promise<TResult>
    ) =>
      mutate<TTransaction, TResult>(async (tx) => {
        const value = await operation(tx)
        if (killNextCommit) {
          killNextCommit = false
          await tx.$queryRawUnsafe('SELECT pg_terminate_backend(pg_backend_pid())')
        }
        return value
      })
    await executeArtworkDedup(execution, dependencies({ supervisor }))
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      status: 'FAILED',
      readerToken: null,
      groupCount: 0,
      hashedMedia: 0
    })
    expect(await db!.artworkDedupMedia.count({ where: { runId: run.runId, sha256: { not: null } } })).toBe(0)
  }, 20_000)
  it('recovers the same checkpoint after a real Worker SIGKILL leaves a durable reader latch', async () => {
    const artistId = await fixture([
      [17, 17],
      [17, 17]
    ])
    const run = await start(artistId)
    await executeArtworkDedup(context(await claim(run.jobId)), dependencies({ sliceBytes: 17n }))
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).hashedMedia).toBe(1)
    clock.advance(3000)
    const child = spawn(
      process.execPath,
      [...readerOptions.execArgv, new URL('./crash-executor-fixture.ts', import.meta.url).pathname],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'advanced',
        env: {
          ...process.env,
          QUEUE_KERNEL_TEST_DATABASE_URL: url!,
          DEDUP_TEST_CLOCK: clock.now().toISOString(),
          DEDUP_TEST_ROOT: root,
          DEDUP_TEST_JOB_ID: run.jobId
        }
      }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-3000)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Crash fixture did not reach its file boundary: ' + stderr)),
          10000
        )
        child.once('message', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.once('error', reject)
        child.once('exit', () => {
          clearTimeout(timeout)
          reject(new Error('Crash fixture exited early: ' + stderr))
        })
      })
      const crashed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })
      expect(crashed.readerToken).not.toBeNull()
      expect(crashed.readerOwner).not.toBeNull()
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      child.kill('SIGKILL')
      await closed
      clock.advance(61000)
      await repository!.recoverExpiredExecution()
      await executeArtworkDedup(context(await claim(run.jobId)), dependencies())
      expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
        status: 'COMPLETED',
        hashedMedia: 4,
        readBytes: 68n,
        readerToken: null,
        groupCount: 1
      })
    } finally {
      child.kill('SIGKILL')
    }
  }, 20_000)
  it('rejects a stale execution after reading and clears only its proven closed reader token', async () => {
    const artistId = await fixture([[8], [8]])
    const run = await start(artistId)
    const job = await claim(run.jobId)
    const supervisor = new DedupReaderSupervisor(readerOptions)
    const original = supervisor.create.bind(supervisor)
    supervisor.create = () => {
      const reader = original(),
        read = reader.read.bind(reader)
      reader.read = async (input) => {
        const value = await read(input)
        await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
        return value
      }
      return reader
    }
    await expect(executeArtworkDedup(context(job), dependencies({ supervisor }))).rejects.toThrow()
    expect(await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({
      readerToken: null,
      groupCount: 0,
      hashedMedia: 0
    })
    expect(
      await db!.mediaContentFingerprint.count({
        where: {
          image: {
            artworkId: {
              in: (
                await db!.artworkDedupItem.findMany({ where: { runId: run.runId }, select: { artworkId: true } })
              ).map((i) => i.artworkId)
            }
          }
        }
      })
    ).toBe(0)
    await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: job.leaseToken } })
    await repository!.fail({
      jobId: job.id,
      workerId: job.workerId,
      executionToken: job.executionToken,
      attempt: job.attempt,
      errorCode: 'INTERNAL_ERROR',
      error: 'Fixture complete'
    })
  }, 20_000)
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
  const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
  for (const [index, image] of images.entries()) {
    const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71 + (index % count) * 3) % 255))
    const original = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).withMetadata({ exif: { IFD0: { ImageDescription: nonce } } }).png().toBuffer()
    const content = index < images.length - 1 ? original : await sharp(original).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).withMetadata().png().toBuffer()
    await fs.writeFile(path.join(root, image.path), content)
  }
  return artistId
}
async function sharedVisualFixture(values: number[][]) {
  const artistId = await fixture(values.map(work => work.map(() => 1)))
  const images = await db!.image.findMany({ where: { artwork: { creators: { some: { artistId } } } }, orderBy: { id: 'asc' } })
  const contents = new Map<number, Buffer>(), nonce = randomUUID()
  for (const value of new Set(values.flat())) {
    let seed = value + 1
    const pixels = Buffer.from(Array.from({ length: 64 * 64 * 3 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed >>> 24 }))
    contents.set(value, await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).withMetadata({ exif: { IFD0: { ImageDescription: nonce } } }).png().toBuffer())
  }
  for (const [i, value] of values.flat().entries()) await fs.writeFile(path.join(root, images[i]!.path), contents.get(value)!)
  return { artistId, images, contents }
}
async function measureSharedScan(artistId: number, mode: 'INCREMENTAL' | 'FULL' = 'INCREMENTAL', resume?: { runId: string; jobId: string }) {
  const created = resume ?? await start(artistId, mode, true, 4)
  const supervisor = new DedupReaderSupervisor(readerOptions), create = supervisor.create.bind(supervisor)
  let visualCalls = 0, visualBytes = 0n, contentReads = 0, contentBytes = 0n
  supervisor.create = () => {
    const reader = create(), visual = reader.visual.bind(reader), read = reader.read.bind(reader)
    reader.visual = async input => { visualCalls++; const result = await visual(input); visualBytes += result.bytesRead; return result }
    reader.read = async input => { contentReads++; const result = await read(input); contentBytes += result.bytesRead; return result }
    return reader
  }
  let measurement: Parameters<NonNullable<ArtworkDedupDependencies['onMeasurement']>>[0] | undefined
  const job = await claim(created.jobId)
  queryMeasurement = { queries: 0, transactions: 0, cacheReads: 0, cacheWrites: 0 }
  try {
    await executeArtworkDedup(context(job), dependencies({ supervisor, sliceMs: 120_000, onMeasurement: value => { measurement = value } }))
    const metrics = { ...queryMeasurement, visualCalls, visualBytes: String(visualBytes), contentReads, contentBytes: String(contentBytes), readerBytes: String(measurement?.bytesRead ?? 0) }
    queryMeasurement = undefined
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: created.runId } })
    expect(run).toMatchObject({ status: 'COMPLETED', visualStatus: 'COMPLETE' })
    return { run, metrics }
  } finally { queryMeasurement = undefined }
}
async function start(artistId: number, mode: 'INCREMENTAL' | 'FULL' = 'INCREMENTAL', includeSuspectedVersions = false, definitionVersion?: number) {
  const value = await db!.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId,
      requestedBy: prefix,
      idempotencyKey: randomUUID(),
      mode, includeSuspectedVersions
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
  expect((await db!.systemJob.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED')
}

async function archiveFixture(from: 'nested' | 'separate' | 'same', to: 'nested' | 'separate') {
  const location = async (kind: 'nested' | 'separate' | 'same') => {
    if (kind === 'same') return root
    if (kind === 'nested') {
      const directory = path.join(root, `archive-${randomUUID()}`)
      await fs.mkdir(directory)
      return directory
    }
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-executor-archive-')))
    externalMediaRoots.push(directory)
    return directory
  }
  const before = await location(from),
    after = await location(to)
  const artistId = await fixture([[32], [32]], { source: 'URL_ARCHIVE', mediaRoot: before })
  const images = await db!.image.findMany({
    where: { artwork: { creators: { some: { artistId } } } },
    orderBy: { id: 'asc' }
  })
  for (const [index, image] of images.entries()) {
    await fs.mkdir(path.dirname(path.join(after, image.path)), { recursive: true })
    await fs.writeFile(path.join(after, image.path), Buffer.alloc(32, index + 1))
  }
  expect(await fs.readFile(path.join(before, images[0]!.path))).toEqual(
    await fs.readFile(path.join(before, images[1]!.path))
  )
  expect(await fs.readFile(path.join(after, images[0]!.path))).not.toEqual(
    await fs.readFile(path.join(after, images[1]!.path))
  )
  return { artistId, before, after, beforePrefix: from === 'nested' ? path.basename(before) : '' }
}
async function mappingCheckpoint(jobId: string, archiveRoot: string, boundary: 'STAT' | 'HASH') {
  if (boundary === 'HASH') {
    await executeArtworkDedup(context(await claim(jobId)), dependencies({ archiveRoot, sliceBytes: 32n }))
    return
  }
  const supervisor = new DedupReaderSupervisor(readerOptions)
  const create = supervisor.create.bind(supervisor)
  let inspections = 0
  supervisor.create = () => {
    const reader = create(),
      inspect = reader.inspect.bind(reader)
    reader.inspect = async (input) => {
      const result = await inspect(input)
      inspections++
      return result
    }
    return reader
  }
  const started = clock.now().getTime()
  await executeArtworkDedup(
    context(await claim(jobId)),
    dependencies({ archiveRoot, supervisor, now: () => started + (inspections >= 2 ? 10000 : 0) })
  )
}
// Recreate the retry transition's durable state; App command/idempotency behavior has separate service coverage.
async function retryMappingRun(run: { runId: string; jobId: string }) {
  const jobId = `${prefix}-${jobs.length}`
  await db!.$transaction(async (tx) => {
    await tx.systemJob.update({ where: { id: run.jobId }, data: { status: 'FAILED' } })
    await tx.artworkDedupMedia.deleteMany({ where: { runId: run.runId } })
    await tx.artworkDedupItem.updateMany({
      where: { runId: run.runId },
      data: {
        status: 'PENDING',
        snapshotRevision: null,
        mediaEpoch: null,
        memberCount: null,
        afterImageId: 0,
        sizeDigest: null,
        contentSha256: null,
        membersSignature: null,
        errorCode: null
      }
    })
    const retried = await tx.artworkDedupRun.update({
      where: { id: run.runId },
      data: {
        executionVersion: { increment: 1 },
        version: { increment: 1 },
        stage: 'STAT',
        finishedAt: null,
        errorCode: null,
        processedArtworks: 0,
        completeArtworks: 0,
        changedArtworks: 0,
        failedArtworks: 0,
        skippedArtworks: 0,
        groupCount: 0,
        duplicateArtworks: 0
      }
    })
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        maxAttempts: 3,
        payload: { runId: run.runId, executionVersion: retried.executionVersion }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.runId }, data: { jobId, status: 'PENDING' } })
  })
  jobs.push(jobId)
  return jobId
}
