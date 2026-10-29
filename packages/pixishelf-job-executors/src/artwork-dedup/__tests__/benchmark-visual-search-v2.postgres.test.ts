import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Prisma, PrismaClient, captureArtworkContentSnapshot, captureMediaContentDirectory, ARTWORK_DEDUP_RELATION_CACHE_VERSION } from '@pixishelf/db'
import type { DedupPipelineContext } from '../pipeline.ts'
import { scanBatchedVisualVersions } from '../visual-batches.ts'
import { scanVisualSearch } from '../visual-search.ts'
import { VisualSearchWorker } from '../visual-search-worker.ts'
import { digest, scaleSha256, scaleViews, type ScaleShape } from './visual-scale-fixture.ts'

const enabled = process.env.ARTWORK_DEDUP_V2_BENCHMARK === '1'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const output = process.env.ARTWORK_DEDUP_V2_BENCHMARK_OUTPUT
const thread = process.env.ARTWORK_DEDUP_V2_BENCHMARK_THREAD
const count = Number(process.env.ARTWORK_DEDUP_V2_BENCHMARK_COUNT ?? 120)
type RunIdentity = { runId: string; jobId: string }
type Checkpoint = { phase?: string; queryCompleted?: number; queryAfter?: number }

async function sourceHashes() {
  const files = ['visual-batches.ts', 'visual-search.ts', 'visual-search-index.ts', 'visual-search-worker.ts', 'visual-search-thread.ts', 'visual-matching.ts', '__tests__/benchmark-visual-search-v2.postgres.test.ts']
  return Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex')])))
}
async function createRun(db: PrismaClient, artistId: number, prefix: string, version: 7 | 8, mode: 'FULL' | 'INCREMENTAL'): Promise<RunIdentity> {
  const jobId = randomUUID(), runId = randomUUID()
  await db.systemJob.create({ data: { id: jobId, type: 'ARTWORK_DEDUP_SCAN', definitionVersion: version,
    executionLane: 'BACKGROUND_WRITER', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900,
    payload: { runId, executionVersion: 1 } } })
  await db.artworkDedupRun.create({ data: { id: runId, artistId, requestedBy: prefix, idempotencyKey: randomUUID(), mode,
    jobId, status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true, visualStatus: 'PENDING' } })
  return { runId, jobId }
}
async function fixture(db: PrismaClient, shape: ScaleShape) {
  const prefix = `visual-v2-benchmark-${randomUUID()}`
  const artistId = (await db.artist.create({ data: { name: prefix } })).id
  const identity = await createRun(db, artistId, prefix, 7, 'FULL')
  const rootIdentity = (await db.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } } }))?.rootIdentity ?? prefix
  const directory = await db.$transaction(tx => captureMediaContentDirectory(tx, { directory: { logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix } }))
  if (directory.status !== 'READY') throw new Error('Synthetic benchmark directory unavailable')
  const artworkIds: number[] = [], imageIds: number[] = []
  const hash = createHash('sha256')
  for (let group = 0; group < shape.artworkCount; group++) {
    const artwork = await db.artwork.create({ data: { title: `${prefix}-${group}`, source: 'LOCAL_IMPORT', creators: { create: { artistId, evidence: { create: { provenance: 'MANUAL', evidenceKey: randomUUID(), present: true } } } } } })
    artworkIds.push(artwork.id)
    await db.image.createMany({ data: Array.from({ length: shape.groupSize }, (_, page) => ({ artworkId: artwork.id, path: `${prefix}/${group}/${page}.png`, sortOrder: page })) })
    const images = await db.image.findMany({ where: { artworkId: artwork.id }, orderBy: { id: 'asc' }, select: { id: true, path: true } })
    imageIds.push(...images.map(image => image.id))
    const snapshot = await db.$transaction(tx => captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
    if (snapshot.status !== 'READY') throw new Error('Synthetic benchmark snapshot unavailable')
    const current = await db.artwork.findUniqueOrThrow({ where: { id: artwork.id }, select: { mediaRevision: true } })
    await db.artworkDedupItem.create({ data: { runId: identity.runId, artworkId: artwork.id, frozenMediaRevision: current.mediaRevision,
      status: 'COMPLETE', snapshotRevision: snapshot.value.revision, mediaEpoch: snapshot.value.mediaEpoch, memberCount: snapshot.value.memberCount } })
    const rows = images.map((image, page) => {
      const ordinal = group * shape.groupSize + page, views = scaleViews(ordinal, shape)
      hash.update(digest([image.id, artwork.id, scaleSha256(ordinal), views]))
      return { runId: identity.runId, artworkId: artwork.id, imageId: image.id, sourcePath: image.path,
        sourceRevision: 0n, logicalRoot: 'source-media:v1', rootIdentity, relativeDirectory: prefix,
        directoryId: directory.value.directoryId, directoryGeneration: directory.value.generation, canonicalPath: image.path,
        size: 100n, sha256: scaleSha256(ordinal), visualStatus: 'READY', visualViews: views as unknown as Prisma.InputJsonValue }
    })
    await db.artworkDedupMedia.createMany({ data: rows })
  }
  await db.artworkDedupRun.update({ where: { id: identity.runId }, data: { visualAfterImageId: imageIds.at(-1)!, artworkCount: artworkIds.length, completeArtworks: artworkIds.length, processedArtworks: artworkIds.length } })
  return { ...identity, artistId, prefix, artworkIds, imageIds, fixtureDigest: hash.digest('hex') }
}
async function clone(db: PrismaClient, original: RunIdentity, artistId: number, prefix: string, mode: 'FULL' | 'INCREMENTAL') {
  const identity = await createRun(db, artistId, prefix, 8, mode)
  const old = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: original.runId } })
  const items = await db.artworkDedupItem.findMany({ where: { runId: old.id } })
  await db.artworkDedupItem.createMany({ data: items.map(row => ({ ...row, runId: identity.runId, visualSignature: null, visualReuseSignature: null })) })
  for (let after = 0;;) {
    const rows = await db.artworkDedupMedia.findMany({ where: { runId: old.id, imageId: { gt: after } }, orderBy: { imageId: 'asc' }, take: 500 })
    if (!rows.length) break
    await db.artworkDedupMedia.createMany({ data: rows.map(row => ({ ...row, runId: identity.runId, visualViews: row.visualViews as Prisma.InputJsonValue })) })
    after = rows.at(-1)!.imageId
  }
  await db.artworkDedupRun.update({ where: { id: identity.runId }, data: { visualAfterImageId: old.visualAfterImageId, artworkCount: old.artworkCount, completeArtworks: old.completeArtworks, processedArtworks: old.processedArtworks } })
  return identity
}

async function measure(identity: RunIdentity, version: 7 | 8, mode: 'FULL' | 'INCREMENTAL', browser: PrismaClient) {
  const db = new PrismaClient({ datasourceUrl: url!, log: [{ emit: 'event', level: 'query' }] })
  let phase = 'PREPARE', active = true, transactions = 0, transactionWallMs = 0, loads = 0, decodeCalls = 0
  const phases = new Map<string, { sqlStatements: number; sqlDurationMs: number; transactions: number; transactionWallMs: number }>()
  const sql = new Map<string, { phase: string; sql: string; count: number; durationMs: number }>()
  db.$on('query', event => {
    if (!active) return
    const value = phases.get(phase) ?? { sqlStatements: 0, sqlDurationMs: 0, transactions: 0, transactionWallMs: 0 }
    value.sqlStatements++; value.sqlDurationMs += event.duration; phases.set(phase, value)
    const normalized = event.query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').trim()
    const key = `${phase}:${digest(normalized)}`, row = sql.get(key) ?? { phase, sql: normalized.slice(0, 1200), count: 0, durationMs: 0 }
    row.count++; row.durationMs += event.duration; sql.set(key, row)
  })
  const observed = db.$extends({ query: { artworkDedupRun: {
    async findUnique({ args, query }) { const run = await query(args); phase = (run?.visualCheckpoint as Checkpoint | null)?.phase ?? phase; return run },
    async findUniqueOrThrow({ args, query }) { const run = await query(args); phase = (run.visualCheckpoint as Checkpoint | null)?.phase ?? phase; return run }
  } } })
  const worker = version === 8 ? new VisualSearchWorker(thread!) : undefined
  const browserMs: number[] = []
  let browsePending: Promise<void> | undefined, browseError: unknown
  const browse = () => {
    if (browsePending) return
    const start = performance.now()
    browsePending = browser.artwork.findMany({ orderBy: { id: 'desc' }, take: 20, select: { id: true, title: true, _count: { select: { images: true } } } })
      .then(() => { browserMs.push(performance.now() - start) }).catch(error => { browseError = error }).finally(() => { browsePending = undefined })
  }
  const context: DedupPipelineContext = {
    execution: { ...identity, executionVersion: 1 }, signal: new AbortController().signal, forceRead: mode === 'FULL',
    mixedVisualMedia: true, visualSearchV2: version === 8, searchWorker: worker, searchCache: { built: false },
    roots: {} as DedupPipelineContext['roots'],
    reader: { visual() { decodeCalls++; throw new Error('Prepared-feature benchmark must not decode originals') } } as unknown as DedupPipelineContext['reader'],
    shouldYield: () => false,
    read: async operation => { loads++; return operation(observed as unknown as Prisma.TransactionClient) },
    transaction: async operation => {
      const start = performance.now(), transactionPhase = phase
      transactions++
      try { return await observed.$transaction(tx => operation(tx as unknown as Prisma.TransactionClient), { timeout: 120_000 }) }
      finally {
        const elapsed = performance.now() - start; transactionWallMs += elapsed
        const value = phases.get(transactionPhase) ?? { sqlStatements: 0, sqlDurationMs: 0, transactions: 0, transactionWallMs: 0 }
        value.transactions++; value.transactionWallMs += elapsed; phases.set(transactionPhase, value)
      }
    }
  }
  const started = performance.now(), memoryStart = process.memoryUsage()
  let peakRss = memoryStart.rss, peakHeap = memoryStart.heapUsed
  const sample = setInterval(() => { const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed) }, 25)
  const browserTimer = setInterval(browse, 250)
  const log = setInterval(() => console.info('VISUAL_V2_BENCHMARK_PROGRESS ' + JSON.stringify({ version, mode, count, phase, transactions, elapsedMs: Math.round(performance.now() - started) })), 10_000)
  browse()
  let complete = false
  try { complete = version === 7 ? await scanBatchedVisualVersions(context, count, true) : await scanVisualSearch(context, count) }
  finally { active = false; clearInterval(sample); clearInterval(browserTimer); clearInterval(log); await browsePending; await worker?.close() }
  const elapsedMs = performance.now() - started
  if (browseError) throw browseError
  const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: identity.runId } })
  const pairs = await db.artworkDedupVisualPair.findMany({ where: { runId: identity.runId }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }], include: { pages: { orderBy: { ordinal: 'asc' } } } })
  const published = pairs.map(pair => ({ left: pair.leftArtworkId, right: pair.rightArtworkId,
    pages: pair.pages.map(page => [page.kind, page.leftImageId, page.rightImageId]) }))
  const postings = await db.artworkDedupVisualPosting.count({ where: { runId: run.id } })
  expect([complete, run.stage, run.visualStatus, decodeCalls]).toEqual([true, 'DONE', 'COMPLETE', 0])
  if (version === 8) { expect(run.visualSearchComplete).toBe(true); expect(postings).toBe(0) }
  if (mode === 'INCREMENTAL') {
    const counters = (run.performanceSummary as { counters: { indexNodeVisits: number | null; compareCalls: number | null; indexRebuilds: number | null } }).counters
    expect(counters.indexNodeVisits ?? 0).toBe(0); expect(counters.compareCalls ?? 0).toBe(0); expect(counters.indexRebuilds ?? 0).toBe(0)
  }
  await db.artworkDedupRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
  await db.$disconnect()
  browserMs.sort((a, b) => a - b)
  return { ...identity, version, mode, count, complete, elapsedMs, transactions, transactionWallMs, outsideTransactionReadCalls: loads,
    sqlStatements: [...sql.values()].reduce((n, row) => n + row.count, 0), sqlDurationMs: [...sql.values()].reduce((n, row) => n + row.durationMs, 0),
    phases: Object.fromEntries(phases), statementGroups: [...sql.values()].sort((a, b) => b.count - a.count),
    memory: { heapStartBytes: memoryStart.heapUsed, peakHeapBytes: peakHeap, rssStartBytes: memoryStart.rss, peakRssBytes: peakRss, processMaxRssBytes: process.resourceUsage().maxRSS * 1024 },
    browserQueryMs: { samples: browserMs.length, p50: browserMs[Math.floor(browserMs.length * 0.5)] ?? null, p95: browserMs[Math.min(browserMs.length - 1, Math.floor(browserMs.length * 0.95))] ?? null, max: browserMs.at(-1) ?? null },
    originalBytes: 0, decodeCalls, postings, compared: run.visualComparedComparisons, reused: run.visualReusedComparisons,
    performanceSummary: run.performanceSummary, published, publishedDigest: digest(published) }
}

it.skipIf(!enabled)('measures same prepared inputs for v7, v8 and complete v8 hot reuse', async () => {
  if (!url || !output || !thread) throw new Error('Explicit isolated database, output and bundled thread required')
  const target = new URL(url)
  expect([target.hostname, target.port, target.pathname]).toEqual(['127.0.0.1', '55432', '/dedup_v2_benchmark_20261029'])
  if (![120, 5_000, 10_000].includes(count)) throw new Error('Only 120-image probe or 5k/10k benchmark allowed')
  const groupSize = count === 120 ? 10 : 250
  const shape: ScaleShape = { count, groupSize, domain: 2 ** Math.ceil(Math.log2(count / 2)), artworkCount: count / groupSize,
    partialSource: Math.floor(count / groupSize / 2), partialTarget: count / groupSize - 2 }
  const db = new PrismaClient({ datasourceUrl: url })
  try {
    const sourceBefore = await sourceHashes(), frozen = await fixture(db, shape)
    const baseline = await measure(frozen, 7, 'FULL', db)
    const coldId = await clone(db, frozen, frozen.artistId, frozen.prefix, 'FULL')
    const cold = await measure(coldId, 8, 'FULL', db)
    const hotId = await clone(db, coldId, frozen.artistId, frozen.prefix, 'INCREMENTAL')
    const hot = await measure(hotId, 8, 'INCREMENTAL', db)
    expect(hot.published).toEqual(cold.published)
    const key = (p: { left: number; right: number }) => `${p.left}:${p.right}`
    const oldPairs = new Map(baseline.published.map(pair => [key(pair), pair])), newPairs = new Map(cold.published.map(pair => [key(pair), pair]))
    const differences = {
      added: [...newPairs].filter(([k]) => !oldPairs.has(k)).map(([, pair]) => pair),
      removed: [...oldPairs].filter(([k]) => !newPairs.has(k)).map(([, pair]) => pair),
      changed: [...newPairs].filter(([k, pair]) => oldPairs.has(k) && digest(pair) !== digest(oldPairs.get(k))).map(([, pair]) => pair)
    }
    const sourceAfter = await sourceHashes()
    const result = { observedAt: new Date().toISOString(), fixture: { count, shape, fixtureDigest: frozen.fixtureDigest, fixtureVersion: 'scaleViews-permuted-bands-v1', sameImageIdsAndFeatures: true, preparedFeatures: true },
      environment: { node: process.version, platform: process.platform, arch: process.arch }, sourceBefore, sourceAfter,
      baseline, cold, hot, differences,
      reductionPercent: { elapsed: 100 * (1 - cold.elapsedMs / baseline.elapsedMs), transactions: 100 * (1 - cold.transactions / baseline.transactions), sqlStatements: 100 * (1 - cold.sqlStatements / baseline.sqlStatements) },
      interpretation: 'Single process, same frozen images/features, sequential v7 FULL / v8 FULL / v8 hot INCREMENTAL. Fixture setup and result audit excluded. elapsed includes Worker start/close. SQL query events count statements, separately from transactions and API calls; no SQL parameters recorded. Transaction wall includes client round trips/wait, not WAL. Concurrent browse sample is a 20-artwork database list, not browser end-to-end latency. Memory is sampled process heap/RSS, with Worker thread included in RSS. v7 exact-band candidate oracle is not ground truth for v8; result differences require independent adjudication.' }
    await writeFile(resolve(output, `benchmark-${count}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.info('VISUAL_V2_BENCHMARK_RESULT ' + JSON.stringify({ count, fixtureDigest: frozen.fixtureDigest,
      baseline: { elapsedMs: baseline.elapsedMs, transactions: baseline.transactions, sqlStatements: baseline.sqlStatements },
      cold: { elapsedMs: cold.elapsedMs, transactions: cold.transactions, sqlStatements: cold.sqlStatements },
      hot: { elapsedMs: hot.elapsedMs, transactions: hot.transactions, sqlStatements: hot.sqlStatements },
      reductionPercent: result.reductionPercent, differences: { added: differences.added.length, removed: differences.removed.length, changed: differences.changed.length } }))
  } finally { await db.$disconnect() }
}, 900_000)
