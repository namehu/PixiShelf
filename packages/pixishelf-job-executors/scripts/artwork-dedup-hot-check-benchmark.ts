import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient, freezeArtworkDedupRun, type Prisma } from '@pixishelf/db'
import { PostgresQueueRepository, TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME, type ClaimedJob, type QueueDatabase, type ExecutionContext, type EnqueuedChildJob } from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { createArtworkDedupExecutor } from '../src/artwork-dedup/executor.ts'

async function main() {
const base = '/private/tmp/pixishelf-dedup-hot-20261030'
const action = process.argv[2] ?? 'measure'
const label = process.argv[3] ?? action
const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432')
assert.match(url.pathname, /^\/dedup_hot_(seed|baseline|after|browser|restart)_20261030$/)
const manifest = JSON.parse(await fs.readFile(path.join(base, 'manifest.json'), 'utf8'))
const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v)
const digest = (value: unknown) => createHash('sha256').update(stringify(value)).digest('hex')
let active = false, phase = 'STAT', firstIndexMs: number | null = null, started = 0, transactionWallMs = 0, mutationTransactions = 0, apiCalls = 0
const phases = new Map<string, { apiCalls: number; sqlStatements: number; sqlDurationMs: number; transactions: number; transactionWallMs: number }>()
const statements = new Map<string, { phase: string; sql: string; count: number; durationMs: number }>()
const stats = () => { let row = phases.get(phase); if (!row) { row = { apiCalls: 0, sqlStatements: 0, sqlDurationMs: 0, transactions: 0, transactionWallMs: 0 }; phases.set(phase, row) }; return row }
const raw = new PrismaClient({ datasourceUrl: url.toString(), log: [{ emit: 'event', level: 'query' }] })
raw.$on('query', event => {
  if (!active) return
  const row = stats(); row.sqlStatements++; row.sqlDurationMs += event.duration
  if (event.query === 'BEGIN') row.transactions++
  const sql = event.query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').replace(/\?(?:\s*,\s*\?)+/g, '?…').trim()
  const key = phase + ':' + digest(sql), statement = statements.get(key) ?? { phase, sql: sql.slice(0, 1600), count: 0, durationMs: 0 }
  statement.count++; statement.durationMs += event.duration; statements.set(key, statement)
})
function setPhase(value: unknown) {
  if (!active || !value || typeof value !== 'object') return
  const row = value as Record<string, any>
  const stage = row.stage
  const checkpoint = row.visualCheckpoint
  if (row.performanceSummary?.phase === 'INDEX' && firstIndexMs === null) firstIndexMs = performance.now() - started
  if (stage === 'VISUAL' || checkpoint) phase = checkpoint?.phase ?? 'FEATURES'
  else if (stage) phase = String(stage)
  if (phase === 'INDEX' && firstIndexMs === null) firstIndexMs = performance.now() - started
}
const db = raw.$extends({ query: { $allOperations: async ({ model, operation, args, query }) => {
  if (active) { apiCalls++; stats().apiCalls++ }
  if (model === 'ArtworkDedupRun' && operation === 'update') setPhase((args as any).data)
  const result = await query(args)
  if (model === 'ArtworkDedupRun' && ['findUnique','findUniqueOrThrow'].includes(operation)) setPhase(result)
  return result
} } })
const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { transactionTimeoutMs: 20_000 })
const capabilities = [{ jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [8] }]
const measurements: unknown[] = [], events: unknown[] = [], slices: unknown[] = []
function context(job: ClaimedJob): ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  const wrap = async <T>(operation: () => Promise<T>) => {
    mutationTransactions++; const began = performance.now(), row = stats()
    try { return await operation() } finally { const elapsed = performance.now() - began; transactionWallMs += elapsed; row.transactionWallMs += elapsed }
  }
  return { job, payload: job.payload as ArtworkDedupScanPayload, signal: new AbortController().signal,
    progress: update => repository.updateProgress({ ...fence, ...update }), enqueueChild: async () => { throw Error('Unexpected child') },
    mutateInTransaction: operation => wrap(() => repository.withFencedMutationTransaction(fence, operation)),
    finalizeInTransaction: async operation => { await wrap(() => repository.withFencedExecutionTransaction(fence, operation)); return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME },
    logger: { debug() {}, warn() {}, error() {}, info(message, data) { if (message === 'artwork-dedup.performance') { if ((data as any)?.phase === 'INDEX' && firstIndexMs === null) firstIndexMs = performance.now() - started; events.push({ elapsedMs: performance.now() - started, data }) } } }
  }
}
try {
  assert.equal((await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0]?.name, url.pathname.slice(1))
  const identity = await db.$transaction(async tx => {
    const { run } = await freezeArtworkDedupRun(tx, { artistId: manifest.artistId, requestedBy: manifest.account.userId, idempotencyKey: randomUUID(), mode: action === 'warm' ? 'FULL' : 'INCREMENTAL', includeSuspectedVersions: true })
    const job = await tx.systemJob.create({ data: { id: randomUUID(), type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 8, executionLane: 'BACKGROUND_WRITER', status: 'PENDING', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: new Date(), maxAttempts: 3, payload: { runId: run.id, executionVersion: 1 } } })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return { runId: run.id, jobId: job.id }
  })
  if (action === 'enqueue') {
    await fs.writeFile(path.join(base, label + '-run.json'), stringify(identity) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(stringify({ action, label, ...identity })); process.exitCode = 0
  } else {
    const executor = createArtworkDedupExecutor({ database: db as unknown as PrismaClient, sourceRoot: manifest.root, archiveRoot: manifest.root,
      readerOptions: { entrypoint: path.join(path.dirname(process.argv[1]!), 'artwork-dedup-reader.cjs'), execArgv: [] },
      onMeasurement: measurement => { measurements.push(measurement) }
    }, 8)
    started = performance.now(); active = true
    for (;;) {
      const queued = await db.systemJob.findUniqueOrThrow({ where: { id: identity.jobId } })
      if (queued.status === 'COMPLETED') break
      assert.ok(['PENDING','RETRY_WAIT'].includes(queued.status), 'Unexpected job state ' + queued.status)
      const waitMs = Math.max(0, queued.availableAt.getTime() - Date.now()); if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs + 3))
      const job = await repository.claim('hot-check-' + label, capabilities); assert.equal(job?.id, identity.jobId); assert.ok(job)
      const began = performance.now(), beforeSql = [...statements.values()].reduce((n, row) => n + row.count, 0), beforeTransactions = mutationTransactions
      const heartbeat = setInterval(() => { void repository.heartbeat({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }) }, 15_000)
      try { await executor.execute(context(job)) } finally { clearInterval(heartbeat) }
      active = false
      const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: identity.runId } }), jobState = await db.systemJob.findUniqueOrThrow({ where: { id: identity.jobId } })
      const slice = { stage: run.stage, phase, wallMs: performance.now() - began, elapsedMs: performance.now() - started,
        mutationTransactions: mutationTransactions - beforeTransactions, sqlStatements: [...statements.values()].reduce((n, row) => n + row.count, 0) - beforeSql,
        status: jobState.status, availableAt: jobState.availableAt, schedulingRemainingMs: Math.max(0, jobState.availableAt.getTime() - Date.now()),
        statMedia: run.statMedia, hashedMedia: run.hashedMedia, cacheHitMedia: run.cacheHitMedia, readBytes: String(run.readBytes) }
      slices.push(slice); console.log('HOT_CHECK_SLICE ' + stringify({ label, ...slice }))
      if (jobState.status === 'COMPLETED') break
      assert.equal(jobState.status, 'RETRY_WAIT', 'Run failed: ' + run.errorCode); active = true
    }
    active = false
    const elapsedMs = performance.now() - started
    const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: identity.runId } })
    const groups = await db.artworkDedupGroup.findMany({ where: { runId: run.id }, orderBy: { id: 'asc' }, include: { members: { orderBy: { artworkId: 'asc' } } } })
    const pairs = await db.artworkDedupVisualPair.findMany({ where: { runId: run.id }, orderBy: [{ leftArtworkId: 'asc' }, { rightArtworkId: 'asc' }], include: { pages: { orderBy: { ordinal: 'asc' } } } })
    const result = { observedAt: new Date().toISOString(), label, action, ...identity, node: process.version, input: { artistId: manifest.artistId, artworks: manifest.artworks.length, media: manifest.files, fileStateDigest: manifest.fileStateDigest },
      elapsedMs, preIndexMs: firstIndexMs, mutationTransactions, transactionWallMs, instrumentedApiCalls: apiCalls,
      sqlStatements: [...statements.values()].reduce((n, row) => n + row.count, 0), phases: Object.fromEntries(phases), statements: [...statements.values()].sort((a,b) => b.count-a.count),
      measurements, events, slices, run,
      resultSummary: { status: run.status, stage: run.stage, statMedia: run.statMedia, hashedMedia: run.hashedMedia, cacheHitMedia: run.cacheHitMedia, readBytes: String(run.readBytes), groupCount: run.groupCount, duplicateArtworks: run.duplicateArtworks, failedArtworks: run.failedArtworks, changedArtworks: run.changedArtworks,
        groups: groups.map(g => g.members.map(m => m.artworkId)).sort((a,b) => a[0]!-b[0]!), pairs: pairs.map(p => ({ left: p.leftArtworkId, right: p.rightArtworkId, kind: p.relationKind, summary: p.summary, pages: p.pages.map(page => [page.kind,page.leftImageId,page.rightImageId]) })) },
      metricMeaning: 'Full executor STAT + HASH + FEATURES + search + publish and real scheduling waits; fixture freeze and result audit excluded. SQL query events include queue fence/claim/settlement and transaction control, omit bind values. API instrumentation includes all observed Prisma model/raw operations; persisted performance counters use executor capture cutoff. Mutation transaction wall includes round trips. preIndexMs is first observed INDEX checkpoint update/read; includes original stat/cache checks. One run per revision, warm filesystem/page cache, no browser or Worker service competing.' }
    await fs.writeFile(path.join(base,'evidence',label+'.json'), stringify(result)+'\n', { mode: 0o600, flag: 'wx' })
    console.log('HOT_CHECK_RESULT ' + stringify({ label, elapsedMs, preIndexMs: firstIndexMs, mutationTransactions, sqlStatements: result.sqlStatements, status: run.status, cacheHitMedia: run.cacheHitMedia, groups: run.groupCount, pairs: pairs.length, resultDigest: digest(result.resultSummary) }))
    assert.equal(run.status, 'COMPLETED')
    if (action === 'measure') { assert.equal(run.readBytes, 0n); assert.equal(run.hashedMedia, 0); assert.equal(run.cacheHitMedia, manifest.files) }
  }
} finally { await raw.$disconnect() }

}
main().catch(error => { console.error(error); process.exitCode = 1 })
