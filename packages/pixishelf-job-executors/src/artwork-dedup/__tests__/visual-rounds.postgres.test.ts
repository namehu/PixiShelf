import { createHash, randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { Prisma, PrismaClient, captureArtworkContentSnapshot, captureMediaContentDirectory, ARTWORK_DEDUP_RELATION_CACHE_VERSION } from '@pixishelf/db'
import { MutableQueueClock, PostgresQueueRepository, type QueueDatabase } from '@pixishelf/job-runtime'
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { matchVisualPages, VISUAL_LIMITS, type VisualPage } from '../visual-matching.ts'
import type { DedupPipelineContext } from '../pipeline.ts'

const testLimits = vi.hoisted(() => ({ comparisons: 137, edgesPerPair: 900 }))
vi.mock('../visual-matching.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../visual-matching.ts')>()
  return { ...actual, VISUAL_LIMITS: { ...actual.VISUAL_LIMITS, ...testLimits } }
})
let productionConstraint = ''
beforeAll(async () => {
  if (!db) return
  const [constraint] = await db.$queryRaw<Array<{ definition: string }>>(Prisma.sql`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='artwork_dedup_relation_cache_bounds'`)
  productionConstraint = constraint!.definition
  // Only this exact isolated DB uses the reduced round limit; all other clauses remain intact.
  const small = productionConstraint.replaceAll('200000', String(testLimits.comparisons))
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT artwork_dedup_relation_cache_bounds')
    await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT artwork_dedup_relation_cache_bounds ' + small)
  })
})

// This opt-in suite owns its entire root identity and queue lane. It must not
// accidentally join the generic PostgreSQL suites or the long scale measure.
const url = process.env.ARTWORK_DEDUP_BUDGET_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/f03_budget_continue_20261028') {
    throw new Error('Budget tests require their own f03_budget_continue_20261028 database on 127.0.0.1:55432')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `budget-rounds-${randomUUID()}`
const artistIds: number[] = [], imageIds: number[] = [], runIds: string[] = [], jobIds: string[] = []
let checkpointWrites = 0
db?.$on('query', event => {
  if (/^UPDATE .*ArtworkDedupRun/.test(event.query) && event.query.includes('visualCheckpoint')) checkpointWrites++
})
afterAll(async () => {
  if (!db) return
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runIds } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.image.deleteMany({ where: { id: { in: imageIds } } })
  await db.artwork.deleteMany({ where: { creators: { some: { artistId: { in: artistIds } } } } })
  await db.artist.deleteMany({ where: { id: { in: artistIds } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: prefix } })
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT artwork_dedup_relation_cache_bounds')
    await tx.$executeRawUnsafe('ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT artwork_dedup_relation_cache_bounds ' + productionConstraint)
  })
  await db.$disconnect()
}, 60_000)

type Fixture = Awaited<ReturnType<typeof fixture>>
type Cursor = { phase: string; queryAfter: number; queryImageId: number; candidateAfter: number; queryCandidates: number[] }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function views(informative: boolean): VisualPage['views'] {
  return [{ name: 'original', feature: { width: 96, height: 96,
    hashes: Array.from({ length: 10 }, (_, i) => sha(`shared-template:${i}`).slice(0, 16)),
    information: Array<number>(10).fill(informative ? 30 : 0) } }]
}

// Nine zero-posting queries straddle the eight-query boundary. Every later
// query has 90 candidates; exact SHA anchors leave one unambiguous visual page.
async function fixture(counts = [9, 30, 30, 30]) {
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
      sha256: sha(group && index < 29 ? `exact-anchor:${index}` : `unique:${image.id}`), views: views(group > 0) })))
  }
  const jobId = randomUUID(); jobIds.push(jobId)
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 6, executionLane: 'BACKGROUND_WRITER', status: 'PENDING',
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
    visualStatus: 'READY', visualViews: page.views as unknown as Prisma.InputJsonValue })) })
  return { runId: run.id, jobId, pages }
}
function context(test: Fixture, executionVersion = 1): DedupPipelineContext {
  return { execution: { runId: test.runId, jobId: test.jobId, executionVersion }, signal: new AbortController().signal, forceRead: true,
    roots: {} as DedupPipelineContext['roots'], reader: { visual() { throw new Error('Synthetic features must never decode') } } as unknown as DedupPipelineContext['reader'],
    shouldYield: () => false, transaction: operation => db!.$transaction(operation, { timeout: 30_000 }) }
}
const run = (test: Fixture) => db!.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })
async function state(test: Fixture) {
  const row = await run(test)
  return { checkpoint: row.visualCheckpoint, compared: row.visualComparedComparisons, reused: row.visualReusedComparisons,
    candidatePairs: row.visualCandidatePairs, reasons: row.visualIncompleteReasons, stage: row.stage, status: row.visualStatus,
    candidates: await db!.artworkDedupVisualCandidate.findMany({ where: { runId: test.runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }],
      select: { leftArtworkId: true, rightArtworkId: true, edges: true, evidence: true, reused: true } }),
    pairs: await db!.artworkDedupVisualPair.findMany({ where: { runId: test.runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }],
      select: { leftArtworkId: true, rightArtworkId: true, summary: true, pages: { orderBy: { ordinal: 'asc' }, select: { ordinal: true, kind: true, leftImageId: true, rightImageId: true, leftIndex: true, rightIndex: true } } } }) }
}
async function slice(test: Fixture, fresh = context(test)) {
  const before = checkpointWrites
  return scanBatchedVisualVersions({ ...fresh, shouldYield: () => checkpointWrites > before }, undefined, true)
}
async function advanceToQuery(test: Fixture) {
  for (let i = 0; i < 15; i++) {
    if ((await run(test)).visualCheckpoint && ((await run(test)).visualCheckpoint as Cursor).phase === 'QUERY') return
    expect(await slice(test)).toBe(false)
  }
  throw new Error('QUERY not reached')
}
function expectedPrefix(test: Fixture, checkpoint: Cursor) {
  const edges: Array<[number, number]> = []
  for (const query of test.pages.slice(9)) for (const candidate of test.pages.slice(9)) {
    if (query.artworkId < candidate.artworkId && (query.imageId <= checkpoint.queryAfter || query.imageId === checkpoint.queryImageId && candidate.imageId <= checkpoint.candidateAfter)) edges.push([query.imageId, candidate.imageId])
  }
  return edges
}
function flatEdges(current: Awaited<ReturnType<typeof state>>) {
  return current.candidates.flatMap(candidate => candidate.edges as Array<[number, number]>).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}


async function resumeFixture(test: Fixture) {
  // The domain command's CAS/idempotency is separately exercised in App tests.
  const row = await run(test)
  expect(row.visualBudgetWaiting).toBe(true)
  await db!.artworkDedupRun.update({ where: { id: test.runId }, data: {
    visualBudgetWaiting: false, visualComparisonRound: { increment: 1 },
    visualRoundStartComparisons: row.visualComparedComparisons + row.visualReusedComparisons
  } })
}
async function finishRounds(test: Fixture, fresh = () => context(test)) {
  let rounds = 0
  while (!(await scanBatchedVisualVersions(fresh(), undefined, true))) {
    if (++rounds > 30) throw new Error('Too many fixture rounds')
    const row = await run(test)
    expect(row.visualBudgetWaiting).toBe(true)
    expect(row.visualComparedComparisons + row.visualReusedComparisons - row.visualRoundStartComparisons).toBe(testLimits.comparisons)
    expect(row.visualStatus).toBe('PENDING')
    expect(row.visualIncompleteReasons).toEqual([])
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
    await resumeFixture(test)
  }
  return rounds
}

suite('F03 v6 explicit visual comparison rounds', () => {
  it('retains every legal prefix across candidate blocks and fresh contexts, then matches the complete oracle', async () => {
    const test = await fixture()
    const oracle = await matchVisualPages(test.pages, async () => {})
    expect(oracle.reason).toBeNull()
    let rounds = 0
    for (;;) {
      const done = await scanBatchedVisualVersions(context(test), undefined, true)
      const current = await state(test)
      if (done) {
        expect(current.compared).toBe(oracle.comparedComparisons)
        expect(current.candidatePairs).toEqual(oracle.candidatePairs)
        expect(current.pairs.map(pair => pair.pages.map(page => [page.kind, page.leftImageId, page.rightImageId]))).toEqual(oracle.pairs.map(pair => pair.pages.map(page => [page.kind, page.left?.imageId ?? null, page.right?.imageId ?? null])))
        expect(flatEdges(current)).toHaveLength(2700)
        expect(rounds).toBe(19)
        break
      }
      const row = await run(test)
      expect(row.visualBudgetWaiting).toBe(true)
      expect(row.visualComparedComparisons).toBe((rounds + 1) * testLimits.comparisons)
      expect(flatEdges(current)).toEqual(expectedPrefix(test, current.checkpoint as Cursor))
      // Repeated scheduler calls, a fresh process context, and a normal yield do not grant permission.
      expect(await scanBatchedVisualVersions(context(test), undefined, true)).toBe(false)
      expect(await slice(test)).toBe(false)
      expect(await state(test)).toEqual(current)
      expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
      await resumeFixture(test)
      if (++rounds > 25) throw new Error('Fixture stalled')
    }
  }, 60_000)

  it('charges mixed reused and newly compared candidates across rounds without changing evidence', async () => {
    const cold = await fixture()
    await finishRounds(cold)
    const expected = await state(cold)
    await db!.artworkDedupRun.update({ where: { id: cold.runId }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
    const old = await run(cold), jobId = randomUUID(); jobIds.push(jobId)
    await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 6, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
    const current = await db!.artworkDedupRun.create({ data: { artistId: old.artistId, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'INCREMENTAL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: old.visualAfterImageId } }); runIds.push(current.id)
    const items = await db!.artworkDedupItem.findMany({ where: { runId: old.id } })
    await db!.artworkDedupItem.createMany({ data: items.map(item => ({ ...item, runId: current.id, visualSignature: null, visualReuseSignature: null })) })
    const media = await db!.artworkDedupMedia.findMany({ where: { runId: old.id } })
    await db!.artworkDedupMedia.createMany({ data: media.map(row => ({ ...row, runId: current.id, visualViews: row.visualViews as Prisma.InputJsonValue })) })
    const hot = { ...cold, runId: current.id, jobId }, fresh = () => ({ ...context(hot), forceRead: false })
    for (let i = 0; i < 20; i++) {
      if (((await run(hot)).visualCheckpoint as Cursor | null)?.phase === 'QUERY') break
      expect(await slice(hot, fresh())).toBe(false)
    }
    expect(((await run(hot)).visualCheckpoint as Cursor).phase).toBe('QUERY')
    // Model one unavailable relationship signature after the complete reuse snapshot.
    const uncached = cold.pages[69]!.artworkId
    await db!.artworkDedupItem.update({ where: { runId_artworkId: { runId: hot.runId, artworkId: uncached } }, data: { visualReuseSignature: null } })
    await db!.artworkDedupVisualCandidate.deleteMany({ where: { runId: hot.runId, OR: [{ leftArtworkId: uncached }, { rightArtworkId: uncached }] } })
    expect(await finishRounds(hot, fresh)).toBe(19)
    const mixed = await state(hot)
    expect([mixed.compared, mixed.reused]).toEqual([1800, 900])
    expect(mixed.candidatePairs).toEqual(expected.candidatePairs)
    expect(mixed.pairs).toEqual(expected.pairs)
  }, 60_000)

  it('a lost execution lease cannot commit a round boundary', async () => {
    const test = await fixture()
    await advanceToQuery(test)
    await slice(test)
    await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { visualComparedComparisons: testLimits.comparisons - 1 } })
    const before = await state(test)
    const clock = new MutableQueueClock(new Date('2030-01-01'))
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock })
    await db!.systemJob.update({ where: { id: test.jobId }, data: { availableAt: clock.now(), payload: { runId: test.runId, executionVersion: 1 } } })
    const claimed = (await repository.claim(prefix, [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [6] }]))!
    expect(claimed.id).toBe(test.jobId)
    const fence = { jobId: claimed.id, workerId: claimed.workerId, executionToken: claimed.executionToken, attempt: claimed.attempt }
    let invalidated = false
    await expect(scanBatchedVisualVersions({ ...context(test), transaction: async operation => {
      const result = await repository.withFencedMutationTransaction(fence, operation)
      if (!invalidated && result && typeof result === 'object' && 'query' in result && result.query) {
        invalidated = true
        await db!.systemJob.update({ where: { id: test.jobId }, data: { leaseToken: randomUUID() } })
      }
      return result
    } }, undefined, true)).rejects.toThrow()
    expect(await state(test)).toEqual(before)
    expect((await run(test)).visualBudgetWaiting).toBe(false)
    await db!.jobResourceLease.deleteMany({ where: { ownerJobId: test.jobId } })
    await db!.systemJob.update({ where: { id: test.jobId }, data: { status: 'FAILED', leaseToken: null, leaseExpiresAt: null, workerId: null } })
  })

  it('does not require an empty round when the final comparison uses the last permitted unit', async () => {
    // 1×5 + 1×22 + 5×22 = 137 actual candidate comparisons.
    const test = await fixture([9, 1, 5, 22])
    const oracle = await matchVisualPages(test.pages, async () => {})
    expect(oracle.comparedComparisons).toBe(testLimits.comparisons)
    expect(await finishRounds(test)).toBe(0)
    expect(await run(test)).toMatchObject({ visualComparedComparisons: 137, visualComparisonRound: 1, visualBudgetWaiting: false, stage: 'DONE' })
  }, 60_000)

  it('keeps v5 terminal comparison semantics and never sets continuation permission', async () => {
    const test = await fixture()
    await db!.systemJob.update({ where: { id: test.jobId }, data: { definitionVersion: 5 } })
    expect(await scanBatchedVisualVersions(context(test))).toBe(true)
    expect(await run(test)).toMatchObject({ stage: 'DONE', visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['VISUAL_COMPARISON_BUDGET'], visualComparisonRound: 0, visualBudgetWaiting: false })
    expect(await db!.artworkDedupVisualPair.count({ where: { runId: test.runId } })).toBe(0)
  })

  it('keeps single-pair edge capacity a terminal structural limit across rounds', async () => {
    const test = await fixture()
    await advanceToQuery(test)
    const left = test.pages[9]!, right = test.pages[39]!
    await db!.artworkDedupVisualCandidate.create({ data: { runId: test.runId, leftArtworkId: left.artworkId, rightArtworkId: right.artworkId,
      edges: Array.from({ length: testLimits.edgesPerPair }, () => [left.imageId, right.imageId]) } })
    expect(await scanBatchedVisualVersions(context(test), undefined, true)).toBe(true)
    expect(await run(test)).toMatchObject({ stage: 'DONE', visualStatus: 'INCOMPLETE', visualIncompleteReasons: ['VISUAL_EDGE_BUDGET'], visualBudgetWaiting: false })
  })

  it.each(['source', 'directory', 'cancel', 'execution', 'rollback'] as const)('does not commit a budget boundary after %s invalidates it', async fault => {
    const test = await fixture()
    await advanceToQuery(test)
    await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { visualComparedComparisons: testLimits.comparisons - 1 } })
    await slice(test) // Commit the eight leading zero-candidate queries before the fault.
    const before = await state(test)
    let fired = false
    const ordinary = context(test)
    const guarded: DedupPipelineContext = { ...ordinary, transaction: async operation => {
      const result = await db!.$transaction(async tx => {
        const result = await operation(tx)
        if (fault === 'rollback' && (await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: test.runId } })).visualBudgetWaiting) throw new Error('Injected budget rollback')
        return result
      })
      if (!fired && result && typeof result === 'object' && 'query' in result && result.query) {
        fired = true
        if (fault === 'source') await db!.artwork.update({ where: { id: test.pages[9]!.artworkId }, data: { mediaRevision: { increment: 1 } } })
        if (fault === 'directory') await db!.mediaContentDirectoryState.updateMany({ where: { rootIdentity: prefix, relativeDirectory: prefix }, data: { generation: { increment: 1 } } })
        if (fault === 'cancel') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { status: 'CANCELLING' } })
        if (fault === 'execution') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: { increment: 1 } } })
      }
      return result
    } }
    await expect(scanBatchedVisualVersions(guarded, undefined, true)).rejects.toThrow()
    expect(await state(test)).toEqual(before)
    expect((await run(test)).visualBudgetWaiting).toBe(false)
    if (fault === 'directory') await db!.mediaContentDirectoryState.updateMany({ where: { rootIdentity: prefix, relativeDirectory: prefix }, data: { generation: { decrement: 1 } } })
  })
})
