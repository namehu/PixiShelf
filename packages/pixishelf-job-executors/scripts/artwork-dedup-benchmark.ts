/**
 * Isolated, real-I/O scale probe. Run through the Worker's installed tsx with this
 * package's tsconfig; see the dated performance record for the exact command.
 * Cold means an empty fingerprint cache, never an OS/NAS cold-cache claim.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient, freezeArtworkDedupRun } from '@pixishelf/db'
import {
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup, type ArtworkDedupDependencies } from '../src/artwork-dedup/executor.ts'

const args = process.argv.slice(2)
function option(name: string, fallback: string) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : (args[index + 1] ?? '')
}
const scenario = option('case', 'sparse')
assert(scenario === 'sparse' || scenario === 'all', '--case must be sparse or all')
const tag = option('tag', `phase2-${scenario}`)
assert(/^[a-z0-9][a-z0-9-]{2,48}$/.test(tag), 'Use a bounded lowercase --tag')
const artworkCount = Number(option('artworks', '1000'))
const mediaPerArtwork = Number(option('media', '500'))
assert(Number.isSafeInteger(artworkCount) && artworkCount >= 2 && artworkCount <= 1000)
assert(Number.isSafeInteger(mediaPerArtwork) && mediaPerArtwork >= 1 && mediaPerArtwork <= 500)
const url = process.env.DEDUP_BENCHMARK_DATABASE_URL
assert(url, 'DEDUP_BENCHMARK_DATABASE_URL is required; no ambient DATABASE_URL fallback')
const parsed = new URL(url)
assert(['postgres:', 'postgresql:'].includes(parsed.protocol))
assert(['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname), 'Only loopback databases are permitted')
assert(parsed.pathname === '/dedup_scale', 'Only the dedicated dedup_scale database is permitted')
const prefix = `dedup-scale:${tag}:`
const root = path.join('/tmp', `dedup-scale-${tag}`)
const mediaDirectory = `media-${tag}`
const manifestPath = path.join(root, 'benchmark.json')
const logPath = path.join(root, 'measurements.jsonl')
const json = (value: unknown) => JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item))
type SqlCounts = {
  queries: number
  mutations: number
  begins: number
  commits: number
  rollbacks: number
  durationMs: number
}
const emptySql = (): SqlCounts => ({ queries: 0, mutations: 0, begins: 0, commits: 0, rollbacks: 0, durationMs: 0 })
let sql = emptySql()
const db = new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] })
db.$on('query', (event) => {
  sql.queries++
  sql.durationMs += event.duration
  const query = event.query.trim()
  if (/\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(query)) sql.mutations++
  if (/^BEGIN\b/i.test(query)) sql.begins++
  if (/^COMMIT\b/i.test(query)) sql.commits++
  if (/^ROLLBACK\b/i.test(query)) sql.rollbacks++
})
const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { transactionTimeoutMs: 30_000 })
const capabilities = [
  { jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }
]
const workerRequire = createRequire(new URL('../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: fileURLToPath(new URL('../src/artwork-dedup/reader-child.ts', import.meta.url)),
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
type Measurement = Parameters<NonNullable<ArtworkDedupDependencies['onMeasurement']>>[0]
type RunRef = { runId: string; jobId: string; temperature: 'cold' | 'hot'; startedAt: string }
type Manifest = {
  owner: 'pixishelf-artwork-dedup-benchmark-v1'
  tag: string
  scenario: string
  artworkCount: number
  mediaPerArtwork: number
  artistId?: number
  physicalFiles?: number
  physicalBytes?: number
  runs: RunRef[]
}
let manifest: Manifest = {
  owner: 'pixishelf-artwork-dedup-benchmark-v1',
  tag,
  scenario,
  artworkCount,
  mediaPerArtwork,
  runs: []
}
async function emit(value: Record<string, unknown>) {
  const line = json({ at: new Date().toISOString(), ...value })
  process.stdout.write(`${line}\n`)
  await fs.appendFile(logPath, `${line}\n`)
}
async function saveManifest() {
  await fs.writeFile(manifestPath, `${json(manifest)}\n`)
}
async function validateDatabase() {
  const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`
  assert.equal(rows[0]?.name, 'dedup_scale')
  const foreign = await db.systemJob.count({
    where: {
      id: { not: { startsWith: prefix } },
      status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSING', 'CANCELLING'] }
    }
  })
  assert.equal(foreign, 0, 'Refusing to claim work while another fixture owns runnable jobs')
}
async function cleanupOwnedRecords() {
  const sharedFixture = await fs
    .access(path.join(root, 'contention-retained.json'))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return false
    })
  assert.equal(
    sharedFixture,
    false,
    'Shared contention evidence is retained. Remove its exact runs, artist links, archive publication and source gates before removing the retention marker; baseline cleanup must not delete shared media.'
  )
  // All shared references are checked before the first mutation, including completed foreign runs.
  const ownedArtworks = await db.artwork.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } })
  const foreignFrozenItems = await db.artworkDedupItem.count({
    where: {
      artworkId: { in: ownedArtworks.map((value) => value.id) },
      run: { requestedBy: { not: prefix } }
    }
  })
  assert.equal(foreignFrozenItems, 0, 'Another fixture has frozen these artworks; preserve the shared fixture')
  const foreignArtistLinks = await db.artworkArtist.count({
    where: {
      artwork: { title: { startsWith: prefix } },
      artist: { name: { not: `${prefix}artist` } }
    }
  })
  assert.equal(foreignArtistLinks, 0, 'Another fixture references these artworks; preserve the shared fixture')
  const occupied = await db.artworkDedupRun.count({ where: { requestedBy: prefix, readerToken: { not: null } } })
  assert.equal(occupied, 0, 'Reader ownership remains; inspect/recover it before cleanup')
  const leases = await db.jobResourceLease.count({ where: { ownerJobId: { startsWith: prefix } } })
  assert.equal(leases, 0, 'A live fixture lease remains; do not remove running work')
  const directories = await db.artworkDedupMedia.findMany({
    where: { item: { run: { requestedBy: prefix } } },
    distinct: ['rootIdentity'],
    select: { rootIdentity: true }
  })
  for (const { rootIdentity } of directories) {
    const foreignRootSources = await db.mediaContentSource.count({
      where: {
        directory: { rootIdentity },
        OR: [{ image: { artworkId: null } }, { image: { artwork: { title: { not: { startsWith: prefix } } } } }]
      }
    })
    assert.equal(foreignRootSources, 0, 'Shared root has foreign media references; no records have been deleted')
    const foreignRootRuns = await db.artworkDedupRun.count({
      where: {
        requestedBy: { not: prefix },
        OR: [
          { rootBindings: { path: ['source', 'rootIdentity'], equals: rootIdentity } },
          { rootBindings: { path: ['archive', 'rootIdentity'], equals: rootIdentity } }
        ]
      }
    })
    assert.equal(foreignRootRuns, 0, 'Another run retains this root identity; no records have been deleted')
    assert.equal(
      await db.mediaContentPathWrite.count({ where: { directory: { rootIdentity } } }),
      0,
      'Root contains write/recovery evidence; preserve it before cleanup'
    )
  }
  await db.artworkDedupRun.deleteMany({ where: { requestedBy: prefix } })
  await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.image.deleteMany({ where: { artwork: { title: { startsWith: prefix } } } })
  await db.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
  await db.artist.deleteMany({ where: { name: `${prefix}artist` } })
  for (const { rootIdentity } of directories) {
    // Each benchmark owns a distinct temporary root identity, never a shared gallery root.
    assert.equal(await db.mediaContentSource.count({ where: { directory: { rootIdentity } } }), 0)
    await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
  }
}
async function prepare() {
  await cleanupOwnedRecords()
  await fs.mkdir(path.join(root, mediaDirectory), { recursive: true })
  const bytes = 4096
  let physicalFiles = 0,
    physicalBytes = 0
  for (let index = 0; index < mediaPerArtwork; index++) {
    await fs.writeFile(path.join(root, mediaDirectory, `shared-${index}.bin`), Buffer.alloc(bytes, index % 251))
    physicalFiles++
    physicalBytes += bytes
  }
  if (scenario === 'sparse') {
    for (let index = 2; index < artworkCount; index++) {
      const size = bytes + index
      await fs.writeFile(path.join(root, mediaDirectory, `unique-${index}.bin`), Buffer.alloc(size, index % 251))
      physicalFiles++
      physicalBytes += size
    }
  }
  const artist = await db.artist.create({ data: { name: `${prefix}artist` } })
  manifest.artistId = artist.id
  manifest.physicalFiles = physicalFiles
  manifest.physicalBytes = physicalBytes
  await saveManifest()
  const started = Date.now()
  for (let index = 0; index < artworkCount; index++) {
    const artwork = await db.artwork.create({
      data: {
        title: `${prefix}artwork-${index}`,
        source: 'LOCAL_IMPORT',
        imageCount: mediaPerArtwork,
        creators: {
          create: {
            artistId: artist.id,
            evidence: {
              create: {
                provenance: 'MANUAL',
                evidenceKey: `${prefix}${index}`,
                present: true
              }
            }
          }
        }
      }
    })
    await db.image.createMany({
      data: Array.from({ length: mediaPerArtwork }, (_, media) => ({
        artworkId: artwork.id,
        sortOrder: media,
        path: `${mediaDirectory}/${scenario === 'sparse' && index >= 2 && media === 0 ? `unique-${index}` : `shared-${media}`}.bin`
      }))
    })
    if ((index + 1) % 50 === 0 || index + 1 === artworkCount)
      await emit({
        event: 'fixture-progress',
        artworks: index + 1,
        registeredMedia: (index + 1) * mediaPerArtwork,
        elapsedMs: Date.now() - started
      })
  }
  await emit({
    event: 'fixture-ready',
    ...manifest,
    registeredMedia: await db.image.count({ where: { artwork: { title: { startsWith: prefix } } } }),
    fixtureMs: Date.now() - started
  })
}
async function start(temperature: RunRef['temperature']): Promise<RunRef> {
  assert(manifest.artistId)
  const value = await db.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId: manifest.artistId!,
      requestedBy: prefix,
      idempotencyKey: temperature,
      mode: 'INCREMENTAL'
    })
    const job = await tx.systemJob.create({
      data: {
        id: `${prefix}${temperature}`,
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: new Date(),
        maxAttempts: 3,
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return { runId: run.id, jobId: job.id, temperature, startedAt: new Date().toISOString() }
  })
  manifest.runs.push(value)
  await saveManifest()
  return value
}
function context(job: ClaimedJob): ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  return {
    job,
    payload: job.payload as ArtworkDedupScanPayload,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
async function measure(ref: RunRef) {
  const started = Date.now()
  const aggregate = {
    inspections: 0,
    reads: 0,
    bytesRead: 0n,
    statLatencyMs: 0,
    parentPeakRss: 0,
    childPeakRss: 0,
    ipcMessages: 0,
    transactions: 0,
    readerElapsedMs: 0
  }
  const allSliceSql = emptySql()
  const addMeasurement = (value: Omit<Measurement, 'bytesRead'> & { bytesRead: bigint | string }) => {
    aggregate.inspections += value.inspections
    aggregate.reads += value.reads
    aggregate.bytesRead += BigInt(value.bytesRead)
    aggregate.statLatencyMs += value.statLatencyMs
    aggregate.parentPeakRss = Math.max(aggregate.parentPeakRss, value.parentPeakRss)
    aggregate.childPeakRss = Math.max(aggregate.childPeakRss, value.childPeakRss)
    aggregate.ipcMessages += value.ipcMessages
    aggregate.transactions += value.transactions
    aggregate.readerElapsedMs += value.elapsedMs
  }
  const addSliceSql = (value: SqlCounts) => {
    for (const key of Object.keys(allSliceSql) as Array<keyof SqlCounts>) allSliceSql[key] += value[key]
  }
  let slices = 0,
    segments = 0,
    priorObservedSegmentMs = 0,
    priorSegmentElapsedMs = 0
  let firstStartedAt = ref.startedAt,
    lastSliceAt: string | null = null
  // Stream previous evidence so resumes preserve counters without loading media or the log as an array.
  for await (const line of createInterface({ input: createReadStream(logPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    if (entry.runId !== ref.runId) continue
    if (entry.event === 'run-start' || entry.event === 'run-resume') {
      if (segments === 0) firstStartedAt = entry.at
      else priorObservedSegmentMs += priorSegmentElapsedMs
      priorSegmentElapsedMs = 0
      segments++
    }
    if (entry.event === 'slice') {
      slices++
      lastSliceAt = entry.at
      priorSegmentElapsedMs = Math.max(priorSegmentElapsedMs, entry.elapsedMs)
      if (entry.measurement) addMeasurement(entry.measurement)
      addSliceSql(entry.sql)
    }
  }
  priorObservedSegmentMs += priorSegmentElapsedMs
  const previousSlices = slices
  const segment = segments + 1
  const gapSinceLastSliceMs = lastSliceAt ? started - Date.parse(lastSliceAt) : 0
  sql = emptySql()
  const rowsBefore = await db.$queryRaw<Array<{ table: string; inserted: bigint; updated: bigint; deleted: bigint }>>`
    SELECT relname AS "table", n_tup_ins AS inserted, n_tup_upd AS updated, n_tup_del AS deleted
    FROM pg_stat_user_tables ORDER BY relname`
  await emit({
    event: previousSlices ? 'run-resume' : 'run-start',
    ...ref,
    scenario,
    segment,
    previousSlices,
    lastSliceAt,
    gapSinceLastSliceMs,
    priorObservedSegmentMs,
    priorMetrics: aggregate,
    registeredMedia: artworkCount * mediaPerArtwork
  })
  for (;;) {
    const claimStarted = Date.now()
    let job: ClaimedJob | null = null
    let completedWhileWaiting = false,
      emptyClaims = 0,
      lastWaitLogAt = 0
    while (!job) {
      const queued = await db.systemJob.findUniqueOrThrow({ where: { id: ref.jobId } })
      if (queued.status === 'COMPLETED') {
        completedWhileWaiting = true
        break
      }
      assert(
        ['PENDING', 'RETRY_WAIT'].includes(queued.status),
        `Cannot resume ${queued.status}: ${queued.errorCode}; ${queued.error}`
      )
      assert(
        Date.now() - claimStarted < 120_000,
        `Job stayed unclaimable for two minutes (${queued.status}); checkpoint retained`
      )
      const waitMs = queued.availableAt.getTime() - Date.now()
      if (waitMs > 0) {
        await delay(Math.min(1000, waitMs + 5))
        continue
      }
      job = await repository.claim(prefix, capabilities)
      if (job) {
        assert.equal(job.id, ref.jobId, 'Unexpected queue claim')
        break
      }
      emptyClaims++
      if (!lastWaitLogAt || Date.now() - lastWaitLogAt >= 10_000) {
        await emit({
          event: 'claim-wait',
          runId: ref.runId,
          segment,
          emptyClaims,
          waitedMs: Date.now() - claimStarted,
          status: queued.status,
          availableAt: queued.availableAt,
          elapsedMs: Date.now() - started
        })
        lastWaitLogAt = Date.now()
      }
      await delay(100)
    }
    if (completedWhileWaiting) break
    assert(job)
    let measurement: Measurement | undefined
    const sliceStarted = Date.now()
    const before = { ...sql }
    let heartbeatError: unknown
    const timer = setInterval(() => {
      void repository
        .heartbeat({ jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt })
        .catch((error: unknown) => {
          heartbeatError = error
        })
    }, 15_000)
    try {
      await executeArtworkDedup(context(job), {
        database: db,
        sourceRoot: root,
        archiveRoot: root,
        readerOptions,
        onMeasurement: (value) => {
          measurement = value
        }
      })
    } finally {
      clearInterval(timer)
    }
    if (heartbeatError) throw heartbeatError
    const [current, run, leases] = await Promise.all([
      db.systemJob.findUniqueOrThrow({ where: { id: ref.jobId } }),
      db.artworkDedupRun.findUniqueOrThrow({ where: { id: ref.runId } }),
      db.jobResourceLease.count({ where: { ownerJobId: ref.jobId } })
    ])
    slices++
    const sqlDelta = Object.fromEntries(
      Object.entries(sql).map(([key, value]) => [key, value - before[key as keyof SqlCounts]])
    ) as SqlCounts
    addSliceSql(sqlDelta)
    if (measurement) addMeasurement(measurement)
    const cooldownRemainingMs = current.availableAt.getTime() - Date.now()
    const release = {
      leases,
      readerToken: run.readerToken,
      attempt: current.attempt,
      status: current.status,
      cooldownRemainingMs
    }
    await emit({
      event: 'slice',
      temperature: ref.temperature,
      runId: ref.runId,
      slice: slices,
      segment,
      stage: run.stage,
      wallMs: Date.now() - sliceStarted,
      elapsedMs: Date.now() - started,
      measurement,
      sql: sqlDelta,
      release,
      counts: {
        statMedia: run.statMedia,
        hashedMedia: run.hashedMedia,
        cacheHitMedia: run.cacheHitMedia,
        readBytes: run.readBytes,
        processedArtworks: run.processedArtworks,
        completeArtworks: run.completeArtworks
      }
    })
    assert.equal(leases, 0, 'Writer lease retained after slice')
    assert.equal(run.readerToken, null, 'Reader has not proven close')
    if (current.status === 'COMPLETED') break
    assert.equal(current.status, 'RETRY_WAIT', `Run failed: ${run.errorCode}`)
    assert.equal(current.attempt, 0, 'Scheduling yield consumed an attempt')
    // Finalization/diagnostic queries may consume part or all of the real cooldown.
    // The claim loop observes availableAt again instead of treating elapsed time as failure.
    assert(cooldownRemainingMs <= 3000, 'Cooldown was scheduled beyond the configured three seconds')
  }
  const run = await db.artworkDedupRun.findUniqueOrThrow({ where: { id: ref.runId } })
  const expectedCandidates = (scenario === 'sparse' ? 2 : artworkCount) * mediaPerArtwork
  assert.equal(run.status, 'COMPLETED')
  assert.equal(run.completeArtworks, scenario === 'sparse' ? 2 : artworkCount)
  assert.equal(run.failedArtworks + run.changedArtworks, 0)
  assert.equal(run.groupCount, 1)
  assert.equal(run.statMedia, artworkCount * mediaPerArtwork + expectedCandidates)
  assert.equal(run.hashedMedia, ref.temperature === 'cold' ? expectedCandidates : 0)
  assert.equal(run.cacheHitMedia, ref.temperature === 'hot' ? expectedCandidates : 0)
  assert.equal(run.readBytes, ref.temperature === 'cold' ? BigInt(expectedCandidates * 4096) : 0n)
  assert.equal(
    aggregate.inspections,
    run.statMedia,
    'Persisted slice evidence does not cover every committed inspection'
  )
  assert.equal(aggregate.reads, run.hashedMedia, 'Persisted slice evidence does not cover every content read')
  assert.equal(aggregate.bytesRead, run.readBytes, 'Persisted slice byte evidence differs from committed I/O')
  const rowsAfter = await db.$queryRaw<typeof rowsBefore>`
    SELECT relname AS "table", n_tup_ins AS inserted, n_tup_upd AS updated, n_tup_del AS deleted
    FROM pg_stat_user_tables ORDER BY relname`
  await emit({
    event: 'run-result',
    ...ref,
    scenario,
    wallMs: Date.now() - Date.parse(firstStartedAt),
    segmentWallMs: Date.now() - started,
    observedSegmentMs: priorObservedSegmentMs + Date.now() - started,
    segments: segment,
    previousSlices,
    gapSinceLastSliceMs,
    slices,
    aggregate,
    sql,
    sqlScope:
      segment > 1
        ? 'Current segment only; allSliceSql combines persisted slice counters across segments and excludes inter-slice queue/statistics queries'
        : 'Whole measured run',
    allSliceSql,
    run,
    events: await db.systemJobEvent.count({ where: { jobId: ref.jobId } }),
    persistedMedia: await db.artworkDedupMedia.count({ where: { runId: ref.runId } }),
    fingerprints: await db.mediaContentFingerprint.count({
      where: { image: { artwork: { title: { startsWith: prefix } } } }
    }),
    tableStatsBefore: rowsBefore,
    tableStatsAfter: rowsAfter
  })
}
async function main() {
  await validateDatabase()
  const existing = await fs
    .readFile(manifestPath, 'utf8')
    .then((value) => JSON.parse(value) as Manifest)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
  if (existing) {
    assert.equal(existing.owner, manifest.owner)
    assert.equal(existing.tag, tag)
    const actual = await fs.realpath(root)
    assert.equal(
      actual,
      `/private/tmp/dedup-scale-${tag}`,
      'Fixture root must be the exact non-symlink temporary directory'
    )
    if (args.includes('--resume')) {
      assert.equal(existing.scenario, scenario)
      assert.equal(existing.artworkCount, artworkCount)
      assert.equal(existing.mediaPerArtwork, mediaPerArtwork)
      manifest = existing
    } else {
      await cleanupOwnedRecords()
      await fs.rm(root, { recursive: true })
    }
  } else {
    const occupied = await fs
      .lstat(root)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return false
      })
    assert.equal(occupied, false, 'Refusing to use a directory without our ownership manifest')
  }
  if (args.includes('--cleanup-only')) {
    await cleanupOwnedRecords()
    return
  }
  await fs.mkdir(root, { recursive: true })
  await saveManifest()
  if (!args.includes('--resume')) await prepare()
  if (args.includes('--reset-runs')) {
    assert(args.includes('--resume'), '--reset-runs requires --resume and retains the registered fixture')
    assert.equal(await db.artworkDedupRun.count({ where: { requestedBy: prefix, readerToken: { not: null } } }), 0)
    assert.equal(await db.jobResourceLease.count({ where: { ownerJobId: { startsWith: prefix } } }), 0)
    assert.equal(
      await db.mediaContentFingerprint.count({ where: { image: { artwork: { title: { startsWith: prefix } } } } }),
      0,
      'Reset only pre-I/O fixture failures; do not mislabel a populated cache as cold'
    )
    await db.artworkDedupRun.deleteMany({ where: { requestedBy: prefix } })
    await db.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    manifest.runs = []
    await saveManifest()
  }
  for (const temperature of (args.includes('--cold-only') ? ['cold'] : ['cold', 'hot']) as RunRef['temperature'][]) {
    const ref = manifest.runs.find((value) => value.temperature === temperature) ?? (await start(temperature))
    if ((await db.artworkDedupRun.findUniqueOrThrow({ where: { id: ref.runId } })).status !== 'COMPLETED')
      await measure(ref)
  }
}
try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
