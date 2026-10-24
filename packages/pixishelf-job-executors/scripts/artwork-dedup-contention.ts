/** Real archive download/publication and authenticated HTTP contention over the retained all-candidate fixture. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { PrismaClient, freezeArtworkDedupRun } from '@pixishelf/db'
import {
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type ExecutionContext,
  type EnqueuedChildJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup, type ArtworkDedupDependencies } from '../src/artwork-dedup/executor.ts'
import { createArchiveExecutorRegistrations } from '../src/archive/executor.ts'
import type { ArchiveExecutorDependencies, ArchiveRemoteMedia } from '../src/archive/types.ts'

const url = process.env.DEDUP_BENCHMARK_DATABASE_URL
assert(url, 'Use the explicit isolated benchmark URL')
const parsed = new URL(url)
assert(['postgres:', 'postgresql:'].includes(parsed.protocol))
assert(['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/dedup_scale')
const root = '/tmp/dedup-scale-phase2-all'
assert.equal(await fs.realpath(root), path.join(await fs.realpath('/tmp'), 'dedup-scale-phase2-all'))
const fixture = JSON.parse(await fs.readFile(path.join(root, 'benchmark.json'), 'utf8')) as {
  owner: string
  tag: string
  scenario: string
  artworkCount: number
  mediaPerArtwork: number
}
assert.equal(fixture.owner, 'pixishelf-artwork-dedup-benchmark-v1')
assert.equal(fixture.tag, 'phase2-all')
assert.equal(fixture.scenario, 'all')
const browserUrl = process.env.DEDUP_BENCHMARK_BROWSER_URL
const cookieFile = process.env.DEDUP_BENCHMARK_BROWSER_COOKIE_FILE
const browserCookie =
  process.env.DEDUP_BENCHMARK_BROWSER_COOKIE ??
  (cookieFile ? (await fs.readFile(cookieFile, 'utf8')).trim() : undefined)
assert(browserUrl && browserCookie, 'Supply an authenticated, read-only application URL and synthetic session cookie')
assert(['127.0.0.1', '[::1]', 'localhost'].includes(new URL(browserUrl).hostname))
assert.equal(new URL(browserUrl).pathname, '/api/trpc/artwork.cardList', 'Use the known read-only artwork query')
const prefix = 'dedup-scale:phase2-contention:'
const importId = 'dedup-scale-phase2-contention-archive'
const logPath = path.join(root, 'contention-measurements.jsonl')
const json = (value: unknown) => JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item))
async function emit(value: Record<string, unknown>) {
  const line = json({ at: new Date().toISOString(), ...value })
  process.stdout.write(`${line}\n`)
  await fs.appendFile(logPath, `${line}\n`)
}
const db = new PrismaClient({ datasourceUrl: url })
const repo = new PostgresQueueRepository(db as unknown as QueueDatabase)
const workerRequire = createRequire(new URL('../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: fileURLToPath(new URL('../src/artwork-dedup/reader-child.ts', import.meta.url)),
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
function context<TPayload>(job: ClaimedJob): ExecutionContext<TPayload, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as TPayload,
    signal: new AbortController().signal,
    progress: (update) => repo.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected enqueueChild')
    },
    mutateInTransaction: (operation) => repo.withFencedMutationTransaction(fence(job), operation),
    finalizeInTransaction: async (operation) => {
      await repo.withFencedExecutionTransaction(fence(job), operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
const writerCapabilities = [
  { jobType: 'ARTWORK_DEDUP_SCAN' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] },
  { jobType: 'ARCHIVE_PUBLISH' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }
]
const png = await sharp(randomBytes(512 * 512 * 3), { raw: { width: 512, height: 512, channels: 3 } })
  .png({ compressionLevel: 1 })
  .toBuffer()
let servedBytes = 0,
  servedRequests = 0
const sourceServer = createServer((request, response) => {
  if (!request.url?.startsWith('/synthetic/')) {
    response.writeHead(404).end()
    return
  }
  servedRequests++
  response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
  let offset = 0
  const timer = setInterval(() => {
    const chunk = png.subarray(offset, offset + 16_384)
    servedBytes += chunk.length
    response.write(chunk)
    offset += chunk.length
    if (offset >= png.length) {
      clearInterval(timer)
      response.end()
    }
  }, 10)
  response.once('close', () => clearInterval(timer))
})
const browserSamples: Array<{ ms: number; bytes: number }> = []
let stopBrowser = false
async function browseOnce() {
  const started = performance.now()
  const response = await fetch(browserUrl!, {
    headers: { cookie: browserCookie! },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })
  assert.equal(
    response.status,
    200,
    `Authenticated browsing returned ${response.status}; redirects are not browsing evidence`
  )
  const body = await response.arrayBuffer()
  const payload = JSON.parse(Buffer.from(body).toString('utf8')) as {
    result?: { data?: { items?: Array<{ title?: string }> } }
  }
  const items = payload.result?.data?.items
  assert(
    items?.length && items.some((item) => item.title?.startsWith('dedup-scale:')),
    'Authenticated query must return the synthetic artwork fixture'
  )
  const sample = { ms: performance.now() - started, bytes: body.byteLength }
  return sample
}
async function browse() {
  while (!stopBrowser) {
    const sample = await browseOnce()
    browserSamples.push(sample)
    if (browserSamples.length % 20 === 0)
      await emit({ event: 'browser-progress', requests: browserSamples.length, latest: sample })
    await delay(250)
  }
}
async function seed() {
  const databases = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`
  assert.equal(databases[0]?.name, 'dedup_scale')
  assert.equal(
    await db.systemJob.count({
      where: { status: { in: ['RUNNING', 'PENDING', 'RETRY_WAIT', 'PAUSING', 'CANCELLING'] } }
    }),
    0,
    'Run baseline measurements to completion first'
  )
  assert.equal(
    await db.artist.count({ where: { name: { startsWith: prefix } } }),
    0,
    'This evidence fixture already exists; preserve and inspect it before a new tag/run'
  )
  const works = await db.artwork.findMany({
    where: { title: { startsWith: 'dedup-scale:phase2-all:artwork-' } },
    orderBy: { id: 'asc' },
    take: 40,
    select: { id: true }
  })
  assert.equal(works.length, 40)
  // This permanent marker protects the shared baseline before the first fixture mutation.
  await fs.writeFile(
    path.join(root, 'contention-retained.json'),
    json({
      owner: prefix,
      importId,
      root,
      artworkIds: works.map((value) => value.id),
      createdAt: new Date().toISOString()
    }),
    { flag: 'wx' }
  )
  const refs: Array<{ runId: string; jobId: string; artistId: number }> = []
  for (let artistIndex = 0; artistIndex < 2; artistIndex++) {
    const artist = await db.artist.create({ data: { name: `${prefix}artist-${artistIndex}` } })
    for (const work of works.slice(artistIndex * 20, (artistIndex + 1) * 20))
      await db.artworkArtist.create({
        data: {
          artworkId: work.id,
          artistId: artist.id,
          evidence: { create: { provenance: 'MANUAL', evidenceKey: `${prefix}${artist.id}`, present: true } }
        }
      })
    const ref = await db.$transaction(async (tx) => {
      const { run } = await freezeArtworkDedupRun(tx, {
        artistId: artist.id,
        requestedBy: prefix,
        idempotencyKey: `artist-${artistIndex}`,
        mode: 'FULL'
      })
      const job = await tx.systemJob.create({
        data: {
          id: `${prefix}dedup-${artistIndex}`,
          type: 'ARTWORK_DEDUP_SCAN',
          executionLane: 'BACKGROUND_WRITER',
          definitionVersion: 1,
          triggerSource: 'SYSTEM',
          queuePriority: 900,
          effectivePriority: 900,
          availableAt: new Date(),
          payload: { runId: run.id, executionVersion: 1 }
        }
      })
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
      return { runId: run.id, jobId: job.id, artistId: artist.id }
    })
    refs.push(ref)
  }
  const downloadJob = await db.systemJob.create({
    data: {
      id: `${prefix}download`,
      type: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      definitionVersion: 1,
      triggerSource: 'MANUAL',
      queuePriority: 10,
      effectivePriority: 10,
      availableAt: new Date(),
      payload: { archiveImportId: importId, defaultTagIds: [] }
    }
  })
  await db.archiveImport.create({
    data: {
      id: importId,
      systemJobId: downloadJob.id,
      phase: 'DOWNLOAD',
      origin: 'MANUAL',
      providerKey: 'benchmark',
      externalId: importId,
      submittedUrl: 'http://127.0.0.1/synthetic/archive',
      canonicalUrl: `http://127.0.0.1/synthetic/${importId}`,
      locator: {},
      normalizedMetadata: { titles: { display: `${prefix}downloaded-artwork` } },
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'synthetic',
      stagingPath: `.archive-staging/${importId}`,
      totalItems: 60,
      executions: { create: { jobId: downloadJob.id, phase: 'DOWNLOAD' } },
      items: {
        create: Array.from({ length: 60 }, (_, pageIndex) => ({
          pageIndex,
          sourcePageUrl: `http://127.0.0.1/synthetic/${pageIndex}`,
          locator: {},
          expectedFilename: `synthetic-${pageIndex}.png`
        }))
      }
    }
  })
  return refs
}
async function main() {
  await browseOnce() // Warm the authenticated endpoint before creating fixture work.
  const browserBaseline = []
  for (let index = 0; index < 20; index++) {
    browserBaseline.push(await browseOnce())
    await delay(100)
  }
  await emit({ event: 'browser-baseline', samples: browserBaseline })
  const refs = await seed()
  await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve))
  const address = sourceServer.address()
  assert(address && typeof address !== 'string')
  const deps: ArchiveExecutorDependencies = {
    database: db,
    config: { sourceMediaRoot: root, scanRoot: root, mediaConcurrency: 2 },
    providers: {
      get: () => ({
        key: 'benchmark',
        openMedia: async (item, input) =>
          new Promise<ArchiveRemoteMedia>((resolve, reject) => {
            const request = get(
              `http://127.0.0.1:${address.port}/synthetic/${item.index}`,
              { signal: input.signal },
              (response) => {
                if (response.statusCode !== 200) {
                  response.resume()
                  reject(new Error('Synthetic HTTP source failed'))
                  return
                }
                resolve({
                  stream: response,
                  contentLength: png.length,
                  mimeType: 'image/png',
                  originalFilename: `synthetic-${item.index}.png`,
                  quality: 'ORIGINAL',
                  remoteHost: '127.0.0.1',
                  httpStatus: 200
                })
              }
            )
            request.once('error', reject)
          })
      })
    }
  }
  const registrations = createArchiveExecutorRegistrations(deps)
  const download = await repo.claim(`${prefix}download-worker`, 'ARCHIVE_DOWNLOAD', [
    { jobType: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', definitionVersions: [1] }
  ])
  assert.equal(download?.id, `${prefix}download`)
  assert(download)
  const downloadExecutor = registrations.find((entry) => entry.jobType === 'ARCHIVE_DOWNLOAD')!
  const started = Date.now()
  let downloadFinished = false
  await emit({
    event: 'contention-start',
    refs,
    registeredMedia: 20_000,
    mode: 'FULL',
    expectedReadBytes: 20_000 * 4096,
    archiveFiles: 60,
    archiveFileBytes: png.length,
    browserPath: new URL(browserUrl!).pathname
  })
  let backgroundFailure: unknown
  const browsing = browse().catch((error: unknown) => {
    backgroundFailure = error
  })
  const downloading = downloadExecutor
    .execute({ ...context(download), payload: downloadExecutor.parsePayload!(download.payload) })
    .then(async () => {
      downloadFinished = true
      const archive = await db.archiveImport.findUniqueOrThrow({ where: { id: importId } })
      assert.equal(archive.phase, 'PUBLISH')
      await emit({
        event: 'download-finished',
        elapsedMs: Date.now() - started,
        completedItems: archive.completedItems,
        servedRequests,
        servedBytes
      })
    })
  const completedDownload = downloading.catch((error: unknown) => {
    backgroundFailure = error
  })
  let lastWriterProgressAt = Date.now()
  let writerExecutions = 0
  let publicationWaitMs: number | null = null
  try {
    for (;;) {
      if (backgroundFailure) throw backgroundFailure
      assert(
        Date.now() - started < 10 * 60_000,
        'Contention run exceeded the ten-minute deadline; preserve the fixture'
      )
      assert(
        Date.now() - lastWriterProgressAt < 120_000,
        'Writer made no progress for two minutes; preserve the fixture'
      )
      const stopped = await db.artworkDedupRun.findFirst({
        where: { id: { in: refs.map((value) => value.runId) }, status: { in: ['FAILED', 'CANCELLED', 'PAUSED'] } },
        select: { id: true, status: true, errorCode: true }
      })
      assert.equal(stopped, null, `Detection stopped: ${json(stopped)}`)
      const completed = await db.artworkDedupRun.count({
        where: { id: { in: refs.map((value) => value.runId) }, status: 'COMPLETED' }
      })
      const archive = await db.archiveImport.findUniqueOrThrow({ where: { id: importId } })
      assert(
        !['FAILED', 'PARTIAL_FAILED', 'PAUSED', 'CANCELLED'].includes(archive.status),
        `Archive stopped: ${archive.status}`
      )
      if (completed === refs.length && archive.status === 'COMPLETED') break
      const job = await repo.claim(`${prefix}writer`, 'BACKGROUND_WRITER', writerCapabilities)
      if (!job) {
        await delay(200)
        continue
      }
      assert(job.type === 'ARCHIVE_PUBLISH' || refs.some((value) => value.jobId === job.id))
      lastWriterProgressAt = Date.now()
      writerExecutions++
      const executionStarted = Date.now()
      if (job.type === 'ARCHIVE_PUBLISH') {
        const row = await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })
        assert.equal(row.parentJobId, download.id)
        publicationWaitMs = Date.now() - row.availableAt.getTime()
        const executor = registrations.find((entry) => entry.jobType === 'ARCHIVE_PUBLISH')!
        await executor.execute({ ...context(job), payload: executor.parsePayload!(job.payload) })
        const publishedJob = await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })
        const publishedImport = await db.archiveImport.findUniqueOrThrow({ where: { id: importId } })
        assert.equal(
          publishedJob.status,
          'COMPLETED',
          `Publication job stopped: ${publishedJob.status}; ${publishedJob.errorCode}`
        )
        assert.equal(publishedImport.status, 'COMPLETED', `Publication import stopped: ${publishedImport.status}`)
        await emit({
          event: 'publication-finished',
          jobId: job.id,
          elapsedMs: Date.now() - started,
          executionMs: Date.now() - executionStarted,
          writerWaitMs: publicationWaitMs
        })
      } else {
        let measurement: Parameters<NonNullable<ArtworkDedupDependencies['onMeasurement']>>[0] | undefined
        await executeArtworkDedup(context<ArtworkDedupScanPayload>(job), {
          database: db,
          sourceRoot: root,
          archiveRoot: root,
          readerOptions,
          onMeasurement: (value) => {
            measurement = value
          }
        })
        const run = await db.artworkDedupRun.findUniqueOrThrow({
          where: { id: (job.payload as ArtworkDedupScanPayload).runId }
        })
        const state = await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })
        const leases = await db.jobResourceLease.count({ where: { ownerJobId: job.id } })
        await emit({
          event: 'dedup-slice',
          jobId: job.id,
          elapsedMs: Date.now() - started,
          executionMs: Date.now() - executionStarted,
          downloadFinished,
          measurement,
          status: run.status,
          stage: run.stage,
          readerToken: run.readerToken,
          leases,
          availableAt: state.availableAt,
          readBytes: run.readBytes,
          hashedMedia: run.hashedMedia
        })
        assert(['RETRY_WAIT', 'COMPLETED'].includes(state.status), `Detection failed: ${run.errorCode}`)
        assert.equal(leases, 0)
        assert.equal(run.readerToken, null)
      }
    }
    await completedDownload
    if (backgroundFailure) throw backgroundFailure
  } finally {
    stopBrowser = true
    await browsing
  }
  if (backgroundFailure) throw backgroundFailure
  const runs = await db.artworkDedupRun.findMany({ where: { id: { in: refs.map((value) => value.runId) } } })
  for (const run of runs) {
    assert.equal(run.groupCount, 1)
    assert.equal(run.completeArtworks, 20)
    assert.equal(run.hashedMedia, 10_000)
    assert.equal(run.readBytes, 40_960_000n)
  }
  const sorted = browserSamples.map((value) => value.ms).sort((a, b) => a - b)
  const percentile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const archive = await db.archiveImport.findUniqueOrThrow({
    where: { id: importId },
    include: { items: true, generations: true }
  })
  assert.equal(archive.status, 'COMPLETED')
  assert.equal(archive.completedItems, 60)
  assert(archive.publishedArtworkId)
  assert.equal(await db.image.count({ where: { artworkId: archive.publishedArtworkId } }), 60)
  await emit({
    event: 'contention-result',
    wallMs: Date.now() - started,
    writerExecutions,
    publicationWaitMs,
    servedRequests,
    servedBytes,
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      statMedia: run.statMedia,
      hashedMedia: run.hashedMedia,
      readBytes: run.readBytes,
      groups: run.groupCount
    })),
    archive: {
      status: archive.status,
      publishedArtworkId: archive.publishedArtworkId,
      completedItems: archive.completedItems,
      storedBytes: archive.items.reduce((sum, item) => sum + (item.byteCount ?? 0n), 0n),
      sealedGenerations: archive.generations.filter((value) => value.sealedAt).length
    },
    browserBaseline,
    browser: {
      requests: browserSamples.length,
      totalBytes: browserSamples.reduce((sum, value) => sum + value.bytes, 0),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: sorted.at(-1),
      samples: browserSamples
    }
  })
}
try {
  await main()
} catch (error) {
  await emit({ event: 'contention-failed', message: error instanceof Error ? error.message : String(error) })
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
} finally {
  sourceServer.closeAllConnections()
  await new Promise<void>((resolve) => sourceServer.close(() => resolve()))
  await db.$disconnect()
}
