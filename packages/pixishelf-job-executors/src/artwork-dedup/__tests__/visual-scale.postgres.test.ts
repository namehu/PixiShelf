import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Prisma, PrismaClient, captureArtworkContentSnapshot, captureMediaContentDirectory, ARTWORK_DEDUP_RELATION_CACHE_VERSION, ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION } from '@pixishelf/db'
import type { DedupPipelineContext } from '../pipeline.ts'
import { VisualSqlProfile } from './visual-sql-profile.ts'
import { SCALE_FIXTURE_VERSION, digest, scaleOracle, scaleSha256, scaleShape, scaleViews, type ScaleIdentity, type ScaleOracle } from './visual-scale-fixture.ts'

// A private, isolated module override; no product entry accepts these budgets.
vi.mock('../visual-matching.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../visual-matching.ts')>()
  return { ...actual, VISUAL_LIMITS: Object.freeze({ ...actual.VISUAL_LIMITS, files: 100_000, postings: 4_000_000, comparisons: 10_000_000 }) }
})
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { readCandidatePostings } from '../candidate-postings.ts'

interface Manifest extends ScaleIdentity {
  version: string; prefix: string; runId: string; jobId: string; artistId: number; fixtureSha256: string; oracle: ScaleOracle; sources: Record<string, string>; prepareMs: number
  baselineDirectory?: string; sourceFreezePending?: boolean
}
type Checkpoint = { phase?: string; queryAfter?: number; queryImageId?: number; candidateAfter?: number; [key: string]: unknown }
const exclusive = process.env.ARTWORK_DEDUP_VISUAL_SCALE_HARNESS === '1'
const outputDirectory = process.env.ARTWORK_DEDUP_VISUAL_SCALE_OUTPUT
const stage = process.env.ARTWORK_DEDUP_VISUAL_SCALE_STAGE
const count = Number(process.env.ARTWORK_DEDUP_VISUAL_SCALE_COUNT)
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const sourceNames = ['visual-batches.ts', 'candidate-postings.ts', 'root-directory-scope.ts', 'visual-pipeline.ts', 'visual-matching.ts', 'visual-experiment.ts', '__tests__/visual-scale-fixture.ts', '__tests__/visual-scale.postgres.test.ts', '__tests__/visual-sql-profile.ts']
async function sources() {
  return Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, createHash('sha256').update(await readFile(new URL(`../${name}`, import.meta.url))).digest('hex')])) ) as Record<string, string>
}
async function writeNew(name: string, value: unknown) {
  await writeFile(resolve(outputDirectory!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
async function postingStatistics(db: PrismaClient, runId: string) {
  const table = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT c.reltuples,s.n_live_tup::text,s.n_mod_since_analyze::text,s.last_analyze,s.last_autoanalyze,s.analyze_count::text,s.autoanalyze_count::text FROM pg_class c JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE c.oid='"ArtworkDedupVisualPosting"'::regclass`
  const distribution = await db.$queryRaw<Array<{ n_distinct: number; most_common_vals: string | null; most_common_freqs: number[] | null }>>`SELECT n_distinct,most_common_vals::text AS most_common_vals,most_common_freqs FROM pg_stats WHERE schemaname='public' AND tablename='ArtworkDedupVisualPosting' AND attname='runId'`
  return { observedAt: new Date().toISOString(), table, distribution, runInMostCommonValues: distribution.some(row => row.most_common_vals?.includes(runId)) }
}
async function inputDigest(db: PrismaClient, runId: string) {
  const hash = createHash('sha256')
  const items = await db.artworkDedupItem.findMany({ where: { runId }, orderBy: { artworkId: 'asc' }, select: { artworkId: true, frozenMediaRevision: true, status: true, snapshotRevision: true, mediaEpoch: true, memberCount: true } })
  hash.update(digest(items))
  for (let after = 0;;) {
    const rows = await db.artworkDedupMedia.findMany({ where: { runId, imageId: { gt: after } }, orderBy: { imageId: 'asc' }, take: 500,
      select: { artworkId: true, imageId: true, sourcePath: true, sourceRevision: true, logicalRoot: true, rootIdentity: true, relativeDirectory: true, directoryId: true, directoryGeneration: true, canonicalPath: true, size: true, sha256: true, visualStatus: true, visualViews: true } })
    if (!rows.length) break
    hash.update(digest(rows))
    hash.update(digest(await db.image.findMany({ where: { id: { in: rows.map(row => row.imageId) } }, orderBy: { id: 'asc' }, select: { id: true, artworkId: true, path: true, sortOrder: true, contentSource: true } })))
    after = rows.at(-1)!.imageId
  }
  hash.update(digest(await db.artwork.findMany({ where: { id: { in: items.map(item => item.artworkId) } }, orderBy: { id: 'asc' }, select: { id: true, mediaRevision: true, contentSource: true } })))
  const first = await db.artworkDedupMedia.findFirst({ where: { runId }, select: { logicalRoot: true, relativeDirectory: true } })
  if (first) hash.update(digest(await db.mediaContentDirectoryState.findMany({ where: { logicalRoot: first.logicalRoot, relativeDirectory: { in: ['', first.relativeDirectory] } }, orderBy: { relativeDirectory: 'asc' }, select: { id: true, logicalRoot: true, relativeDirectory: true, rootIdentity: true, generation: true } })))
  return hash.digest('hex')
}
async function createJob(db: PrismaClient) {
  const jobId = randomUUID()
  await db.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: {} } })
  return jobId
}
async function createFixture(db: PrismaClient): Promise<Manifest> {
  const started = performance.now(), shape = scaleShape(count), prefix = `visual-scale-${randomUUID()}`
  const artist = await db.artist.create({ data: { name: prefix } }), jobId = await createJob(db)
  const run = await db.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: prefix, idempotencyKey: randomUUID(), mode: 'FULL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING' } })
  const rootIdentity = (await db.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } }))?.rootIdentity ?? prefix
  const directory = await db.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix } }))
  if (directory.status !== 'READY') throw new Error('Synthetic directory unavailable')
  const artworkIds: number[] = [], imageIds: number[] = []
  for (let group = 0; group < shape.artworkCount; group++) {
    const artwork = await db.artwork.create({ data: { title: `${prefix}-${group}`, source: 'LOCAL_IMPORT', creators: { create: { artistId: artist.id, evidence: { create: { provenance: 'MANUAL', evidenceKey: randomUUID(), present: true } } } } } })
    artworkIds.push(artwork.id)
    await db.image.createMany({ data: Array.from({ length: shape.groupSize }, (_, page) => ({ artworkId: artwork.id, path: `${prefix}/${artwork.id}/${page}.png`, sortOrder: page })) })
    const images = await db.image.findMany({ where: { artworkId: artwork.id }, orderBy: { id: 'asc' }, select: { id: true } })
    imageIds.push(...images.map(image => image.id))
    const snapshot = await db.$transaction(tx => captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
    if (snapshot.status !== 'READY') throw new Error('Synthetic snapshot unavailable')
    const current = await db.artwork.findUniqueOrThrow({ where: { id: artwork.id }, select: { mediaRevision: true } })
    await db.artworkDedupItem.create({ data: { runId: run.id, artworkId: artwork.id, frozenMediaRevision: current.mediaRevision, status: 'COMPLETE', snapshotRevision: snapshot.value.revision, mediaEpoch: snapshot.value.mediaEpoch, memberCount: snapshot.value.memberCount } })
    for (let start = 0; start < images.length; start += 500) await db.artworkDedupMedia.createMany({ data: images.slice(start, start + 500).map((image, offset) => {
      const page = start + offset, ordinal = group * shape.groupSize + page
      return { runId: run.id, artworkId: artwork.id, imageId: image.id, sourcePath: `${prefix}/${artwork.id}/${page}.png`, sourceRevision: 0n,
        logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix, directoryId: directory.value.directoryId, directoryGeneration: directory.value.generation,
        canonicalPath: `${prefix}/${artwork.id}/${page}.png`, size: 100n, sha256: scaleSha256(ordinal), visualStatus: 'READY', visualViews: scaleViews(ordinal, shape) as unknown as Prisma.InputJsonValue }
    }) })
    if ((group + 1) % 10 === 0) console.info('F03_SCALE_PREPARE ' + JSON.stringify({ count, artworks: group + 1, media: imageIds.length, elapsedMs: Math.round(performance.now() - started) }))
  }
  await db.artworkDedupRun.update({ where: { id: run.id }, data: { visualAfterImageId: imageIds.at(-1)! } })
  const identity = { shape, artworkIds, imageIds }, oracle = scaleOracle(identity)
  expect(oracle.pairs.map(pair => [pair.left, pair.right])).toEqual([[artworkIds[0], artworkIds.at(-1)], [artworkIds[shape.partialSource], artworkIds[shape.partialTarget]]])
  expect(oracle.maxCandidates).toBeLessThanOrEqual(82)
  expect(oracle.maxPostingVisits).toBeLessThan(20_000)
  const manifest = { ...identity, version: SCALE_FIXTURE_VERSION, prefix, runId: run.id, jobId, artistId: artist.id, fixtureSha256: await inputDigest(db, run.id), oracle, sources: await sources(), prepareMs: Math.round(performance.now() - started) }
  await writeNew('manifest.json', manifest)
  console.info('F03_SCALE_FIXTURE ' + JSON.stringify({ count, artworks: artworkIds.length, prepareMs: manifest.prepareMs, fixtureSha256: manifest.fixtureSha256, comparisons: oracle.comparisons, candidatePairs: oracle.candidates.length, resultPairs: oracle.pairs.length, postings: oracle.postings, maxCandidates: oracle.maxCandidates }))
  return manifest
}
async function cloneHot(db: PrismaClient, manifest: Manifest) {
  const old = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: manifest.runId } })
  expect([old.stage, old.visualStatus]).toEqual(['DONE', 'COMPLETE'])
  await db.artworkDedupRun.update({ where: { id: old.id }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
  const jobId = await createJob(db)
  const run = await db.artworkDedupRun.create({ data: { artistId: manifest.artistId, requestedBy: manifest.prefix, idempotencyKey: randomUUID(), mode: 'INCREMENTAL', jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING', visualAfterImageId: old.visualAfterImageId } })
  const items = await db.artworkDedupItem.findMany({ where: { runId: old.id } })
  await db.artworkDedupItem.createMany({ data: items.map(item => ({ ...item, runId: run.id, visualSignature: null, visualReuseSignature: null })) })
  for (let after = 0;;) {
    const rows = await db.artworkDedupMedia.findMany({ where: { runId: old.id, imageId: { gt: after } }, orderBy: { imageId: 'asc' }, take: 500 })
    if (!rows.length) break
    await db.artworkDedupMedia.createMany({ data: rows.map(row => ({ ...row, runId: run.id, visualViews: row.visualViews as Prisma.InputJsonValue })) })
    after = rows.at(-1)!.imageId
  }
  expect(await inputDigest(db, run.id)).toBe(manifest.fixtureSha256)
  await writeNew('hot-identity.json', { runId: run.id, jobId })
  return { runId: run.id, jobId }
}
async function outcome(db: PrismaClient, runId: string, manifest: Manifest, hot: boolean) {
  const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
  const pairs = (await db.artworkDedupVisualPair.findMany({ where: { runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }], include: { pages: { orderBy: { ordinal: 'asc' } } } })).map(pair => ({ left: pair.leftArtworkId, right: pair.rightArtworkId, summary: pair.summary, pages: pair.pages.map(page => [page.kind, page.leftImageId, page.rightImageId]) }))
  const candidates = await db.artworkDedupVisualCandidate.findMany({ where: { runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }] })
  const normalizedCandidates = candidates.map(candidate => ({ left: candidate.leftArtworkId, right: candidate.rightArtworkId, edges: (candidate.edges as Array<[number, number]>).sort((a, b) => a[0] - b[0] || a[1] - b[1]), evidence: candidate.evidence, reused: candidate.reused }))
  const postings = await db.artworkDedupVisualPosting.count({ where: { runId } })
  expect([run.stage, run.visualStatus, run.visualIncompleteReasons]).toEqual(['DONE', 'COMPLETE', []])
  expect(postings).toBe(manifest.oracle.postings)
  expect(run.visualComparedComparisons).toBe(hot ? 0 : manifest.oracle.comparisons)
  expect(run.visualReusedComparisons).toBe(hot ? manifest.oracle.comparisons : 0)
  expect((run.visualCheckpoint as Checkpoint | null)?.reuseBaseId ?? null).toBe(hot ? manifest.runId : null)
  expect(run.visualCandidatePairs).toEqual(manifest.oracle.candidates.map(candidate => `${candidate.left}:${candidate.right}`))
  expect(pairs.map(({ left, right, pages }) => ({ left, right, pages }))).toEqual(manifest.oracle.pairs)
  const expectedPairs = new Map(manifest.oracle.pairs.map(pair => [`${pair.left}:${pair.right}`, pair]))
  for (const pair of pairs) {
    const paired = pair.pages.filter(page => page[0] === 'SIMILAR').length
    expect(pair.summary).toEqual({ evidenceVersion: ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION, leftArtworkId: pair.left, rightArtworkId: pair.right,
      leftFileCount: String(manifest.shape.groupSize), rightFileCount: String(manifest.shape.groupSize), pairedCount: String(paired), exactCount: '0', similarCount: String(paired),
      leftUnmatchedCount: String(manifest.shape.groupSize - paired), rightUnmatchedCount: String(manifest.shape.groupSize - paired), leftUncheckedCount: '0', rightUncheckedCount: '0' })
  }
  for (const candidate of normalizedCandidates) expect(candidate.evidence).toEqual(expectedPairs.get(`${candidate.left}:${candidate.right}`)?.pages.map(([kind, left, right]) => ({ kind, left, right })) ?? null)
  expect(normalizedCandidates.map(({ left, right }) => ({ left, right }))).toEqual(manifest.oracle.candidates.map(({ left, right }) => ({ left, right })))
  if (hot) expect(normalizedCandidates.every(candidate => candidate.reused && candidate.edges.length === 0)).toBe(true)
  else expect(normalizedCandidates.map(({ left, right, edges }) => ({ left, right, edges }))).toEqual(manifest.oracle.candidates)
  const published = { candidatePairs: run.visualCandidatePairs, pairs }
  const result = { status: run.visualStatus, reasons: run.visualIncompleteReasons, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, postings, candidates: normalizedCandidates, published, publishedSha256: digest(published), completeSha256: digest({ ...published, normalizedCandidates, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, postings }) }
  if (hot) {
    const cold = JSON.parse(await readFile(resolve(outputDirectory!, 'cold-resume.json'), 'utf8')) as { outcome: { publishedSha256: string } }
    expect(result.publishedSha256).toBe(cold.outcome.publishedSha256)
  }
  if (manifest.baselineDirectory) {
    const baseline = JSON.parse(await readFile(resolve(manifest.baselineDirectory, hot ? 'hot.json' : 'cold-resume.json'), 'utf8')) as {
      outcome: { published: unknown; candidates: unknown; completeSha256: string }
    }
    expect(result.published).toEqual(baseline.outcome.published)
    expect(result.candidates).toEqual(baseline.outcome.candidates)
    expect(result.completeSha256).toBe(baseline.outcome.completeSha256)
  }
  return result
}

it.skipIf(!exclusive)('measures the isolated prepared-feature scale run with a persisted restart and hot reuse', async () => {
  if (!url || !outputDirectory || !['cold-start', 'cold-resume', 'hot'].includes(stage ?? '')) throw new Error('Explicit isolated URL, output, count and stage are required')
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_f03_scale_kernel_20261027') throw new Error('Only the dedicated scale database is permitted')
  scaleShape(count)
  const original = await vi.importActual<typeof import('../visual-matching.ts')>('../visual-matching.ts')
  expect(original.VISUAL_LIMITS.files).toBe(10_000)
  expect(original.VISUAL_LIMITS.postings).toBe(1_600_000)
  expect(original.VISUAL_LIMITS.comparisons).toBe(200_000)
  const db = new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] })
  try {
    const reuseFixture = process.env.ARTWORK_DEDUP_VISUAL_SCALE_REUSE_FIXTURE === '1'
    const manifest = stage === 'cold-start' && !reuseFixture ? await createFixture(db) : JSON.parse(await readFile(resolve(outputDirectory, 'manifest.json'), 'utf8')) as Manifest
    expect(manifest.version).toBe(SCALE_FIXTURE_VERSION); expect(manifest.shape.count).toBe(count)
    expect(manifest.sourceFreezePending).not.toBe(true)
    expect(await sources()).toEqual(manifest.sources)
    expect(await inputDigest(db, manifest.runId)).toBe(manifest.fixtureSha256)
    const identity = stage === 'hot' ? await cloneHot(db, manifest) : { runId: manifest.runId, jobId: manifest.jobId }
    const { runId, jobId } = identity
    const beforeRun = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
    const postingStatsBefore = await postingStatistics(db, runId)
    const initialCheckpoint = beforeRun.visualCheckpoint as Checkpoint | null
    if (stage === 'cold-start' && reuseFixture) {
      expect([beforeRun.stage, beforeRun.mode, beforeRun.visualStatus, beforeRun.visualComparedComparisons, beforeRun.visualReusedComparisons, beforeRun.visualCheckpoint]).toEqual(['VISUAL', 'FULL', 'PENDING', 0, 0, null])
      expect(await db.artworkDedupVisualPosting.count({ where: { runId } })).toBe(0)
      expect(await db.artworkDedupVisualCandidate.count({ where: { runId } })).toBe(0)
      expect(await db.artworkDedupVisualPair.count({ where: { runId } })).toBe(0)
    }
    if (stage === 'cold-resume') {
      const previous = JSON.parse(await readFile(resolve(outputDirectory, 'cold-start.json'), 'utf8')) as { checkpoint: unknown; compared: number }
      expect(initialCheckpoint).toEqual(previous.checkpoint)
      expect(beforeRun.visualComparedComparisons).toBe(previous.compared)
      expect(initialCheckpoint?.phase).toBe('QUERY')
    }
    const profile = new VisualSqlProfile(), metrics = { queries: 0, writes: 0, transactions: 0, maxMediaRows: 0, checkpointWrites: 0 }
    let latestCheckpoint: Checkpoint | null = initialCheckpoint, transactionCheckpoint: Checkpoint | null = initialCheckpoint, compared = beforeRun.visualComparedComparisons, reused = beforeRun.visualReusedComparisons
    db.$on('query', event => { profile.event(event.query, event.duration); metrics.queries++; if (/^(INSERT|UPDATE|DELETE)/.test(event.query.trim())) metrics.writes++; if (event.query === 'BEGIN') metrics.transactions++ })
    const measuredDb = db.$extends({ query: {
      artworkDedupRun: {
        async findUnique({ args, query }) { const result = await query(args); if (result) profile.readRun(result.visualCheckpoint); return result },
        async update({ args, query }) { const result = await query(args); if ('visualCheckpoint' in args.data) { metrics.checkpointWrites++; transactionCheckpoint = result.visualCheckpoint as Checkpoint | null }; compared = result.visualComparedComparisons ?? compared; reused = result.visualReusedComparisons ?? reused; return result }
      },
      artwork: { async findMany({ args, query }) { const ids = args.where?.id; if (ids && typeof ids === 'object' && Array.isArray(ids.in)) profile.guardArtworks(ids.in.length); return query(args) } },
      artworkDedupMedia: {
        async findFirst({ args, query }) { const result = await query(args); if (args.include?.item && result) profile.features('queryRows', 1); return result },
        async findMany({ args, query }) { const result = await query(args); metrics.maxMediaRows = Math.max(metrics.maxMediaRows, result.length); if (args.include?.item) profile.features(args.where?.imageId && typeof args.where.imageId === 'object' && 'in' in args.where.imageId ? 'candidateRows' : 'queryRows', result.length); return result }
      }
    } })
    const targetImageId = manifest.imageIds[Math.floor(count / 2)]!
    const context: DedupPipelineContext = {
      execution: { runId, jobId, executionVersion: 1 }, signal: new AbortController().signal, forceRead: stage !== 'hot', roots: {} as DedupPipelineContext['roots'],
      reader: { visual() { throw new Error('Prepared features must never decode original media') } } as unknown as DedupPipelineContext['reader'],
      shouldYield: () => stage === 'cold-start' && latestCheckpoint?.phase === 'QUERY' && (latestCheckpoint.queryAfter ?? 0) >= targetImageId,
      transaction: async operation => { profile.begin(); try { const result = await measuredDb.$transaction(tx => operation(tx as unknown as Prisma.TransactionClient), { timeout: 120_000 }); latestCheckpoint = transactionCheckpoint; return result } finally { profile.end() } }
    }
    const started = performance.now(), memoryStart = process.memoryUsage()
    let peakHeap = memoryStart.heapUsed, peakRss = memoryStart.rss
    const sample = setInterval(() => { const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss) }, 25)
    const progress = setInterval(() => console.info('F03_SCALE_PROGRESS ' + JSON.stringify({ stage, count, elapsedMs: Math.round(performance.now() - started), checkpoint: latestCheckpoint && { phase: latestCheckpoint.phase, queryAfter: latestCheckpoint.queryAfter, queryImageId: latestCheckpoint.queryImageId, candidateAfter: latestCheckpoint.candidateAfter }, compared, reused, ...metrics, heapUsed: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss })), 10_000)
    const snapshotMetrics = () => ({ elapsedMs: Math.round(performance.now() - started), heapStart: memoryStart.heapUsed, peakHeap, rssStart: memoryStart.rss, peakSampledRss: peakRss, processMaxRssBytes: process.resourceUsage().maxRSS * 1024, ...metrics })
    let complete: boolean, measured: Record<string, number>
    try {
      complete = await scanBatchedVisualVersions(context, count)
      measured = snapshotMetrics()
    } catch (error) {
      const failedMeasured = snapshotMetrics()
      const failedRun = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
      await writeNew(`${stage}-failure.json`, { stage, count, pid: process.pid, runId, jobId, sources: manifest.sources, fixtureSha256: manifest.fixtureSha256,
        initialCheckpoint, checkpoint: failedRun.visualCheckpoint, compared: failedRun.visualComparedComparisons, reused: failedRun.visualReusedComparisons,
        measured: failedMeasured, profile: profile.result(), error: { name: error instanceof Error ? error.name : 'Unknown', message: String(error instanceof Error ? error.message : error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED_DATABASE_URL]') } })
      throw error
    } finally { clearInterval(sample); clearInterval(progress) }
    const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: runId } })
    await writeNew(`${stage}-kernel.json`, { stage, count, pid: process.pid, runId, jobId, sources: manifest.sources, fixtureSha256: manifest.fixtureSha256,
      complete, initialCheckpoint, checkpoint: run.visualCheckpoint, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, measured, profile: profile.result() })
    expect(await inputDigest(db, runId)).toBe(manifest.fixtureSha256)
    const postingStatsAfter = await postingStatistics(db, runId)
    const bounds = profile.result().bounds
    expect(bounds.queryRows).toBeLessThanOrEqual(8); expect(bounds.candidateRows).toBeLessThanOrEqual(50)
    expect(bounds.queryAndCandidateRows).toBeLessThanOrEqual(58); expect(bounds.guardArtworks).toBeLessThanOrEqual(51)
    expect(metrics.maxMediaRows).toBeLessThanOrEqual(manifest.shape.groupSize)
    expect(complete).toBe(stage !== 'cold-start')
    const result = complete ? await outcome(db, runId, manifest, stage === 'hot') : null
    const databaseSize = await db.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`
    const summary = { stage, count, pid: process.pid, runId, jobId, fixtureSha256: manifest.fixtureSha256, sources: manifest.sources, privateLimits: { files: 100_000, postings: 4_000_000, comparisons: 10_000_000 }, originalBytes: 0, visualCalls: 0, complete, initialCheckpoint, checkpoint: run.visualCheckpoint, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons, measured, postingStatsBefore, postingStatsAfter, databaseBytes: databaseSize[0]!.bytes.toString(), outcome: result, profile: profile.result() }
    await writeNew(`${stage}.json`, summary)
    console.info('F03_SCALE_MEASURED ' + JSON.stringify({ stage, count, complete, fixtureSha256: manifest.fixtureSha256, measured, databaseBytes: summary.databaseBytes, compared: summary.compared, reused: summary.reused, publishedSha256: result?.publishedSha256 }))
  } finally { await db.$disconnect() }
}, 5_400_000)

const postingMode = process.env.ARTWORK_DEDUP_VISUAL_POSTING_COMPARE
it.skipIf(!exclusive || !['old', 'new'].includes(postingMode ?? ''))('compares the isolated fresh-run posting seeks', async () => {
  if (!url || !outputDirectory) throw new Error('Explicit isolated database and output required')
  const target = new URL(url)
  expect([target.hostname, target.port, target.pathname]).toEqual(['127.0.0.1', '55432', '/dedup_f03_scale_kernel_20261027'])
  const manifest = JSON.parse(await readFile(resolve(outputDirectory, 'manifest.json'), 'utf8')) as Manifest & { role: string }
  expect([manifest.shape.count, manifest.role, manifest.sourceFreezePending]).toEqual([5_000, 'query-carrier', false])
  expect(await sources()).toEqual(manifest.sources)
  const db = new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] })
  type Posting = { imageId: number; multiplicity: number }
  const canonical = (rows: readonly Posting[]) => rows.map(row => [row.imageId, row.multiplicity] as const).sort((left, right) => left[0] - right[0] || left[1] - right[1])
  try {
    expect(await inputDigest(db, manifest.runId)).toBe(manifest.fixtureSha256)
    const carrier = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: manifest.runId } })
    expect([carrier.status, carrier.stage, carrier.visualStatus]).toEqual(['CANCELLED', 'VISUAL', 'PENDING'])
    const queries: Array<{ imageId: number; keys: string[] }> = []
    // Only this fixed 5k corpus is indexed by the independent audit. The map
    // has exactly 200k posting entries, rather than all historical postings.
    let index: Map<string, Map<number, number>> | undefined = new Map()
    for (let after = 0;;) {
      const media = await db.artworkDedupMedia.findMany({ where: { runId: manifest.runId, imageId: { gt: after } }, orderBy: { imageId: 'asc' }, take: 500, select: { imageId: true, visualViews: true } })
      if (!media.length) break
      for (const row of media) {
        const views = row.visualViews as Array<{ feature: { hashes: string[] } }>
        const keys = views.flatMap(view => view.feature.hashes.flatMap((hash, region) => Array.from({ length: 4 }, (_, band) => `${region}:${band}:${hash.slice(band * 4, band * 4 + 4)}`)))
        for (const key of keys) { const bucket = index.get(key) ?? new Map<number, number>(); bucket.set(row.imageId, (bucket.get(row.imageId) ?? 0) + 1); index.set(key, bucket) }
        queries.push({ imageId: row.imageId, keys: [...new Set(keys)] })
      }
      after = media.at(-1)!.imageId
    }
    expect(queries.map(row => row.imageId)).toEqual(manifest.imageIds)
    expect([...index.values()].reduce((sum, bucket) => sum + bucket.size, 0)).toBe(200_000)
    const expected = queries.map(query => {
      const rows = query.keys.flatMap(key => [...index!.get(key)!.entries()].map(([imageId, multiplicity]) => ({ imageId, multiplicity })))
      return { queryImageId: query.imageId, rowCount: rows.length, totalMultiplicity: rows.reduce((sum, row) => sum + row.multiplicity, 0), postingsSha256: digest(canonical(rows)), candidateIds: [...new Set(rows.map(row => row.imageId))].sort((left, right) => left - right) }
    })
    index = undefined
    expect(expected.reduce((sum, row) => sum + row.candidateIds.length, 0)).toBe(manifest.oracle.candidateSlots)
    expect(Math.max(...expected.map(row => row.totalMultiplicity))).toBe(manifest.oracle.maxPostingVisits)
    const beforeStats = await postingStatistics(db, manifest.runId)
    await writeNew(`posting-${postingMode}-initial-stats.json`, beforeStats)
    expect(beforeStats.runInMostCommonValues).toBe(false)
    const events = { count: 0, durationMs: 0, first: undefined as Prisma.QueryEvent | undefined }
    let measurementOpen = false, queryActive = false
    db.$on('query', event => {
      if (measurementOpen && /^SELECT\b/.test(event.query.trim()) && event.query.includes('"ArtworkDedupVisualPosting"')) { events.count++; events.durationMs += event.duration; events.first ??= event }
    })
    const memoryStart = process.memoryUsage()
    let peakHeap = memoryStart.heapUsed, peakRss = memoryStart.rss, selectWallMs = 0, checked = 0
    const sample = setInterval(() => { if (queryActive) { const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss) } }, 25)
    const progress = setInterval(() => console.info('F03_POSTING_PROGRESS ' + JSON.stringify({ mode: postingMode, checked, count: queries.length, selectWallMs: Math.round(selectWallMs), queries: events.count })), 10_000)
    const loopStarted = performance.now()
    measurementOpen = true
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10000ms'")
        for (let ordinal = 0; ordinal < queries.length; ordinal++) {
          const query = queries[ordinal]!
          queryActive = true
          const started = performance.now()
          let rows: Posting[]
          try { rows = postingMode === 'old' ? await tx.artworkDedupVisualPosting.findMany({ where: { runId: manifest.runId, key: { in: query.keys } }, take: 20_001 }) : await readCandidatePostings(tx, manifest.runId, query.keys) }
          finally { selectWallMs += performance.now() - started; queryActive = false }
          const actual = { queryImageId: query.imageId, rowCount: rows.length, totalMultiplicity: rows.reduce((sum, row) => sum + row.multiplicity, 0), postingsSha256: digest(canonical(rows)), candidateIds: [...new Set(rows.map(row => row.imageId))].sort((left, right) => left - right) }
          expect(actual).toEqual(expected[ordinal])
          checked++
        }
      }, { timeout: 840_000 })
      await new Promise<void>(resolve => setImmediate(resolve))
    } finally { measurementOpen = false; clearInterval(sample); clearInterval(progress) }
    const loopWallMs = performance.now() - loopStarted
    const afterStats = await postingStatistics(db, manifest.runId)
    await writeNew(`posting-${postingMode}-final-stats.json`, afterStats)
    expect(checked).toBe(5_000); expect(events.count).toBe(5_000)
    expect(events.first).toBeDefined()
    const first = events.first!, parameters = JSON.parse(first.params) as unknown[]
    expect(first.query.trim()).toMatch(/^SELECT\b/)
    const explainStarted = performance.now()
    const explain = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10000ms'")
      return tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${first.query}`, ...parameters)
    }, { timeout: 15_000 })
    const explainWallMs = performance.now() - explainStarted
    const normalizedSql = first.query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').trim()
    const cleanPlan = JSON.parse(JSON.stringify(explain).replace(/'(?:''|[^'])*'/g, "'?'").replace(new RegExp(manifest.runId, 'g'), '[runId]')) as unknown
    const summary = { observedAt: new Date().toISOString(), mode: postingMode, pid: process.pid, runId: manifest.runId, count: checked, fixtureSha256: manifest.fixtureSha256, sources: manifest.sources,
      beforeStats, afterStats, queryMetrics: { selectWallMs, loopWallMs, prismaQueryEvents: events.count, prismaDurationMs: events.durationMs, heapStart: memoryStart.heapUsed, peakHeap, rssStart: memoryStart.rss, peakSampledRss: peakRss, processMaxRssBytes: process.resourceUsage().maxRSS * 1024 },
      normalizedSql, parameterCount: parameters.length, parametersSha256: digest(parameters), bindParametersRecorded: false, explainWallMs, explain: cleanPlan,
      candidateSlots: expected.reduce((sum, row) => sum + row.candidateIds.length, 0), fullResultsSha256: digest(expected), results: expected,
      measurementMeaning: 'selectWallMs sums only awaited posting SELECT/helper calls; independent feature-index/oracle, per-page canonicalization/assertions, transaction setup and EXPLAIN are excluded. loopWallMs includes per-page audit and one read-only transaction. Heap/RSS sampled every 25ms while a SELECT is awaited includes preloaded queries/oracle and earlier audit allocations. Process maxRSS includes all setup/oracle/EXPLAIN. Old ORM returns unused runId/key columns; new production helper returns only imageId/multiplicity. Canonical comparison preserves duplicate imageId/multiplicity rows and independently sorts candidate IDs.', originalBytes: 0, visualCalls: 0 }
    await writeNew(`posting-${postingMode}.json`, summary)
    console.info('F03_POSTING_MEASURED ' + JSON.stringify({ mode: postingMode, count: checked, selectWallMs, prismaQueryEvents: events.count, prismaDurationMs: events.durationMs, fullResultsSha256: summary.fullResultsSha256, explainWallMs, peakHeap, peakRss }))
  } finally { await db.$disconnect() }
}, 900_000)
