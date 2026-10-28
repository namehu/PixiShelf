import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma, captureArtworkContentSnapshot, captureMediaContentDirectory, resetArtworkDedupVisualWork, ARTWORK_DEDUP_RELATION_CACHE_VERSION } from '@pixishelf/db'
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { matchVisualPages, type VisualPage } from '../visual-matching.ts'
import type { DedupPipelineContext } from '../pipeline.ts'
import { VisualSqlProfile } from './visual-sql-profile.ts'
import { MutableQueueClock, PostgresQueueRepository, type ClaimedJob, type QueueDatabase } from '@pixishelf/job-runtime'

// Synthetic features exercise the real persisted index/query path, not image decoding.
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `visual-batches-${randomUUID()}`
const artistIds: number[] = [], imageIds: number[] = [], runIds: string[] = [], jobIds: string[] = []
const directoryPrefixes = [prefix]
let preserveFixture = false
let sqlProfile: VisualSqlProfile | undefined
let metrics: { queries: number; writes: number; transactions: number; maxMediaTake: number } | undefined
let rootIdentity = prefix
beforeAll(async () => { if (db) rootIdentity = (await db.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } }))?.rootIdentity ?? prefix })
let measurementStarted = 0, measurementCount = 0
let checkpointWrites = 0
let scopeDerivations = 0
let failCommit = false

db?.$on('query', event => {
  if (/SELECT DISTINCT m\."artworkId",m\."logicalRoot"/.test(event.query)) scopeDerivations++
  sqlProfile?.event(event.query, event.duration)
  if (metrics) {
    metrics.queries++
    if (/^(INSERT|UPDATE|DELETE)/.test(event.query.trim())) metrics.writes++
    if (event.query === 'BEGIN') metrics.transactions++
  }
  if (/^UPDATE .*ArtworkDedupRun/.test(event.query) && event.query.includes('visualCheckpoint')) {
    checkpointWrites++
    if (metrics && checkpointWrites % 1000 === 0) console.info('F03_PROGRESS ' + JSON.stringify({ count: measurementCount, elapsedMs: Math.round(performance.now() - measurementStarted), ...metrics }))
  }
})
afterAll(async () => {
  if (!db) return
  if (preserveFixture) { await db.$disconnect(); return }
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runIds } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.image.deleteMany({ where: { id: { in: imageIds } } })
  await db.artwork.deleteMany({ where: { creators: { some: { artistId: { in: artistIds } } } } })
  await db.artist.deleteMany({ where: { id: { in: artistIds } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { OR: [{ relativeDirectory: { in: directoryPrefixes } }, ...(rootIdentity === prefix ? [{ rootIdentity: prefix }] : [])] } })
  await db.$disconnect()
}, 120_000)
function views(seed: number) {
  return [{ name: 'original', feature: { width: 96, height: 96,
    hashes: Array.from({ length: 10 }, (_, i) => createHash('sha256').update(`${seed}:${i}`).digest('hex').slice(0, 16)), information: Array<number>(10).fill(30) } }]
}
async function fixture(count: number, groupSize = 1000, dense = false) {
  const artist = await db!.artist.create({ data: { name: prefix } }); artistIds.push(artist.id)
  const artworks: Array<{ id: number; revision: number; snapshot: { revision: bigint; mediaEpoch: bigint; memberCount: bigint } }> = []
  const pages: VisualPage[] = []
  for (let start = 0; start < count; start += groupSize) {
    const artwork = await db!.artwork.create({ data: { title: prefix, source: 'LOCAL_IMPORT', creators: { create: { artistId: artist.id, evidence: { create: { provenance: 'MANUAL', evidenceKey: randomUUID(), present: true } } } } } })
    const length = Math.min(groupSize, count - start)
    await db!.image.createMany({ data: Array.from({ length }, (_, i) => ({ artworkId: artwork.id, path: `${prefix}/${artwork.id}/${i}.png`, sortOrder: i })) })
    const images = await db!.image.findMany({ where: { artworkId: artwork.id }, orderBy: { id: 'asc' } })
    imageIds.push(...images.map(image => image.id))
    const snapshot = await db!.$transaction(tx => captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
    if (snapshot.status !== 'READY') throw new Error('Synthetic snapshot unavailable')
    artworks.push({ id: artwork.id, revision: (await db!.artwork.findUniqueOrThrow({ where: { id: artwork.id } })).mediaRevision, snapshot: snapshot.value })
    for (const [i, image] of images.entries()) {
      const seed = dense || start > 0 && start + length === count && i === 0 ? 0 : start + i
      pages.push({ imageId: image.id, artworkId: artwork.id, index: i, size: 100n, sha256: createHash('sha256').update(String(image.id)).digest('hex'), views: views(seed) })
    }
  }
  const jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: pages.at(-1)!.imageId } })
  runIds.push(run.id)
  const directory = await db!.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix } }))
  if (directory.status !== 'READY') throw new Error('Synthetic directory unavailable')
  await db!.artworkDedupItem.createMany({ data: artworks.map(a => ({ runId: run.id, artworkId: a.id, frozenMediaRevision: a.revision, status: 'COMPLETE', snapshotRevision: a.snapshot.revision, mediaEpoch: a.snapshot.mediaEpoch, memberCount: a.snapshot.memberCount })) })
  for (let start = 0; start < pages.length; start += 500) await db!.artworkDedupMedia.createMany({ data: pages.slice(start, start + 500).map(p => ({ runId: run.id, artworkId: p.artworkId, imageId: p.imageId,
    sourcePath: `${prefix}/${p.artworkId}/${p.index}.png`, sourceRevision: 0n, logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix,
    directoryId: directory.value.directoryId, directoryGeneration: directory.value.generation, canonicalPath: `${prefix}/${p.artworkId}/${p.index}.png`, size: p.size, sha256: p.sha256,
    visualStatus: 'READY', visualViews: p.views as unknown as Prisma.InputJsonValue })) })
  return { ...fixtureContext(run.id, jobId), pages, runId: run.id, artistId: artist.id }
}
function fixtureContext(runId: string, jobId: string) {
  let candidateReads = 0
  const measuredDb = db!.$extends({ query: { artworkDedupRun: { async findUnique({ args, query }) {
    const result = await query(args)
    if (result) sqlProfile?.readRun(result.visualCheckpoint)
    return result
  } }, artwork: { async findMany({ args, query }) {
    const ids = args.where?.id
    if (ids && typeof ids === 'object' && Array.isArray(ids.in)) sqlProfile?.guardArtworks(ids.in.length)
    return query(args)
  } }, artworkDedupMedia: { async findFirst({ args, query }) {
    const result = await query(args)
    if (args.include?.item && result) sqlProfile?.features('queryRows', 1)
    return result
  }, async findMany({ args, query }) {
    const result = await query(args)
    if (args.include?.item && args.where?.imageId && typeof args.where.imageId === 'object' && 'in' in args.where.imageId) { candidateReads++; sqlProfile?.features('candidateRows', result.length) }
    else if (args.include?.item) sqlProfile?.features('queryRows', result.length)
    if (metrics) metrics.maxMediaTake = Math.max(metrics.maxMediaTake, result.length)
    return result
  } } } })
  const context: DedupPipelineContext = {
    execution: { runId, jobId, executionVersion: 1 }, signal: new AbortController().signal, forceRead: true,
    roots: {} as DedupPipelineContext['roots'], reader: { visual() { throw new Error('Synthetic features must never decode') } } as unknown as DedupPipelineContext['reader'], shouldYield: () => false,
    transaction: async operation => {
      sqlProfile?.begin()
      try { return await measuredDb.$transaction(async tx => {
      const before = checkpointWrites
      const result = await operation(tx as unknown as Prisma.TransactionClient)
      if (failCommit && checkpointWrites > before) { failCommit = false; throw new Error('Injected transaction rollback') }
      return result
      }, { timeout: 120_000 }) } finally { sqlProfile?.end() }
    }
  }
  return { context, candidateReads: () => candidateReads }
}
async function results(runId: string) {
  return (await db!.artworkDedupVisualPair.findMany({ where: { runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }], include: { pages: { orderBy: { ordinal: 'asc' } } } })).map(p => ({ left: p.leftArtworkId, right: p.rightArtworkId, pages: p.pages.map(row => [row.kind, row.leftImageId, row.rightImageId]) }))
}
function expected(pairs: Awaited<ReturnType<typeof matchVisualPages>>['pairs']) {
  return pairs.map(p => ({ left: p.leftArtworkId, right: p.rightArtworkId, pages: p.pages.map(row => [row.kind, row.left?.imageId ?? null, row.right?.imageId ?? null]) }))
}
async function advanceTo(context: DedupPipelineContext, phase: string) {
  for (let i = 0; i < 100; i++) {
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: context.execution.runId } })
    if ((run.visualCheckpoint as { phase?: string } | null)?.phase === phase) return run
    if (await scanBatchedVisualVersions({ ...context, shouldYield: () => true })) throw new Error('Finished before checkpoint')
  }
  throw new Error('Checkpoint not reached')
}
async function cloneIncremental(context: DedupPipelineContext) {
  const old = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: context.execution.runId } })
  await db!.artworkDedupRun.update({ where: { id: old.id }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
  const jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: old.artistId, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'INCREMENTAL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: old.visualAfterImageId } })
  runIds.push(run.id)
  const items = await db!.artworkDedupItem.findMany({ where: { runId: old.id } })
  await db!.artworkDedupItem.createMany({ data: items.map(i => ({ ...i, runId: run.id, visualSignature: null, visualReuseSignature: null })) })
  const media = await db!.artworkDedupMedia.findMany({ where: { runId: old.id } })
  await db!.artworkDedupMedia.createMany({ data: media.map(m => ({ ...m, runId: run.id, visualViews: m.visualViews as Prisma.InputJsonValue })) })
  return { ...context, forceRead: false, execution: { runId: run.id, jobId, executionVersion: 1 } }
}
suite('F03 persistent visual batches', () => {
  it('rebuilds bounded directory scopes after normal yields with identical edges and query results', async () => {
    const test = await fixture(20, 10, true)
    const initial = await advanceTo(test.context, 'QUERY')
    const outcome = async () => {
      const row = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
      return { checkpoint: row.visualCheckpoint, status: row.visualStatus, compared: row.visualComparedComparisons, reused: row.visualReusedComparisons,
        candidates: await db!.artworkDedupVisualCandidate.findMany({ where: { runId: test.runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }], select: { leftArtworkId: true, rightArtworkId: true, edges: true, evidence: true } }), results: await results(test.runId) }
    }
    let before = scopeDerivations
    expect(await scanBatchedVisualVersions(test.context)).toBe(true)
    const continuous = await outcome(), continuousDerivations = scopeDerivations - before
    expect(continuousDerivations).toBe(1)
    await db!.$transaction(async tx => {
      await tx.artworkDedupVisualPair.deleteMany({ where: { runId: test.runId } })
      await tx.artworkDedupVisualCandidate.deleteMany({ where: { runId: test.runId } })
      await tx.artworkDedupRun.update({ where: { id: test.runId }, data: { stage: initial.stage, visualStatus: initial.visualStatus,
        visualCheckpoint: initial.visualCheckpoint as Prisma.InputJsonValue, visualComparedComparisons: 0, visualReusedComparisons: 0, visualCandidatePairs: [] } })
    })
    before = scopeDerivations
    let slices = 0, nonemptySlices = 0
    for (;;) {
      const writes = checkpointWrites, derivations = scopeDerivations
      // A fresh context models the runtime's time slice; each call discards its
      // scope even though multiple QUERY commits inside the call can reuse it.
      const fresh = fixtureContext(test.runId, test.context.execution.jobId).context
      const done = await scanBatchedVisualVersions({ ...fresh, shouldYield: () => checkpointWrites - writes >= 3 })
      expect(scopeDerivations - derivations).toBeLessThanOrEqual(1)
      if (scopeDerivations > derivations) nonemptySlices++
      if (done) break
      if (++slices > 30) throw new Error('Sliced scope fixture stalled')
    }
    expect(slices).toBeGreaterThan(2)
    expect(scopeDerivations - before).toBe(nonemptySlices)
    expect(nonemptySlices).toBeGreaterThan(continuousDerivations)
    expect(await outcome()).toEqual(continuous)
    console.info('F03_SCOPE_SLICES ' + JSON.stringify({ pages: 20, continuousDerivations, slicedDerivations: nonemptySlices, slices: slices + 1, commitsPerSlice: 3 }))
  }, 60_000)

  it.each(['cancel', 'execution', 'source', 'member', 'media-epoch', 'snapshot-null', 'directory', 'root', 'write-token', 'directory-writer', 'lease', 'rollback'] as const)('rejects %s after directory scope reuse without advancing the committed prefix', async fault => {
    const test = await fixture(20, 10, true)
    await advanceTo(test.context, 'QUERY')
    const controller = new AbortController()
    const directory = await db!.mediaContentDirectoryState.findUniqueOrThrow({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: prefix } } })
    const root = await db!.mediaContentDirectoryState.findUniqueOrThrow({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } })
    const clock = new MutableQueueClock(new Date('2030-01-01'))
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20_000 })
    const capabilities = [{ jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [5] }]
    let claim: ClaimedJob | null = null
    if (fault === 'lease') {
      await db!.systemJob.update({ where: { id: test.context.execution.jobId }, data: { availableAt: clock.now(), payload: { runId: test.runId, executionVersion: 1 } } })
      claim = await repository.claim(`${prefix}-scope`, capabilities)
      expect(claim?.id).toBe(test.context.execution.jobId)
    }
    const mutate = claim ? <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => repository.withFencedMutationTransaction({ jobId: claim!.id, workerId: claim!.workerId, executionToken: claim!.executionToken, attempt: claim!.attempt }, operation) : test.context.transaction
    const state = async () => {
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
      return { checkpoint: run.visualCheckpoint, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons,
        candidates: await db!.artworkDedupVisualCandidate.findMany({ where: { runId: test.runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }] }), results: await results(test.runId) }
    }
    let committed = 0, saved: Awaited<ReturnType<typeof state>> | undefined, writerId: string | undefined
    const derivations = scopeDerivations
    const context: DedupPipelineContext = { ...test.context, signal: controller.signal, transaction: async operation => {
      const writes = checkpointWrites
      const result = await mutate(async tx => {
        const value = await operation(tx)
        if (fault === 'rollback' && committed === 2 && checkpointWrites > writes) throw new Error('Injected cached-scope rollback')
        return value
      })
      if (checkpointWrites > writes && ++committed === 2) {
        saved = await state()
        expect(scopeDerivations - derivations).toBe(1)
        if (fault === 'cancel') controller.abort()
        if (fault === 'execution') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: { increment: 1 } } })
        if (fault === 'source') await db!.image.update({ where: { id: test.pages[0]!.imageId }, data: { path: `${prefix}/changed.png` } })
        if (fault === 'member') {
          const image = await db!.image.create({ data: { artworkId: test.pages[0]!.artworkId, path: `${prefix}/new-member.png` } }); imageIds.push(image.id)
        }
        if (fault === 'media-epoch') await db!.artworkContentSource.update({ where: { artworkId: test.pages[0]!.artworkId }, data: { mediaEpoch: { increment: 1 } } })
        if (fault === 'snapshot-null') await db!.artworkDedupItem.update({ where: { runId_artworkId: { runId: test.runId, artworkId: test.pages[0]!.artworkId } }, data: { snapshotRevision: null } })
        if (fault === 'directory') await db!.mediaContentDirectoryState.update({ where: { id: directory.id }, data: { generation: { increment: 1 } } })
        if (fault === 'root') await db!.mediaContentDirectoryState.update({ where: { id: root.id }, data: { rootIdentity: `${prefix}-changed` } })
        if (fault === 'write-token') await db!.artworkContentSource.update({ where: { artworkId: test.pages[0]!.artworkId }, data: { writeToken: randomUUID() } })
        if (fault === 'directory-writer') {
          const writer = await db!.mediaContentPathWrite.create({ data: { directoryId: root.id, scope: 'DIRECTORY', sessionId: prefix, sessionVersion: 1n, writeToken: randomUUID(), startedAt: new Date() } }); writerId = writer.id
        }
        if (fault === 'lease') clock.advance(60_001)
      }
      return result
    } }
    try {
      await expect(scanBatchedVisualVersions(context)).rejects.toThrow()
      expect(committed).toBe(2)
      expect(saved).toBeDefined()
      expect(await state()).toEqual(saved)
      expect(scopeDerivations - derivations).toBe(fault === 'snapshot-null' ? 2 : 1)
      if (fault === 'execution') {
        const restarted = { ...test.context, execution: { ...test.context.execution, executionVersion: 2 } }
        expect(await scanBatchedVisualVersions(restarted)).toBe(true)
        expect(scopeDerivations - derivations).toBe(2)
      }
    } finally {
      if (writerId) await db!.mediaContentPathWrite.delete({ where: { id: writerId } })
      if (fault === 'directory') await db!.mediaContentDirectoryState.update({ where: { id: directory.id }, data: { generation: directory.generation } })
      if (fault === 'root') await db!.mediaContentDirectoryState.update({ where: { id: root.id }, data: { rootIdentity: root.rootIdentity } })
    }
  }, 60_000)

  it('restarts every phase, preserves query prefixes after rollback, and matches the legacy engine', async () => {
    const test = await fixture(120, 60, true)
    for (let i = 0; i < 59; i++) test.pages[i + 60]!.sha256 = test.pages[i]!.sha256
    await db!.$executeRaw(Prisma.sql`UPDATE "ArtworkDedupMedia" m SET sha256=v.sha FROM (VALUES ${Prisma.join(test.pages.map(p => Prisma.sql`(${p.imageId}::int,${p.sha256}::text)`))}) v(id,sha) WHERE m."runId"=${test.runId} AND m."imageId"=v.id`)
    const legacy = await matchVisualPages(test.pages, async () => {})
    expect(legacy.pairs).toHaveLength(1)
    const phases = new Set<string>()
    let iterations = 0, rollbackChecked = false
    for (;;) {
      const before = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
      const cp = before.visualCheckpoint as { phase?: string; candidateAfter?: number } | null
      if (cp?.phase) phases.add(cp.phase)
      if (cp?.phase === 'QUERY' && cp.candidateAfter && !rollbackChecked) {
        const beforeEdges = await db!.artworkDedupVisualCandidate.findMany({ where: { runId: test.runId } })
        failCommit = true
        await expect(scanBatchedVisualVersions({ ...test.context })).rejects.toThrow('Injected transaction rollback')
        expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })).visualCheckpoint).toEqual(before.visualCheckpoint)
        expect(await db!.artworkDedupVisualCandidate.findMany({ where: { runId: test.runId } })).toEqual(beforeEdges)
        const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
        expect([after.visualComparedComparisons, after.visualReusedComparisons]).toEqual([before.visualComparedComparisons, before.visualReusedComparisons])
        rollbackChecked = true
      }
      const committed = checkpointWrites
      const done = await scanBatchedVisualVersions({ ...test.context, shouldYield: () => checkpointWrites > committed })
      if (done) break
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
      if (++iterations > 500) throw new Error('Checkpoint stalled')
    }
    expect([...phases].sort()).toEqual(['INDEX', 'PAIR', 'PUBLISH', 'QUERY', 'REUSE'])
    expect(rollbackChecked).toBe(true)
    expect(await results(test.runId)).toEqual(expected(legacy.pairs))
    const stored = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(stored.visualComparedComparisons).toBe(legacy.comparedComparisons)
    expect(stored.visualCandidatePairs).toEqual(legacy.candidatePairs)
    await db!.$transaction(tx => resetArtworkDedupVisualWork(tx, test.runId))
    expect(await db!.artworkDedupVisualPosting.count({ where: { runId: test.runId } })).toBe(0)
    expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: test.runId } })).toBe(0)
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })).visualCheckpoint).toBeNull()
  }, 120_000)

  it.each(['during-copy', 'after-copy'])('handles history cleanup %s without partial negative reuse', async moment => {
    const test = await fixture(3, 1, true)
    await scanBatchedVisualVersions(test.context)
    const expectedRows = await results(test.runId)
    const hot = await cloneIncremental(test.context)
    await advanceTo(hot, 'REUSE')
    if (moment === 'during-copy') {
      await scanBatchedVisualVersions({ ...hot, shouldYield: () => true })
      await scanBatchedVisualVersions({ ...hot, shouldYield: () => true })
      expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: hot.execution.runId } })).toBe(1)
    } else await advanceTo(hot, 'QUERY')
    await db!.artworkDedupRun.delete({ where: { id: test.runId } })
    expect(await scanBatchedVisualVersions(hot)).toBe(true)
    expect(await results(hot.execution.runId)).toEqual(expectedRows)
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: hot.execution.runId } })
    expect(run.visualComparedComparisons).toBe(moment === 'during-copy' ? 3 : 0)
    expect(run.visualReusedComparisons).toBe(moment === 'during-copy' ? 0 : 3)
  }, 60_000)

  it.each(['cancel', 'execution', 'source'])('rejects %s before a query checkpoint advances', async fault => {
    const test = await fixture(2, 1)
    const before = await advanceTo(test.context, 'QUERY')
    let context = test.context
    if (fault === 'cancel') { const controller = new AbortController(); controller.abort(); context = { ...context, signal: controller.signal } }
    if (fault === 'execution') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: { increment: 1 } } })
    if (fault === 'source') await db!.image.update({ where: { id: test.pages[0]!.imageId }, data: { path: `${prefix}/changed.png` } })
    await expect(scanBatchedVisualVersions(context)).rejects.toThrow()
    const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(after.visualCheckpoint).toEqual(before.visualCheckpoint)
    expect(after.visualComparedComparisons).toBe(0)
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
  })

  it.each(['after-read', 'before-commit'] as const)('keeps query guards %s when inputs or execution change', async boundary => {
    for (const fault of ['cancel', 'execution', 'source', 'directory', 'root', 'write-token'] as const) {
      const test = await fixture(2, 1)
      const before = await advanceTo(test.context, 'QUERY')
      const controller = new AbortController()
      const directory = await db!.mediaContentDirectoryState.findUniqueOrThrow({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: prefix } } })
      const root = await db!.mediaContentDirectoryState.findUniqueOrThrow({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } })
      let read = false, injected = false
      const inject = async () => {
        injected = true
        if (fault === 'cancel') controller.abort()
        if (fault === 'execution') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: { increment: 1 } } })
        if (fault === 'source') await db!.image.update({ where: { id: test.pages[0]!.imageId }, data: { path: `${prefix}/changed.png` } })
        if (fault === 'directory') await db!.mediaContentDirectoryState.update({ where: { id: directory.id }, data: { generation: { increment: 1 } } })
        if (fault === 'root') await db!.mediaContentDirectoryState.update({ where: { id: root.id }, data: { rootIdentity: `${prefix}-changed` } })
        if (fault === 'write-token') await db!.artworkContentSource.update({ where: { artworkId: test.pages[0]!.artworkId }, data: { writeToken: randomUUID() } })
      }
      const context: DedupPipelineContext = { ...test.context, signal: controller.signal, transaction: async operation => {
        if (boundary === 'before-commit' && read && !injected) await inject()
        const priorReads = test.candidateReads()
        const result = await test.context.transaction(operation)
        if (test.candidateReads() > priorReads) {
          read = true
          if (boundary === 'after-read' && !injected) await inject()
        }
        return result
      } }
      try {
        await expect(scanBatchedVisualVersions(context)).rejects.toThrow()
        expect(injected).toBe(true)
        const after = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
        expect(after.visualCheckpoint).toEqual(before.visualCheckpoint)
        expect([after.visualComparedComparisons, after.visualReusedComparisons]).toEqual([0, 0])
        expect(await db!.artworkDedupVisualCandidate.count({ where: { runId: test.runId } })).toBe(0)
        expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
      } finally {
        if (fault === 'directory') await db!.mediaContentDirectoryState.update({ where: { id: directory.id }, data: { generation: directory.generation } })
        if (fault === 'root') await db!.mediaContentDirectoryState.update({ where: { id: root.id }, data: { rootIdentity: root.rootIdentity } })
      }
    }
  }, 120_000)

  it('groups query prefixes, rolls the group back, and honors an immediate yield without candidate counts', async () => {
    const test = await fixture(24)
    await advanceTo(test.context, 'QUERY')
    await scanBatchedVisualVersions({ ...test.context, shouldYield: () => true })
    const first = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(first.visualCheckpoint).toMatchObject({ queryAfter: test.pages[0]!.imageId, queryImageId: 0 })
    failCommit = true
    await expect(scanBatchedVisualVersions(test.context)).rejects.toThrow('Injected transaction rollback')
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })).visualCheckpoint).toEqual(first.visualCheckpoint)
    const profile = new VisualSqlProfile(), beforeWrites = checkpointWrites
    sqlProfile = profile
    try { await scanBatchedVisualVersions({ ...test.context, shouldYield: () => checkpointWrites > beforeWrites }) } finally { sqlProfile = undefined }
    const next = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(next.visualCheckpoint).toMatchObject({ queryAfter: test.pages[8]!.imageId, queryImageId: 0 })
    expect(profile.result().bounds).toMatchObject({ queryRows: 8 })
    expect(profile.result().statements.filter(row => row.tables.includes('ArtworkDedupVisualCandidate'))).toHaveLength(0)
    expect(await scanBatchedVisualVersions(test.context)).toBe(true)
  })

  it('merges new and existing pair edges once while retaining the old partial-query cursor', async () => {
    const test = await fixture(24, 12, true)
    await advanceTo(test.context, 'QUERY')
    for (let iteration = 0; iteration < 2; iteration++) {
      const beforeWrites = checkpointWrites, profile = new VisualSqlProfile()
      sqlProfile = profile
      try { await scanBatchedVisualVersions({ ...test.context, shouldYield: () => checkpointWrites > beforeWrites }) } finally { sqlProfile = undefined }
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
      const pair = await db!.artworkDedupVisualCandidate.findFirstOrThrow({ where: { runId: test.runId } })
      expect(run.visualComparedComparisons).toBe((iteration + 1) * 24)
      expect(pair.edges).toHaveLength((iteration + 1) * 24)
      expect(run.visualCheckpoint).toMatchObject({ version: 1, queryImageId: test.pages[iteration ? 4 : 2]!.imageId, candidateAfter: test.pages[iteration ? 3 : 1]!.imageId })
      expect((run.visualCheckpoint as { queryCandidates: number[] }).queryCandidates).toEqual(test.pages.map(page => page.imageId))
      const postingReads = profile.result().statements.filter(row => row.operation === 'SELECT' && row.tables.includes('ArtworkDedupVisualPosting'))
      // The resumed query uses its already sorted persistent candidates; only
      // the following two new queries perform another posting lookup.
      expect(postingReads.reduce((sum, row) => sum + row.count, 0)).toBe(iteration ? 2 : 3)
      const candidateSql = profile.result().statements.filter(row => row.tables.includes('ArtworkDedupVisualCandidate'))
      expect(candidateSql.filter(row => row.sql.includes('COUNT(*)')).reduce((sum, row) => sum + row.count, 0)).toBe(iteration ? 0 : 1)
      expect(candidateSql.filter(row => row.operation === (iteration ? 'UPDATE' : 'INSERT')).reduce((sum, row) => sum + row.count, 0)).toBe(1)
    }
    const legacy = await matchVisualPages(test.pages, async () => {})
    expect(await scanBatchedVisualVersions({ ...test.context })).toBe(true)
    expect(await results(test.runId)).toEqual(expected(legacy.pairs))
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })).visualComparedComparisons).toBe(legacy.comparedComparisons)
  })

  it('stops at 51 guarded artworks without skipping the unaccepted candidate suffix', async () => {
    const test = await fixture(55, 1, true)
    for (const page of test.pages.slice(0, 7)) await db!.artworkDedupMedia.update({ where: { runId_artworkId_imageId: { runId: test.runId, artworkId: page.artworkId, imageId: page.imageId } }, data: { visualViews: views(0).map(view => ({ ...view, feature: { ...view.feature, information: Array<number>(10).fill(0) } })) } })
    await advanceTo(test.context, 'QUERY')
    const beforeWrites = checkpointWrites, profile = new VisualSqlProfile()
    sqlProfile = profile
    try { await scanBatchedVisualVersions({ ...test.context, shouldYield: () => checkpointWrites > beforeWrites }) } finally { sqlProfile = undefined }
    const first = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(first.visualCheckpoint).toMatchObject({ queryAfter: test.pages[6]!.imageId, queryImageId: test.pages[7]!.imageId, candidateAfter: test.pages[50]!.imageId })
    expect(first.visualComparedComparisons).toBe(43)
    expect(profile.result().bounds).toEqual({ queryRows: 8, candidateRows: 48, queryAndCandidateRows: 56, guardArtworks: 51 })
    expect(profile.result().statements.filter(row => row.operation === 'SELECT' && row.tables.includes('ArtworkDedupVisualPosting')).reduce((sum, row) => sum + row.count, 0)).toBe(1)
    await scanBatchedVisualVersions({ ...test.context, shouldYield: () => true })
    const next = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(next.visualCheckpoint).toMatchObject({ queryAfter: test.pages[7]!.imageId, queryImageId: 0, candidateAfter: 0 })
    expect(next.visualComparedComparisons).toBe(47)
  }, 60_000)

  it.each(['posting', 'candidate', 'comparison', 'pair'] as const)('commits an earlier valid query before a later %s budget failure', async budget => {
    const test = await fixture(4, 1)
    for (const [index, page] of test.pages.entries()) await db!.artworkDedupMedia.update({ where: { runId_artworkId_imageId: { runId: test.runId, artworkId: page.artworkId, imageId: page.imageId } }, data: { visualViews: views(index % 2) } })
    await advanceTo(test.context, 'QUERY')
    if (budget === 'posting' || budget === 'candidate') {
      const own = await db!.artworkDedupVisualPosting.findMany({ where: { runId: test.runId, imageId: test.pages[0]!.imageId } })
      const second = await db!.artworkDedupVisualPosting.findMany({ where: { runId: test.runId, imageId: test.pages[1]!.imageId } })
      const key = second.find(row => !own.some(first => first.key === row.key))!.key
      await db!.artworkDedupVisualPosting.createMany({ data: Array.from({ length: budget === 'posting' ? 5001 : 2001 }, (_, i) => ({ runId: test.runId, key, imageId: 1_000_000_000 + i, multiplicity: budget === 'posting' ? 4 : 1 })) })
    }
    if (budget === 'comparison') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { visualComparedComparisons: 199_999 } })
    if (budget === 'pair') await db!.artworkDedupVisualCandidate.createMany({ data: Array.from({ length: 999 }, (_, i) => ({ runId: test.runId, leftArtworkId: 1_000_000_000 + i, rightArtworkId: 1_000_001_000 + i })) })
    const beforeWrites = checkpointWrites
    expect(await scanBatchedVisualVersions({ ...test.context, shouldYield: () => checkpointWrites > beforeWrites })).toBe(false)
    const prefix = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(prefix.visualCheckpoint).toMatchObject({ queryAfter: test.pages[0]!.imageId, queryImageId: 0 })
    expect(prefix.visualComparedComparisons).toBe(budget === 'comparison' ? 200_000 : 1)
    const edges = await db!.artworkDedupVisualCandidate.findUniqueOrThrow({ where: { runId_leftArtworkId_rightArtworkId: { runId: test.runId, leftArtworkId: test.pages[0]!.artworkId, rightArtworkId: test.pages[2]!.artworkId } } })
    expect(edges.edges).toEqual([[test.pages[0]!.imageId, test.pages[2]!.imageId]])
    expect(await scanBatchedVisualVersions(test.context)).toBe(true)
    const failed = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(failed.visualCheckpoint).toEqual(prefix.visualCheckpoint)
    expect(failed.visualIncompleteReasons).toEqual([`VISUAL_${budget.toUpperCase()}_BUDGET`])
    expect(failed.visualComparedComparisons).toBe(prefix.visualComparedComparisons)
  }, 30_000)

  it.skipIf(process.env.ARTWORK_DEDUP_VISUAL_PROFILE_EXCLUSIVE !== '1')('profiles bounded SQL phases and preserves one representative fixture for A/B', async () => {
    const mode = process.env.ARTWORK_DEDUP_VISUAL_PROFILE_MODE ?? 'probe'
    const output = process.env.ARTWORK_DEDUP_VISUAL_PROFILE_OUTPUT
    const baselinePath = process.env.ARTWORK_DEDUP_VISUAL_PROFILE_BASELINE
    if (!output || !['probe', 'baseline', 'optimized'].includes(mode)) throw new Error('Explicit profiling output and mode are required')
    const count = mode === 'probe' ? 120 : 10_001
    const sourceSha256 = createHash('sha256').update(await readFile(new URL('../visual-batches.ts', import.meta.url))).digest('hex')
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex')
    type Initial = Pick<Prisma.ArtworkDedupRunGetPayload<Record<string, never>>, 'stage' | 'visualStatus' | 'visualIncompleteReasons' | 'visualCandidatePairs' | 'visualComparedComparisons' | 'visualReusedComparisons'>
    type Manifest = { runId: string; jobId: string; artistId: number; prefix: string; count: number; fixtureSha256: string; initial: Initial; resultSha256: string }
    let baseline: Manifest | undefined
    let runId: string, jobId: string, artistId: number, fixturePrefix: string, initial: Initial
    let context: DedupPipelineContext
    if (mode === 'optimized') {
      if (!baselinePath) throw new Error('The completed baseline manifest is required')
      baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Manifest
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: baseline.runId } })
      if (baseline.count !== count || !baseline.prefix.startsWith('visual-batches-') || run.requestedBy !== baseline.prefix || run.jobId !== baseline.jobId || run.artistId !== baseline.artistId || run.stage !== 'DONE' || run.visualStatus !== 'COMPLETE') throw new Error('Saved fixture identity/status mismatch')
      ;({ runId, jobId, artistId, prefix: fixturePrefix, initial } = baseline)
      preserveFixture = true
      runIds.push(runId); jobIds.push(jobId); artistIds.push(artistId); directoryPrefixes.push(fixturePrefix)
      context = fixtureContext(runId, jobId).context
    } else {
      if (mode === 'baseline') {
        try { await readFile(output); throw new Error('Refusing to replace an existing baseline manifest') } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
      const test = await fixture(count, mode === 'probe' ? 60 : 1000)
      ;({ runId, artistId, context } = test)
      jobId = context.execution.jobId; fixturePrefix = prefix
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
      initial = { stage: run.stage, visualStatus: run.visualStatus, visualIncompleteReasons: run.visualIncompleteReasons, visualCandidatePairs: run.visualCandidatePairs, visualComparedComparisons: run.visualComparedComparisons, visualReusedComparisons: run.visualReusedComparisons }
    }
    const inputDigest = async () => {
      const items = await db!.artworkDedupItem.findMany({ where: { runId }, orderBy: { artworkId: 'asc' }, select: { artworkId: true, status: true, frozenMediaRevision: true, snapshotRevision: true, mediaEpoch: true, memberCount: true } })
      const ids = items.map(item => item.artworkId)
      return digest({ items,
        media: await db!.artworkDedupMedia.findMany({ where: { runId }, orderBy: { imageId: 'asc' } }),
        images: await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { id: 'asc' }, include: { contentSource: true } }),
        artworks: await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, include: { contentSource: true } }),
        directories: await db!.mediaContentDirectoryState.findMany({ where: { logicalRoot: 'source-media:v1', relativeDirectory: { in: ['', fixturePrefix] } }, orderBy: { relativeDirectory: 'asc' } })
      })
    }
    const fixtureSha256 = await inputDigest()
    if (baseline) {
      expect(fixtureSha256).toBe(baseline.fixtureSha256)
      await db!.$transaction(async tx => {
        await resetArtworkDedupVisualWork(tx, runId)
        await tx.artworkDedupVisualPair.deleteMany({ where: { runId } })
        await tx.artworkDedupItem.updateMany({ where: { runId }, data: { visualSignature: null } })
        await tx.artworkDedupRun.update({ where: { id: runId }, data: initial })
      })
      expect(await inputDigest()).toBe(fixtureSha256)
    }
    const profile = new VisualSqlProfile()
    sqlProfile = profile
    metrics = { queries: 0, writes: 0, transactions: 0, maxMediaTake: 0 }
    const started = performance.now(), heapStart = process.memoryUsage().heapUsed
    measurementStarted = started; measurementCount = count
    let peakHeap = heapStart
    const sample = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed) }, 20)
    let measured: { elapsedMs: number; heapStart: number; peakHeap: number; maxRssBytes: number; queries: number; writes: number; transactions: number; maxMediaTake: number }
    try {
      expect(await scanBatchedVisualVersions(context, count)).toBe(true)
      measured = { elapsedMs: Math.round(performance.now() - started), heapStart, peakHeap, maxRssBytes: process.resourceUsage().maxRSS * 1024, ...metrics }
    } finally { clearInterval(sample); metrics = undefined; sqlProfile = undefined }
    expect(await inputDigest()).toBe(fixtureSha256)
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
    const outcome = { status: run.visualStatus, reasons: run.visualIncompleteReasons, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, candidates: run.visualCandidatePairs, results: await results(runId), postings: await db!.artworkDedupVisualPosting.count({ where: { runId } }) }
    expect(outcome.status).toBe('COMPLETE')
    expect(outcome.postings).toBe(count * 40)
    if (count === 10_001) { expect(outcome.results).toHaveLength(1); expect(outcome.compared).toBe(27_536) }
    const resultSha256 = digest(outcome)
    if (baseline) expect(resultSha256).toBe(baseline.resultSha256)
    expect(profile.result().bounds.queryRows).toBeLessThanOrEqual(8)
    expect(profile.result().bounds.candidateRows).toBeLessThanOrEqual(50)
    expect(profile.result().bounds.queryAndCandidateRows).toBeLessThanOrEqual(58)
    expect(profile.result().bounds.guardArtworks).toBeLessThanOrEqual(51)
    const summary = { mode, runId, jobId, artistId, prefix: fixturePrefix, count, initial, fixtureSha256, resultSha256,
      sourceSha256,
      measured, outcome, profile: profile.result() }
    await writeFile(output, JSON.stringify(summary, null, 2) + '\n')
    preserveFixture = mode === 'baseline'
    console.info('F03_SQL_PROFILE ' + JSON.stringify({ mode, count, fixtureSha256, resultSha256, measured, output }))
  }, 900_000)

  // Explicit single-fixture A/B: the saved baseline module is supplied by the
  // reproduction script, and neither version can access original media.
  it.skipIf(process.env.ARTWORK_DEDUP_VISUAL_AB_EXCLUSIVE !== '1')('compares the same prepared fixture before and after roundtrip consolidation', async () => {
    const baselinePath = process.env.ARTWORK_DEDUP_VISUAL_AB_BASELINE
    if (!baselinePath) throw new Error('A saved baseline module is required')
    const count = Number(process.env.ARTWORK_DEDUP_VISUAL_AB_COUNT ?? 120)
    if (![120, 10_001].includes(count)) throw new Error('Only the bounded smoke and representative fixtures are supported')
    const baseline = await import(/* @vite-ignore */ baselinePath) as { scanBatchedVisualVersions: typeof scanBatchedVisualVersions }
    const test = await fixture(count)
    const initial = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex')
    const inputDigest = async () => digest({
      media: await db!.artworkDedupMedia.findMany({ where: { runId: test.runId }, orderBy: { imageId: 'asc' } }),
      items: await db!.artworkDedupItem.findMany({ where: { runId: test.runId }, orderBy: { artworkId: 'asc' }, select: { artworkId: true, frozenMediaRevision: true, snapshotRevision: true, mediaEpoch: true, memberCount: true, status: true } }),
      directories: await db!.mediaContentDirectoryState.findMany({ where: { logicalRoot: 'source-media:v1', relativeDirectory: { in: ['', prefix] } }, orderBy: { relativeDirectory: 'asc' } })
    })
    const fixtureSha256 = await inputDigest()
    const observations: Array<Record<string, unknown>> = []
    let baselineResult: unknown
    for (const [label, scan] of [['baseline', baseline.scanBatchedVisualVersions], ['optimized', scanBatchedVisualVersions]] as const) {
      expect(await inputDigest()).toBe(fixtureSha256)
      metrics = { queries: 0, writes: 0, transactions: 0, maxMediaTake: 0 }
      const started = performance.now(), heapStart = process.memoryUsage().heapUsed
      measurementStarted = started; measurementCount = count
      let peakHeap = heapStart
      const sample = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed) }, 20)
      let measured: { elapsedMs: number; heapStart: number; peakHeap: number; maxRssBytes: number; queries: number; writes: number; transactions: number; maxMediaTake: number }
      try {
        expect(await scan(test.context, count)).toBe(true)
        measured = { elapsedMs: Math.round(performance.now() - started), heapStart, peakHeap, maxRssBytes: process.resourceUsage().maxRSS * 1024, ...metrics }
      } finally { clearInterval(sample); metrics = undefined }
      expect(await inputDigest()).toBe(fixtureSha256)
      const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
      const outcome = { status: run.visualStatus, reasons: run.visualIncompleteReasons, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, candidates: run.visualCandidatePairs, results: await results(test.runId), postings: await db!.artworkDedupVisualPosting.count({ where: { runId: test.runId } }) }
      expect(outcome.status).toBe('COMPLETE')
      expect(outcome.postings).toBe(count * 40)
      expect(measured.maxMediaTake).toBeLessThanOrEqual(2000)
      if (count === 10_001) { expect(outcome.results).toHaveLength(1); expect(outcome.compared).toBe(27_536) }
      if (label === 'baseline') baselineResult = outcome
      else expect(outcome).toEqual(baselineResult)
      const observation = { label, count, fixtureSha256, resultSha256: digest(outcome), ...measured, compared: outcome.compared, reused: outcome.reused, candidates: outcome.candidates.length, postings: outcome.postings, originalBytes: 0, visualCalls: 0 }
      observations.push(observation)
      console.info('F03_ROUNDTRIP_AB ' + JSON.stringify(observation))
      if (label === 'baseline') await db!.$transaction(async tx => {
        await resetArtworkDedupVisualWork(tx, test.runId)
        await tx.artworkDedupVisualPair.deleteMany({ where: { runId: test.runId } })
        await tx.artworkDedupItem.updateMany({ where: { runId: test.runId }, data: { visualSignature: null } })
        await tx.artworkDedupRun.update({ where: { id: test.runId }, data: { stage: initial.stage, visualStatus: initial.visualStatus, visualIncompleteReasons: initial.visualIncompleteReasons, visualCandidatePairs: initial.visualCandidatePairs, visualComparedComparisons: initial.visualComparedComparisons, visualReusedComparisons: initial.visualReusedComparisons } })
      })
    }
    expect(Number(observations[1]!.transactions)).toBeLessThan(Number(observations[0]!.transactions))
    expect(Number(observations[1]!.queries)).toBeLessThan(Number(observations[0]!.queries))
    console.info('F03_ROUNDTRIP_FIXTURE ' + JSON.stringify({ count, fixtureSha256, baselineModuleSha256: createHash('sha256').update(await readFile(baselinePath)).digest('hex'), seed: 'sha256(`${seed}:${region}`), last artwork first page seed=0', groupSize: 1000, views: 1, regions: 10, postingsPerPage: 40, observations }))
  }, 1_200_000)

  // Run alone: these prepared-feature measurements must not silently join ordinary PG suites.
  it.skipIf(process.env.ARTWORK_DEDUP_VISUAL_SCALE_EXCLUSIVE !== '1').each([10_000, 10_001])('indexes and compares %i synthetic pages across artwork batches with bounded loads', async count => {
    const test = await fixture(count)
    const legacy = count === 10_000 ? await matchVisualPages(test.pages, async () => {}) : null
    metrics = { queries: 0, writes: 0, transactions: 0, maxMediaTake: 0 }
    const started = performance.now(), heapStart = process.memoryUsage().heapUsed
    measurementStarted = started; measurementCount = count
    let peak = heapStart
    const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed) }, 20)
    try { expect(await scanBatchedVisualVersions(test.context, count)).toBe(true) } finally { clearInterval(sample) }
    const measured = { count, elapsedMs: Math.round(performance.now() - started), heapStart, peakHeap: peak, maxRssBytes: process.resourceUsage().maxRSS * 1024, ...metrics }
    metrics = undefined
    expect(measured.maxMediaTake).toBeLessThanOrEqual(2000)
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
    expect(run.visualStatus).toBe('COMPLETE')
    expect(await db!.artworkDedupVisualPosting.count({ where: { runId: test.runId } })).toBe(count * 40)
    if (legacy) { expect(await results(test.runId)).toEqual(expected(legacy.pairs)); expect(run.visualComparedComparisons).toBe(legacy.comparedComparisons) }
    else {
      const pairs = await results(test.runId)
      expect(pairs).toHaveLength(1)
      expect(pairs[0]).toMatchObject({ left: test.pages[0]!.artworkId, right: test.pages.at(-1)!.artworkId })
    }
    console.info('F03_SYNTHETIC ' + JSON.stringify({ ...measured, compared: run.visualComparedComparisons, candidates: run.visualCandidatePairs.length, postings: count * 40, originalBytes: 0, visualCalls: 0 }))
  }, 600_000)

  it('keeps the public 10k cap and posting multiplicity budget', async () => {
    const publicCap = await fixture(10_001)
    expect(await scanBatchedVisualVersions(publicCap.context)).toBe(true)
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: publicCap.runId } })).visualIncompleteReasons).toEqual(['VISUAL_FILE_BUDGET'])
    expect(await db!.artworkDedupVisualPosting.count({ where: { runId: publicCap.runId } })).toBe(0)
    const dense = await fixture(126, 63, true)
    for (const page of dense.pages) page.views = Array.from({ length: 4 }, () => page.views[0]!)
    await db!.artworkDedupMedia.updateMany({ where: { runId: dense.runId }, data: { visualViews: dense.pages[0]!.views as unknown as Prisma.InputJsonValue } })
    expect(await scanBatchedVisualVersions(dense.context)).toBe(true)
    expect((await db!.artworkDedupRun.findUniqueOrThrow({ where: { id: dense.runId } })).visualIncompleteReasons).toEqual(['VISUAL_POSTING_BUDGET'])
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: dense.runId } })).toBe(0)
  }, 120_000)
})
