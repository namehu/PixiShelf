import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { PrismaClient, captureArtworkDedupSources, type Prisma } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot, type ScanPayload } from '@pixishelf/job-contracts'
import {
  PostgresQueueRepository, TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ExecutionContext, type EnqueuedChildJob, type FencedMutationTransactionTiming, type QueueDatabase
} from '@pixishelf/job-runtime'
import { executeScan } from '../src/scan/scan-executor.ts'
import { metadataInputDigest } from '../src/scan/digests.ts'
import { hashStableFile } from '../src/scan/content-reader.ts'
import { resolveSafeScanRoot } from '../src/scan/paths.ts'
import { bindPixivInventoryRoot } from '../src/scan/root-identity.ts'
import { pixivScanSourceIdentities, resolveScanDedupRootIdentity } from '../src/scan/dedup-source-snapshot.ts'
import type { ScanDatabase } from '../src/scan/types.ts'

// Overlay this identical driver on the frozen baseline and optimized sources. Imports remain
// relative to that checkout; run tsx with that package's tsconfig so workspace aliases do too.
const mediaCounts = [
  89, 61, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 12
]
assert.equal(mediaCounts.length, 52)
assert.equal(mediaCounts.reduce((sum, count) => sum + count, 0), 603)
const stringify = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item)
const digest = (value: unknown) => createHash('sha256').update(stringify(value)).digest('hex')

async function main() {
  const label = process.argv[2]
  const output = process.argv[3]
  const smoke = process.argv[4] === '--smoke'
  assert.ok(label === 'baseline' || label === 'after')
  assert.ok(output && path.isAbsolute(output), 'Supply an absolute output JSON path')
  // No DATABASE_URL fallback: the destructive reset is exclusive to this disposable fixture.
  const url = new URL(process.env.SCAN_BENCHMARK_DATABASE_URL ?? '')
  assert.equal(url.protocol, 'postgresql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '56471')
  assert.equal(url.pathname, '/scan_regression')
  assert.equal(url.username, 'scan_regression')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-publication-benchmark-'))
  let active = false
  let sqlCount = 0
  let apiCount = 0
  let imageInsertStatements = 0
  let tagInsertStatements = 0
  let artworkTagInsertStatements = 0
  const sqlGroups = new Map<string, number>()
  const apiGroups = new Map<string, number>()
  const raw = new PrismaClient({ datasourceUrl: url.toString(), log: [{ emit: 'event', level: 'query' }] })
  raw.$on('query', (event) => {
    if (!active) return
    sqlCount++
    // Count actual database INSERT statements, separately from Prisma delegate calls.
    if (/\bINSERT INTO (?:"public"\.)?"Image"\s/.test(event.query)) imageInsertStatements++
    if (/\bINSERT INTO (?:"public"\.)?"Tag"\s/.test(event.query)) tagInsertStatements++
    if (/\bINSERT INTO (?:"public"\.)?"ArtworkTag"\s/.test(event.query)) artworkTagInsertStatements++
    const sql = event.query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').trim()
    const key = sql.replace(/\?(?:\s*,\s*\?)+/g, '?…')
    sqlGroups.set(key, (sqlGroups.get(key) ?? 0) + 1)
  })
  const db = raw.$extends({ query: { $allOperations: async ({ model, operation, args, query }) => {
    if (active) {
      apiCount++
      const key = `${model ?? '$raw'}.${operation}`
      apiGroups.set(key, (apiGroups.get(key) ?? 0) + 1)
    }
    return query(args)
  } } })
  const measurements: unknown[] = []
  try {
    const fixtureRows: Array<{ ordinal: number; relativePath: string; contentHash: string }> = []
    for (const [ordinal, count] of mediaCounts.entries()) {
      const externalId = String(900_000_000 + ordinal)
      const relativePath = `artist-${ordinal % 4}/${externalId}/${externalId}-meta.json`
      const directory = path.join(root, path.posix.dirname(relativePath))
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(root, relativePath), JSON.stringify({
        id: externalId, user: `scan-benchmark-artist-${ordinal % 4}`, userId: String(700_000 + ordinal % 4),
        title: `scan-benchmark-${externalId}`, description: `Synthetic work ${ordinal}`, pageCount: count,
        tags: [...Array.from({ length: 8 }, (_, index) => `scan-benchmark-shared-${index}`),
          ...Array.from({ length: 4 }, (_, index) => `scan-benchmark-${ordinal}-${index}`)]
      }))
      for (let index = 0; index < count; index++)
        await fs.writeFile(path.join(directory, `${externalId}_p${index}.jpg`), `synthetic-image:${ordinal}:${index}`)
      const document = await hashStableFile({ absolutePath: path.join(root, relativePath), maxBytes: 16 * 1024 * 1024, signal: new AbortController().signal })
      fixtureRows.push({ ordinal, relativePath, contentHash: document.sha256 })
    }
    for (let iteration = 0; iteration < (smoke ? 1 : 6); iteration++) {
      // This database was created solely for this run. Never copy this reset to an application DB.
      const tables = await raw.$queryRawUnsafe<Array<{ tablename: string }>>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename"
      )
      assert.ok(tables.length > 0)
      await raw.$executeRawUnsafe(`TRUNCATE ${tables.map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`).join(', ')} RESTART IDENTITY CASCADE`)
      const safeRoot = await resolveSafeScanRoot(root)
      await db.$transaction((transaction) => bindPixivInventoryRoot(transaction as unknown as Prisma.TransactionClient, safeRoot, new Date()))
      const rootContext = { mutateInTransaction: (operation: (transaction: any) => Promise<any>) => db.$transaction(operation) }
      const rootIdentity = await resolveScanDedupRootIdentity(safeRoot, rootContext as never)
      const rows: Array<(typeof fixtureRows)[number] & { dedupSourceSnapshot: Prisma.InputJsonValue }> = []
      for (const row of fixtureRows) rows.push({ ...row,
        dedupSourceSnapshot: serializeArtworkDedupSourceSnapshot(await db.$transaction((transaction) =>
          captureArtworkDedupSources(transaction as unknown as Prisma.TransactionClient, { identities: pixivScanSourceIdentities({ rootIdentity, relativePath: row.relativePath }) })
        ))
      })
      const payload: ScanPayload = { mode: 'CLIENT_LIST', existingPolicy: 'SKIP', inputCount: 52, inputDigest: metadataInputDigest(rows) }
      const job: { id: string } = await db.systemJob.create({ data: {
        type: 'SCAN', definitionVersion: 1, status: 'PENDING', triggerSource: 'SYSTEM', payload,
        queuePriority: 110, effectivePriority: 110, availableAt: new Date(), maxAttempts: 1
      } })
      await db.scanRun.create({ data: {
        systemJobId: job.id, type: 'PIXIV', mode: 'CLIENT_LIST', status: 'PENDING', inputCount: 52,
        inputDigest: payload.inputDigest, inputFrozenAt: new Date(), totalArtworks: 52,
        metadataInputs: { createMany: { data: rows } }
      } })
      const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { transactionTimeoutMs: 60_000, leaseDurationMs: 600_000 })
      const claimed = await repository.claim('scan-publication-benchmark', [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }])
      assert.equal(claimed?.id, job.id)
      assert.ok(claimed)
      const fence = { jobId: claimed.id, workerId: claimed.workerId, executionToken: claimed.executionToken, attempt: claimed.attempt }
      const transactions: FencedMutationTransactionTiming[] = []
      const itemTimings: unknown[] = []
      const progress: Array<{ elapsedMs: number; processed: unknown }> = []
      sqlCount = apiCount = imageInsertStatements = tagInsertStatements = artworkTagInsertStatements = 0
      sqlGroups.clear(); apiGroups.clear()
      const began = performance.now()
      const context: ExecutionContext<ScanPayload, EnqueuedChildJob> = {
        job: claimed, payload, signal: new AbortController().signal,
        enqueueChild: async () => { throw new Error('Unexpected child job') },
        progress: async (update) => { progress.push({ elapsedMs: performance.now() - began, processed: (update.data as { processed?: number })?.processed }) },
        mutateInTransaction: (operation, observeTiming) => repository.withFencedMutationTransaction(fence, operation, (timing) => {
          transactions.push(timing); observeTiming?.(timing)
        }),
        finalizeInTransaction: async (operation) => {
          await repository.withFencedExecutionTransaction(fence, operation)
          return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
        },
        logger: { debug() {}, info(event, data) { if (event === 'scan.input.completed') itemTimings.push(data) }, warn() {}, error() {} }
      }
      active = true
      const outcome = await executeScan(context, { database: db as unknown as ScanDatabase, config: { scanRoot: root } })
      const totalMs = performance.now() - began
      active = false
      assert.equal(outcome.kind, 'transactionally-finalized')
      const run = await db.scanRun.findUniqueOrThrow({ where: { systemJobId: job.id } })
      assert.equal(run.status, 'COMPLETED', run.errorMessage ?? '')
      assert.equal(run.succeededArtworks, 52)
      assert.equal(run.newImages, 603)
      const artworkCounts = await db.artwork.findMany({ select: { imageCount: true, _count: { select: { images: true } } } })
      for (const artwork of artworkCounts) assert.equal(artwork.imageCount, artwork._count.images)
      const tagCounts = await db.tag.findMany({ select: { artworkCount: true, _count: { select: { artworkTags: true } } } })
      for (const tag of tagCounts) assert.equal(tag.artworkCount, tag._count.artworkTags)
      const domain = await db.artwork.findMany({ orderBy: { externalId: 'asc' }, select: {
        externalId: true, title: true, description: true, source: true, createdVia: true,
        images: { orderBy: { sortOrder: 'asc' }, select: { path: true, sortOrder: true, size: true, mediaType: true, chaptersPath: true, chaptersCount: true } },
        artworkTags: { orderBy: { tag: { name: 'asc' } }, select: { provenance: true, tag: { select: { namespace: true, name: true } } } },
        externalRefs: { select: { providerKey: true, externalId: true, metadataHash: true } }
      } })
      const measurementsEntry = {
        iteration, warmup: !smoke && iteration < 3, totalMs, sqlCount, apiCount, imageInsertStatements, tagInsertStatements,
        artworkTagInsertStatements, businessDigest: digest(domain), run: {
          parsedInputs: run.parsedInputs, publishedInputs: run.publishedInputs, failedInputs: run.failedInputs,
          publishDurationMs: run.publishDurationMs, durationMs: run.durationMs
        }, transactions, itemTimings, progress, apiGroups: Object.fromEntries(apiGroups), sqlGroups: Object.fromEntries(sqlGroups)
      }
      measurements.push(measurementsEntry)
      console.log(JSON.stringify({ label, iteration, warmup: !smoke && iteration < 3, totalMs, sqlCount, imageInsertStatements, businessDigest: measurementsEntry.businessDigest }))
    }
    await fs.writeFile(output, stringify({ label,
      measurementScope: 'Executor publication only: progress callbacks are observed; Dispatcher throttling and progress persistence SQL are excluded.',
      fixture: { artworks: 52, media: 603, mediaCounts, concurrency: 4, pageSize: 100, existingPolicy: 'SKIP' }, measurements }) + '\n')
  } finally {
    await raw.$disconnect()
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('pixishelf-scan-publication-benchmark-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
