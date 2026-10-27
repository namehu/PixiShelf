import { createHash, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Prisma, PrismaClient, captureArtworkContentSnapshot, captureMediaContentDirectory, resetArtworkDedupVisualWork } from '@pixishelf/db'
import { MutableQueueClock, PostgresQueueRepository, type ClaimedJob, type QueueDatabase } from '@pixishelf/job-runtime'
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { matchVisualPages, VISUAL_LIMITS, type VisualPage } from '../visual-matching.ts'
import type { DedupPipelineContext } from '../pipeline.ts'

// This opt-in suite owns its entire root identity and queue lane. It must not
// accidentally join the generic PostgreSQL suites or the long scale measure.
const url = process.env.ARTWORK_DEDUP_DENSE_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !target.pathname.startsWith('/f03_dense_resume_')) {
    throw new Error('Dense recovery tests require their own f03_dense_resume_* database on 127.0.0.1:55432')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `dense-resume-${randomUUID()}`
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
async function fixture() {
  const artist = await db!.artist.create({ data: { name: prefix } }); artistIds.push(artist.id)
  const pages: VisualPage[] = []
  const items: Array<{ artworkId: number; frozenMediaRevision: number; snapshotRevision: bigint; mediaEpoch: bigint; memberCount: bigint }> = []
  for (let group = 0; group < 4; group++) {
    const artwork = await db!.artwork.create({ data: { title: prefix, source: 'LOCAL_IMPORT', creators: { create: {
      artistId: artist.id, evidence: { create: { provenance: 'MANUAL', evidenceKey: randomUUID(), present: true } }
    } } } })
    await db!.image.createMany({ data: Array.from({ length: group ? 30 : 9 }, (_, index) => ({ artworkId: artwork.id, sortOrder: index, path: `${prefix}/${artwork.id}/${index}.png` })) })
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
  await db!.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING',
    triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date('2100-01-01'), payload: {} } })
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId,
    status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualAfterImageId: pages.at(-1)!.imageId } }); runIds.push(run.id)
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
  return scanBatchedVisualVersions({ ...fresh, shouldYield: () => checkpointWrites > before })
}
async function advanceToQuery(test: Fixture) {
  for (let i = 0; i < 15; i++) {
    if ((await run(test)).visualCheckpoint && ((await run(test)).visualCheckpoint as Cursor).phase === 'QUERY') return
    expect(await slice(test)).toBe(false)
  }
  throw new Error('QUERY not reached')
}
async function firstDensePrefix(test: Fixture) {
  await advanceToQuery(test)
  for (let i = 0; i < 12; i++) {
    await slice(test)
    const current = await state(test)
    if ((current.checkpoint as Cursor).queryImageId) {
      expect(current.compared).toBe(20)
      expect(current.checkpoint).toMatchObject({ queryAfter: test.pages[8]!.imageId, queryImageId: test.pages[9]!.imageId, candidateAfter: test.pages[58]!.imageId })
      return current
    }
  }
  throw new Error('Dense prefix not reached')
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

suite('F03 dense template persisted recovery', () => {
  it('matches uninterrupted evidence and every exact prefix after rebuilding context at each durable slice', async () => {
    const test = await fixture()
    const legacy = await matchVisualPages(test.pages, async () => {})
    expect(legacy.reason).toBeNull(); expect(legacy.pairs).toHaveLength(3)
    expect(legacy.pairs.map(pair => pair.pages.map(page => page.kind))).toEqual(Array.from({ length: 3 }, () => [...Array<string>(29).fill('EXACT'), 'SIMILAR']))
    expect(await scanBatchedVisualVersions(context(test))).toBe(true)
    const uninterrupted = await state(test)
    expect(uninterrupted.compared).toBe(2700)
    expect(uninterrupted.pairs.map(pair => pair.pages.map(page => [page.kind, page.leftImageId, page.rightImageId]))).toEqual(legacy.pairs.map(pair => pair.pages.map(page => [page.kind, page.left?.imageId ?? null, page.right?.imageId ?? null])))
    await db!.$transaction(async tx => {
      await resetArtworkDedupVisualWork(tx, test.runId)
      await tx.artworkDedupVisualPair.deleteMany({ where: { runId: test.runId } })
      await tx.artworkDedupRun.update({ where: { id: test.runId }, data: { stage: 'VISUAL', visualStatus: 'PENDING', visualComparedComparisons: 0, visualReusedComparisons: 0, visualCandidatePairs: [], visualIncompleteReasons: [] } })
    })
    const completedQueries = new Set<number>(), partialPositions = new Set<number>()
    let slices = 0
    for (;;) {
      const done = await slice(test, context(test))
      const current = await state(test), checkpoint = current.checkpoint as Cursor
      if (checkpoint.phase === 'QUERY' || checkpoint.phase === 'PAIR') {
        const expected = expectedPrefix(test, checkpoint)
        expect(flatEdges(current)).toEqual(expected)
        expect(current.compared).toBe(expected.length)
        expect(new Set(flatEdges(current).map(edge => edge.join(':'))).size).toBe(expected.length)
        completedQueries.add(checkpoint.queryAfter)
        if (checkpoint.queryImageId) partialPositions.add(checkpoint.queryCandidates.indexOf(checkpoint.candidateAfter) + 1)
      }
      if (done) break
      expect(current.status).not.toBe('COMPLETE'); expect(current.pairs).toEqual([])
      if (++slices > 250) throw new Error('Dense cursor stalled')
    }
    expect(completedQueries.has(test.pages[7]!.imageId)).toBe(true)
    expect(completedQueries.has(test.pages[8]!.imageId)).toBe(true)
    // 90 candidates modulo 50 slots moves the durable cursor both before and
    // after the 50-slot boundary, including suffix+next-query grouped commits.
    expect([...partialPositions].sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
    expect(await state(test)).toEqual(uninterrupted)
    console.info('F03_DENSE_RESUME ' + JSON.stringify({ pages: 99, denseCandidatesPerQuery: 90, comparisons: 2700, pairs: 3, slices, partialPositions: [...partialPositions].sort((a, b) => a - b) }))
  }, 120_000)

  it.each(['posting', 'candidate', 'comparison', 'pair'] as const)('keeps a committed dense prefix terminal and unpublished after %s exhaustion across a recreated context', async budget => {
    const test = await fixture(), prefixState = await firstDensePrefix(test)
    if (budget === 'posting' || budget === 'candidate') {
      const posting = await db!.artworkDedupVisualPosting.findFirstOrThrow({ where: { runId: test.runId, imageId: test.pages[9]!.imageId } })
      await db!.artworkDedupVisualPosting.createMany({ data: Array.from({ length: budget === 'posting' ? 5001 : 2001 }, (_, i) => ({ runId: test.runId, key: posting.key, imageId: 1_000_000_000 + i, multiplicity: budget === 'posting' ? 4 : 1 })) })
    }
    if (budget === 'comparison') await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { visualComparedComparisons: VISUAL_LIMITS.comparisons - 40 } })
    if (budget === 'pair') await db!.artworkDedupVisualCandidate.createMany({ data: Array.from({ length: VISUAL_LIMITS.artworkPairs - 1 }, (_, i) => ({ runId: test.runId, leftArtworkId: 1_000_000_000 + i, rightArtworkId: 1_000_001_000 + i })) })
    if (budget !== 'pair') {
      expect(await slice(test, context(test))).toBe(false)
      const resumed = await state(test)
      expect(resumed.checkpoint).toMatchObject(budget === 'comparison'
        // The next query's first ten candidates belong to itself. They use
        // slots but no comparisons, so this additional prefix is legal.
        ? { queryAfter: test.pages[9]!.imageId, queryImageId: test.pages[10]!.imageId, candidateAfter: test.pages[18]!.imageId }
        : { queryAfter: test.pages[9]!.imageId, queryImageId: 0, candidateAfter: 0 })
      expect(flatEdges(resumed)).toHaveLength(60)
      expect(resumed.compared).toBe(budget === 'comparison' ? VISUAL_LIMITS.comparisons : 60)
    }
    const legalPrefix = await state(test)
    expect(await scanBatchedVisualVersions(context(test))).toBe(true)
    const incomplete = await state(test)
    expect(incomplete).toMatchObject({ stage: 'DONE', status: 'INCOMPLETE', reasons: [`VISUAL_${budget.toUpperCase()}_BUDGET`], pairs: [], candidatePairs: [] })
    expect(incomplete.checkpoint).toEqual(legalPrefix.checkpoint)
    expect(incomplete.candidates).toEqual(legalPrefix.candidates)
    expect(incomplete.compared).toBe(legalPrefix.compared)
    if (budget === 'pair') expect(incomplete.checkpoint).toEqual(prefixState.checkpoint)
    // Intrinsic budgets are terminal under the same inputs. A fresh context is
    // deliberately not a permission to raise budgets or publish the prefix.
    expect(await scanBatchedVisualVersions(context(test))).toBe(true)
    expect(await state(test)).toEqual(incomplete)
  }, 60_000)

  it('fences the old execution version after a dense partial query and resumes only through the new context', async () => {
    const test = await fixture(), before = await firstDensePrefix(test), stale = context(test)
    await db!.artworkDedupRun.update({ where: { id: test.runId }, data: { executionVersion: 2 } })
    await expect(scanBatchedVisualVersions(stale)).rejects.toThrow('CONFLICT')
    expect(await state(test)).toEqual(before)
    expect(await scanBatchedVisualVersions(context(test, 2))).toBe(true)
    expect(await state(test)).toMatchObject({ status: 'COMPLETE', compared: 2700 })
    const completed = await state(test)
    await expect(scanBatchedVisualVersions(stale)).rejects.toThrow('CONFLICT')
    expect(await state(test)).toEqual(completed)
  }, 60_000)

  it('rejects an expired lease after reading a dense suffix and recovers the same prefix under a newly claimed lease', async () => {
    const test = await fixture(), before = await firstDensePrefix(test)
    const clock = new MutableQueueClock(new Date('2030-01-01'))
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20_000 })
    const capabilities = [{ jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [5] }]
    await db!.systemJob.update({ where: { id: test.jobId }, data: { availableAt: clock.now(), payload: { runId: test.runId, executionVersion: 1 } } })
    const first = await repository.claim(`${prefix}-old`, capabilities)
    expect(first?.id).toBe(test.jobId)
    const fenced = (job: ClaimedJob): DedupPipelineContext => ({ ...context(test), transaction: operation => repository.withFencedMutationTransaction({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }, operation) })
    const old = fenced(first!), transaction = old.transaction
    let readDenseSuffix = false
    old.transaction = async operation => {
      const result = await transaction(operation)
      if (result && typeof result === 'object' && 'query' in result && result.query) {
        readDenseSuffix = true
        clock.advance(60_001)
      }
      return result
    }
    await expect(scanBatchedVisualVersions(old)).rejects.toThrow()
    expect(readDenseSuffix).toBe(true)
    expect(await state(test)).toEqual(before)
    const reclaimed = await repository.claim(`${prefix}-new`, capabilities)
    expect(reclaimed?.id).toBe(test.jobId)
    expect(reclaimed!.executionToken).not.toBe(first!.executionToken)
    expect(reclaimed!.attempt).toBe(first!.attempt + 1)
    await expect(scanBatchedVisualVersions(fenced(first!))).rejects.toThrow()
    expect(await state(test)).toEqual(before)
    expect(await scanBatchedVisualVersions(fenced(reclaimed!))).toBe(true)
    const completed = await state(test)
    expect(completed).toMatchObject({ status: 'COMPLETE', compared: 2700 })
    expect(completed.pairs).toHaveLength(3)
    await expect(scanBatchedVisualVersions(fenced(first!))).rejects.toThrow()
    expect(await state(test)).toEqual(completed)
  }, 60_000)
})
