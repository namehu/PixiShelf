import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma, captureArtworkContentSnapshot, captureMediaContentDirectory, resetArtworkDedupVisualWork, ARTWORK_DEDUP_RELATION_CACHE_VERSION } from '@pixishelf/db'
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { matchVisualPages, type VisualPage } from '../visual-matching.ts'
import type { DedupPipelineContext } from '../pipeline.ts'

// Synthetic features exercise the real persisted index/query path, not image decoding.
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `visual-batches-${randomUUID()}`
const artistIds: number[] = [], runIds: string[] = [], jobIds: string[] = []
let metrics: { queries: number; writes: number; transactions: number; maxMediaTake: number } | undefined
let rootIdentity = prefix
beforeAll(async () => { if (db) rootIdentity = (await db.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } }))?.rootIdentity ?? prefix })
let measurementStarted = 0, measurementCount = 0
let checkpointWrites = 0
let failCommit = false

db?.$on('query', event => {
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
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runIds } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.artwork.deleteMany({ where: { creators: { some: { artistId: { in: artistIds } } } } })
  await db.artist.deleteMany({ where: { id: { in: artistIds } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { OR: [{ relativeDirectory: prefix }, ...(rootIdentity === prefix ? [{ rootIdentity: prefix }] : [])] } })
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
    const snapshot = await db!.$transaction(tx => captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
    if (snapshot.status !== 'READY') throw new Error('Synthetic snapshot unavailable')
    artworks.push({ id: artwork.id, revision: (await db!.artwork.findUniqueOrThrow({ where: { id: artwork.id } })).mediaRevision, snapshot: snapshot.value })
    for (const [i, image] of images.entries()) {
      const seed = dense || start > 0 && start + length === count && i === 0 ? 0 : start + i
      pages.push({ imageId: image.id, artworkId: artwork.id, index: i, size: 100n, sha256: createHash('sha256').update(String(image.id)).digest('hex'), views: views(seed) })
    }
  }
  const jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: pages.at(-1)!.imageId } })
  runIds.push(run.id)
  const directory = await db!.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix } }))
  if (directory.status !== 'READY') throw new Error('Synthetic directory unavailable')
  await db!.artworkDedupItem.createMany({ data: artworks.map(a => ({ runId: run.id, artworkId: a.id, frozenMediaRevision: a.revision, status: 'COMPLETE', snapshotRevision: a.snapshot.revision, mediaEpoch: a.snapshot.mediaEpoch, memberCount: a.snapshot.memberCount })) })
  for (let start = 0; start < pages.length; start += 500) await db!.artworkDedupMedia.createMany({ data: pages.slice(start, start + 500).map(p => ({ runId: run.id, artworkId: p.artworkId, imageId: p.imageId,
    sourcePath: `${prefix}/${p.artworkId}/${p.index}.png`, sourceRevision: 0n, logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix,
    directoryId: directory.value.directoryId, directoryGeneration: directory.value.generation, canonicalPath: `${prefix}/${p.artworkId}/${p.index}.png`, size: p.size, sha256: p.sha256,
    visualStatus: 'READY', visualViews: p.views as unknown as Prisma.InputJsonValue })) })
  let candidateReads = 0
  const measuredDb = db!.$extends({ query: { artworkDedupMedia: { async findMany({ args, query }) {
    const result = await query(args)
    if (args.include?.item && args.where?.imageId && typeof args.where.imageId === 'object' && 'in' in args.where.imageId) candidateReads++
    if (metrics) metrics.maxMediaTake = Math.max(metrics.maxMediaTake, result.length)
    return result
  } } } })
  const context: DedupPipelineContext = {
    execution: { runId: run.id, jobId, executionVersion: 1 }, signal: new AbortController().signal, forceRead: true,
    roots: {} as DedupPipelineContext['roots'], reader: { visual() { throw new Error('Synthetic features must never decode') } } as unknown as DedupPipelineContext['reader'], shouldYield: () => false,
    transaction: operation => measuredDb.$transaction(async tx => {
      const before = checkpointWrites
      const result = await operation(tx as unknown as Prisma.TransactionClient)
      if (failCommit && checkpointWrites > before) { failCommit = false; throw new Error('Injected transaction rollback') }
      return result
    }, { timeout: 120_000 })
  }
  return { context, pages, runId: run.id, artistId: artist.id, candidateReads: () => candidateReads }
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
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: old.artistId, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'INCREMENTAL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: old.visualAfterImageId } })
  runIds.push(run.id)
  const items = await db!.artworkDedupItem.findMany({ where: { runId: old.id } })
  await db!.artworkDedupItem.createMany({ data: items.map(i => ({ ...i, runId: run.id, visualSignature: null, visualReuseSignature: null })) })
  const media = await db!.artworkDedupMedia.findMany({ where: { runId: old.id } })
  await db!.artworkDedupMedia.createMany({ data: media.map(m => ({ ...m, runId: run.id, visualViews: m.visualViews as Prisma.InputJsonValue })) })
  return { ...context, forceRead: false, execution: { runId: run.id, jobId, executionVersion: 1 } }
}
suite('F03 persistent visual batches', () => {
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
