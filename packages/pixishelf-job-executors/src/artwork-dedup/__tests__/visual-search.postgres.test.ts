import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Prisma, PrismaClient, captureArtworkContentSnapshot, captureMediaContentDirectory, ARTWORK_DEDUP_RELATION_CACHE_VERSION } from '@pixishelf/db'
import { MutableQueueClock, PostgresQueueRepository, type QueueDatabase } from '@pixishelf/job-runtime'
import { createArtworkDedupPerformance } from '../telemetry.ts'
import { scanVisualSearch } from '../visual-search.ts'
import { VisualSearchWorker } from '../visual-search-worker.ts'
import { VISUAL_SEARCH_VERSION } from '../visual-search-index.ts'
import type { VisualPage } from '../visual-matching.ts'
import type { DedupPipelineContext } from '../pipeline.ts'
const url = process.env.ARTWORK_DEDUP_V2_TEST_DATABASE_URL
if (url) { const target = new URL(url); if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_v2_core_20261029') throw new Error('Dedicated core DB required') }
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = db ? describe.sequential : describe.skip
const prefix = `visual-v2-${randomUUID()}`
const artistIds: number[] = [], imageIds: number[] = [], runIds: string[] = [], jobIds: string[] = []
const workers: VisualSearchWorker[] = []
afterAll(async () => {
  for (const worker of workers) await worker.close()
  if (!db) return
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runIds } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.image.deleteMany({ where: { id: { in: imageIds } } })
  await db.artwork.deleteMany({ where: { creators: { some: { artistId: { in: artistIds } } } } })
  await db.artist.deleteMany({ where: { id: { in: artistIds } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: prefix } })
  await db.$disconnect()
})
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function views(informative: boolean): VisualPage['views'] {
  return [{ name: 'original', feature: { width: 96, height: 96, hashes: Array.from({ length: 10 }, (_, i) => sha(`shared-template:${i}`).slice(0, 16)), information: Array<number>(10).fill(informative ? 30 : 0) } }]
}
async function fixture(counts = [5, 5]) {
  const artist = await db!.artist.create({ data: { name: prefix } }); artistIds.push(artist.id)
  const pages: VisualPage[] = []
  const items: Array<{ artworkId: number; frozenMediaRevision: number; snapshotRevision: bigint; mediaEpoch: bigint; memberCount: bigint }> = []
  for (let group = 0; group < counts.length; group++) {
    const artwork = await db!.artwork.create({ data: { title: prefix, source: 'LOCAL_IMPORT', creators: { create: {
      artistId: artist.id, evidence: { create: { provenance: 'MANUAL', evidenceKey: randomUUID(), present: true } }
    } } } })
    await db!.image.createMany({ data: Array.from({ length: counts[group]! }, (_, index) => ({ artworkId: artwork.id, sortOrder: index, path: `${prefix}/${artwork.id}/${index}.png` })) })
    const images = await db!.image.findMany({ where: { artworkId: artwork.id }, orderBy: { id: 'asc' } })
    imageIds.push(...images.map(image => image.id))
    const snapshot = await db!.$transaction(tx => captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
    if (snapshot.status !== 'READY') throw new Error('Synthetic snapshot unavailable')
    items.push({ artworkId: artwork.id, frozenMediaRevision: (await db!.artwork.findUniqueOrThrow({ where: { id: artwork.id } })).mediaRevision,
      snapshotRevision: snapshot.value.revision, mediaEpoch: snapshot.value.mediaEpoch, memberCount: snapshot.value.memberCount })
    pages.push(...images.map((image, index) => ({ artworkId: artwork.id, imageId: image.id, index, size: 100n,
      sha256: sha(index < 3 ? `exact-anchor:${index}` : `unique:${image.id}`), views: views(true), unchecked: index === 4 })))
  }
  const jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 8, executionLane: 'BACKGROUND_WRITER', status: 'PENDING',
    triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId,
    status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: pages.at(-1)!.imageId } }); runIds.push(run.id)
  const directory = await db!.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot: 'source-media:v1', rootIdentity: prefix, relativeDirectory: prefix } }))
  if (directory.status !== 'READY') throw new Error('Synthetic directory unavailable')
  await db!.artworkDedupItem.createMany({ data: items.map(item => ({ ...item, runId: run.id, status: 'COMPLETE' })) })
  await db!.artworkDedupMedia.createMany({ data: pages.map(page => ({ runId: run.id, artworkId: page.artworkId, imageId: page.imageId,
    sourcePath: `${prefix}/${page.artworkId}/${page.index}.png`, sourceRevision: 0n, logicalRoot: 'source-media:v1', rootIdentity: prefix,
    relativeDirectory: prefix, directoryId: directory.value.directoryId, directoryGeneration: directory.value.generation,
    canonicalPath: `${prefix}/${page.artworkId}/${page.index}.png`, size: page.size, sha256: page.sha256,
    visualStatus: page.unchecked ? 'UNCHECKED' : 'READY', visualViews: page.unchecked ? Prisma.JsonNull : page.views as unknown as Prisma.InputJsonValue })) })
  return { runId: run.id, jobId, pages }
}

type Fixture = Awaited<ReturnType<typeof fixture>>
function context(test: Fixture): DedupPipelineContext {
  const worker = new VisualSearchWorker(fileURLToPath(new URL('../../../../pixishelf-worker/dist/artwork-dedup-visual-search.cjs', import.meta.url)))
  workers.push(worker)
  return { execution: { runId: test.runId, jobId: test.jobId, executionVersion: 1 }, signal: new AbortController().signal,
    forceRead: true, mixedVisualMedia: true, visualSearchV2: true, searchWorker: worker, searchCache: { built: false },
    roots: {} as DedupPipelineContext['roots'], reader: { visual() { throw new Error('Must not decode prepared features') } } as unknown as DedupPipelineContext['reader'],
    shouldYield: () => false, read: operation => operation(db!), transaction: operation => db!.$transaction(operation, { timeout: 30000 }) }
}
const run = (test: Fixture) => db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
async function clone(test: Fixture) {
  const old = await run(test), jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 8, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
  const next = await db!.artworkDedupRun.create({ data: { artistId: old.artistId, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'INCREMENTAL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: old.visualAfterImageId } }); runIds.push(next.id)
  const items = await db!.artworkDedupItem.findMany({ where: { runId: old.id } })
  await db!.artworkDedupItem.createMany({ data: items.map(item => ({ ...item, runId: next.id, visualSignature: null, visualReuseSignature: null })) })
  const media = await db!.artworkDedupMedia.findMany({ where: { runId: old.id } })
  await db!.artworkDedupMedia.createMany({ data: media.map(row => ({ ...row, runId: next.id, visualViews: row.visualViews === null ? Prisma.DbNull : row.visualViews })) })
  return { ...test, runId: next.id, jobId }
}
async function toQuery(test: Fixture, ctx: DedupPipelineContext) {
  for (let i = 0; i < 20; i++) {
    if (((await run(test)).visualCheckpoint as { phase?: string } | null)?.phase === 'QUERY') return
    await scanVisualSearch({ ...ctx, shouldYield: () => true })
  }
  throw new Error('No query checkpoint')
}
suite('v8 persisted search and safety', () => {
  it('upgrades a FEATURES summary and commits PAIR/PUBLISH progress without premature completion', async () => {
    const test = await fixture(), ctx = context(test)
    ctx.onPerformanceSnapshot = async (tx, summary) => { await tx.systemJob.update({ where: { id: test.jobId }, data: { message: summary.phase } }) }
    const initial = createArtworkDedupPerformance({ runId: test.runId, jobId: test.jobId, protocolVersion: 8, searchVersion: null, inputDigest: null, phase: 'FEATURES', updatedAt: new Date().toISOString() })
    await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { performanceSummary: initial as unknown as Prisma.InputJsonValue } })
    let observedPublish = false
    for (let i = 0; i < 20; i++) {
      const done = await scanVisualSearch({ ...ctx, shouldYield: () => true })
      const current = await run(test), summary = current.performanceSummary as { searchVersion: string; phase: string; complete: boolean }
      const checkpoint = current.visualCheckpoint as { phase: string }
      const job = await db!.systemJob.findUniqueOrThrow({ where: { id: test.jobId } })
      expect(summary.searchVersion).toBe(VISUAL_SEARCH_VERSION)
      expect(summary.complete).toBe(false)
      expect(summary.phase).not.toBe('COMPLETED')
      if (checkpoint.phase === 'PUBLISH') {
        observedPublish = true
        expect(summary.phase).toBe('PUBLISH')
        expect(job.progressData).toMatchObject({ phase: 'PUBLISH' })
        expect(job.message).toBe('PUBLISH')
      }
      if (done) break
    }
    expect(observedPublish).toBe(true)
    expect((await run(test)).stage).toBe('DONE')
  })
  it('rejects a real expired queue lease after compute with zero result/cursor commit', async () => {
    const test = await fixture(), ctx = context(test)
    await toQuery(test, ctx)
    const clock = new MutableQueueClock(new Date('2030-01-01'))
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20000 })
    await db!.systemJob.update({ where: { id: test.jobId }, data: { availableAt: clock.now(), payload: { runId: test.runId, executionVersion: 1 } } })
    const claim = await repository.claim(`${prefix}-lease`, [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [8] }])
    expect(claim?.id).toBe(test.jobId)
    ctx.transaction = operation => repository.withFencedMutationTransaction({ jobId: claim!.id, workerId: claim!.workerId, executionToken: claim!.executionToken, attempt: claim!.attempt }, operation)
    const before = await run(test), batch = ctx.searchWorker!.batch.bind(ctx.searchWorker)
    ctx.searchWorker!.batch = async (...args) => { const result = await batch(...args); clock.advance(60001); return result }
    await expect(scanVisualSearch(ctx)).rejects.toThrow()
    const after = await run(test)
    expect(after.visualCheckpoint).toEqual(before.visualCheckpoint)
    expect(after.visualComparedComparisons).toBe(0)
    expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: test.runId } })).toBe(0)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
  })
  it('preserves mixed media and hot reuse without any index or candidate work', async () => {
    const cold = await fixture(), ctx = context(cold)
    expect(await scanVisualSearch(ctx)).toBe(true)
    expect(await db!.artworkDedupVisualPosting.count({ where: { runId: cold.runId } })).toBe(0)
    const result = await run(cold)
    expect(result.visualSearchComplete).toBe(true); expect(result.visualStatus).toBe('INCOMPLETE')
    expect(result.visualComparedComparisons).toBe(16)
    expect(result.performanceSummary).toMatchObject({ cacheInvalidationReasons: ['FULL'], counters: { relationReusedPairs: 0 } })
    expect((result.performanceSummary as { durationsMs: { compare: number } }).durationsMs.compare).toBeGreaterThan(0)
    const pairs = await db!.artworkDedupVisualPair.findMany({ where: { runId: cold.runId }, include: { pages: true } })
    expect(pairs).toHaveLength(1); expect(pairs[0]!.pages.filter(p => p.kind === 'UNCHECKED')).toHaveLength(2)
    await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
    const hot = await clone(cold), hotContext = context(hot)
    hotContext.forceRead = false
    hotContext.searchWorker = { load() { throw new Error('Hot reuse must skip index') } } as unknown as VisualSearchWorker
    expect(await scanVisualSearch(hotContext)).toBe(true)
    expect((await run(hot)).visualComparedComparisons).toBe(0)
    expect((await run(hot)).performanceSummary).toMatchObject({ cacheInvalidationReasons: [], counters: { relationReusedPairs: 1, relationInvalidatedPairs: 0, compareCalls: 0, indexRebuilds: 0, candidatePairs: 0 }, durationsMs: { compare: 0 } })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: hot.runId } })).toBe(1)
  })
  it('does not inherit old algorithm negatives and recomputes changed-vs-unchanged pairs', async () => {
    const cold = await fixture(), ctx = context(cold); await scanVisualSearch(ctx)
    await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION, visualSearchVersion: null, visualSearchComplete: false } })
    const legacy = await clone(cold), legacyContext = context(legacy); legacyContext.forceRead = false
    await scanVisualSearch(legacyContext); expect((await run(legacy)).visualComparedComparisons).toBe(16)
    expect((await run(legacy)).performanceSummary).toMatchObject({ cacheInvalidationReasons: ['SEARCH_VERSION'] })
    await db!.artworkDedupRun.update({ where: { id: legacy.runId }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
    const delta = await clone(legacy), deltaContext = context(delta); deltaContext.forceRead = false
    await db!.artworkDedupMedia.update({ where: { runId_artworkId_imageId: { runId: delta.runId, artworkId: delta.pages[3]!.artworkId, imageId: delta.pages[3]!.imageId } }, data: { sha256: sha('changed') } })
    await scanVisualSearch(deltaContext); expect((await run(delta)).visualComparedComparisons).toBe(16)
    expect((await run(delta)).visualSearchVersion).toBe(VISUAL_SEARCH_VERSION)
    expect((await run(delta)).performanceSummary).toMatchObject({ cacheInvalidationReasons: ['INPUT_CHANGED'], counters: { relationReusedPairs: 0, relationInvalidatedPairs: 1 } })
  })
  it('records only observed missing/incomplete cache causes', async () => {
    const cold = await fixture(), ctx = context(cold); ctx.forceRead = false
    await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { mode: 'INCREMENTAL' } })
    await scanVisualSearch(ctx)
    expect((await run(cold)).performanceSummary).toMatchObject({ cacheInvalidationReasons: ['MISSING'], counters: { relationReusedPairs: 0, replayedQueries: null, replayedComparisons: null } })
    await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION, visualSearchComplete: false } })
    const next = await clone(cold), nextContext = context(next); nextContext.forceRead = false
    await scanVisualSearch(nextContext)
    expect((await run(next)).performanceSummary).toMatchObject({ cacheInvalidationReasons: ['INCOMPLETE'], counters: { relationReusedPairs: 0 } })
  })
  it('rolls back failed batch atomically and resumes after a new worker without repeated comparisons', async () => {
    const test = await fixture([55, 55]), ctx = context(test)
    await toQuery(test, ctx)
    let writes = 0
    const before = await run(test)
    const transaction = ctx.transaction
    ctx.transaction = operation => db!.$transaction(async tx => { const value = await operation(tx); const row = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } }); if (row.visualComparedComparisons > 0) throw new Error('Rollback batch'); return value }, { timeout: 30000 })
    await expect(scanVisualSearch(ctx)).rejects.toThrow('Rollback batch')
    expect((await run(test)).visualComparedComparisons).toBe(0)
    expect((await run(test)).visualCheckpoint).toEqual(before.visualCheckpoint)
    ctx.transaction = async operation => { const value = await transaction(operation); writes++; return value }
    await scanVisualSearch({ ...ctx, shouldYield: () => writes >= 1 })
    await ctx.searchWorker!.close()
    const fresh = context(test)
    await scanVisualSearch(fresh)
    const result = await run(test)
    expect(result.visualComparedComparisons).toBe(54 * 54)
    expect(result.performanceSummary).toMatchObject({ counters: { replayedQueries: 1, replayedComparisons: null } })
    expect((result.visualCheckpoint as { queryCompleted: number }).queryCompleted).toBe(108)
  })
  it('rejects cancellation, execution loss, source changes and directory generation changes before query commit', async () => {
    for (const kind of ['cancel', 'execution', 'source', 'directory']) {
      const test = await fixture(), ctx = context(test); await toQuery(test, ctx)
      const original = ctx.searchWorker!.batch.bind(ctx.searchWorker)
      ctx.searchWorker!.batch = async (...args) => {
        const result = await original(...args)
        if (kind === 'cancel') { const abort = new AbortController(); abort.abort(); ctx.signal = abort.signal }
        if (kind === 'execution') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: 2 } })
        if (kind === 'source') await db!.artwork.update({ where: { id: test.pages[0]!.artworkId }, data: { mediaRevision: { increment: 1 } } })
        if (kind === 'directory') await db!.mediaContentDirectoryState.updateMany({ where: { rootIdentity: prefix }, data: { generation: { increment: 1 } } })
        return result
      }
      await expect(scanVisualSearch(ctx)).rejects.toThrow()
      expect((await run(test)).visualComparedComparisons).toBe(0)
      expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: test.runId } })).toBe(0)
    }
  })
})
