import { cleanupFixtureContentDirectories } from '../../scan/__tests__/content-directory-cleanup.ts'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import sharp from 'sharp'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import {
  executionLaneForJobType,
  type ArchiveImportV2Payload,
  type ArchiveMaintenancePayload,
  type JobType
} from '@pixishelf/job-contracts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArchiveExecutorRegistrations } from '../executor.js'
import { executeArchiveMaintenance } from '../maintenance-executor.js'
import type { ArchiveExecutorDependencies } from '../types.js'

// Keep all filesystem work real; only the final immutable manifest link may wait.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, link: vi.fn(actual.link) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

// Explicit isolated database only: never fall back to the application's DATABASE_URL.
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `download-recovery-${randomUUID()}`
const roots: string[] = []
const jobs = new Set<string>()
const initialTime = new Date('2026-10-23T12:00:00Z')
const clock = new MutableQueueClock(initialTime)
const repo = db ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, leaseDurationMs: 60_000 }) : null
const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#725a91' } })
  .png()
  .toBuffer()

suite('archive download drain and cleanup interleavings', () => {
  beforeEach(async () => {
    await cleanup()
    clock.set(initialTime)
    vi.mocked(link).mockImplementation(actualFs.link)
  })
  afterEach(() => {
    vi.mocked(link).mockImplementation(actualFs.link)
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it('does not drain or allow same-generation cleanup before the real manifest write finishes', async () => {
    const archive = await seed('manifest-drain')
    const download = await claim('ARCHIVE_DOWNLOAD')
    const manifest = blockManifestLink(download.executionToken)
    const running = execute(download, dependencies(archive.root))
    void running.catch(() => undefined)
    try {
      await manifest.waitUntilReached()
      const writing = await state(archive.id)
      const generation = writing.generations[0]!
      expect(writing.items[0]).toMatchObject({ status: 'COMPLETED', stagedGenerationPath: generation.path })
      expect(generation).toMatchObject({ drainedAt: null, sealedAt: null, cleanedAt: null })
      const temporaryManifest = await readFile(path.join(archive.root, generation.path, 'manifest.json.tmp'))
      expect(JSON.parse(temporaryManifest.toString()).generationToken).toBe(download.executionToken)
      await expect(readFile(path.join(archive.root, generation.path, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT'
      })

      // A control request and cleanup intent arrive while the last filesystem write is outstanding.
      await requestPause(download)
      await db!.archiveImport.update({ where: { id: archive.id }, data: { cleanupRequestedAt: clock.now() } })
      await seedCleanup(archive.id, 'manifest-cleanup')
      const maintenance = await claim('ARCHIVE_MAINTENANCE')
      await expect(maintain(maintenance, archive.root)).rejects.toThrow('归档清理当前状态不允许运行')
      expect(await readFile(path.join(archive.root, generation.path, 'manifest.json.tmp'))).toEqual(temporaryManifest)
      expect((await state(archive.id)).generations[0]?.drainedAt).toBeNull()

      manifest.release()
      await running
      const paused = await state(archive.id)
      expect(paused).toMatchObject({ status: 'PAUSED', phase: 'DOWNLOAD', systemJobId: download.id })
      expect(paused.generations[0]?.drainedAt).not.toBeNull()
      expect(paused.generations[0]?.sealedAt).toBeNull()
      expect(await db!.systemJob.count({ where: { parentJobId: download.id, type: 'ARCHIVE_PUBLISH' } })).toBe(0)
      expect(
        JSON.parse(await readFile(path.join(archive.root, generation.path, 'manifest.json'), 'utf8')).generationToken
      ).toBe(download.executionToken)

      // Retry the still-owned maintenance execution after the downloader has actually drained.
      await maintain(maintenance, archive.root)
      await expect(readFile(path.join(archive.root, generation.path, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
      const cleaned = await state(archive.id)
      expect(cleaned).toMatchObject({ cleanupRequestedAt: null, generationToken: null, completedItems: 0 })
      expect(cleaned.generations[0]?.cleanedAt).not.toBeNull()
      expect(cleaned.items[0]).toMatchObject({
        status: 'PENDING',
        stagedPath: null,
        stagedGenerationPath: null,
        sha256: null
      })
    } finally {
      manifest.release()
      await running.catch(() => undefined)
    }
  }, 20_000)

  it('cleans only a drained successor while the expired generation is still finishing its real manifest', async () => {
    const archive = await seed('orphan-cleanup')
    const expired = await claim('ARCHIVE_DOWNLOAD')
    const manifest = blockManifestLink(expired.executionToken)
    const late = execute(expired, dependencies(archive.root))
    void late.catch(() => undefined)
    try {
      await manifest.waitUntilReached()
      const old = await state(archive.id)
      const oldGeneration = old.generations[0]!
      const oldMedia = path.join(archive.root, oldGeneration.path, old.items[0]!.stagedPath!)
      clock.advance(61_000)
      await repo!.recoverExpiredExecution('ARCHIVE_DOWNLOAD')
      clock.advance(600_000)
      const successor = await claim('ARCHIVE_DOWNLOAD')
      const ctx = context<ArchiveImportV2Payload>(successor)
      const finalize = ctx.finalizeInTransaction
      ctx.finalizeInTransaction = async (operation) => {
        await requestPause(successor)
        return finalize(operation)
      }
      const network = vi.fn(async () => {
        throw new Error('completed checkpoint must be copied, not downloaded')
      })
      await execute(successor, dependencies(archive.root, network), ctx)
      const paused = await state(archive.id)
      const freshGeneration = paused.generations.find((generation) => generation.token === successor.executionToken)!
      expect(network).not.toHaveBeenCalled()
      expect(paused).toMatchObject({ status: 'PAUSED', generationToken: successor.executionToken, completedItems: 1 })
      expect(freshGeneration.drainedAt).not.toBeNull()
      expect(freshGeneration.path).not.toBe(oldGeneration.path)
      expect(await readFile(path.join(archive.root, freshGeneration.path, paused.items[0]!.stagedPath!))).toEqual(png)

      await db!.archiveImport.update({ where: { id: archive.id }, data: { cleanupRequestedAt: clock.now() } })
      await seedCleanup(archive.id, 'orphan-maintenance')
      await maintain(await claim('ARCHIVE_MAINTENANCE'), archive.root)
      const cleaned = await state(archive.id)
      expect(cleaned.generations.find((generation) => generation.token === expired.executionToken)).toMatchObject({
        drainedAt: null,
        cleanedAt: null
      })
      expect(
        cleaned.generations.find((generation) => generation.token === successor.executionToken)?.cleanedAt
      ).not.toBeNull()
      expect(await readFile(oldMedia)).toEqual(png)
      expect(await readFile(path.join(archive.root, oldGeneration.path, 'manifest.json.tmp'))).not.toHaveLength(0)
      await expect(readdir(path.join(archive.root, freshGeneration.path))).rejects.toMatchObject({ code: 'ENOENT' })

      manifest.release()
      await expect(late).rejects.toThrow()
      // The late link really ran, but its lost fence cannot restore checkpoints or change cleanup state.
      expect(
        JSON.parse(await readFile(path.join(archive.root, oldGeneration.path, 'manifest.json'), 'utf8')).generationToken
      ).toBe(expired.executionToken)
      expect(await state(archive.id)).toEqual(cleaned)
      expect(await db!.systemJob.count({ where: { parentJobId: expired.id, type: 'ARCHIVE_PUBLISH' } })).toBe(0)
    } finally {
      manifest.release()
      await late.catch(() => undefined)
    }
  }, 20_000)

  it('gates a sealed publish during cleanup while another archive continues a real download in the same root', async () => {
    const removed = await seed('sealed-cleanup')
    await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(removed.root))
    const sealed = await state(removed.id)
    const retained = await seed('parallel-download', removed.root)
    await db!.archiveImport.update({ where: { id: removed.id }, data: { cleanupRequestedAt: clock.now() } })
    expect(await claimOrNull('ARCHIVE_PUBLISH')).toBeNull()

    const stream = new PassThrough()
    const open = vi.fn(async () => remote(stream))
    const download = await claim('ARCHIVE_DOWNLOAD')
    expect(download.id).toBe(retained.jobId)
    const running = execute(download, dependencies(retained.root, open))
    void running.catch(() => undefined)
    try {
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
      stream.write(png.subarray(0, 8))
      const downloading = await state(retained.id)
      const mediaDirectory = path.join(retained.root, downloading.stagingPath, 'media')
      let partialPath = ''
      await vi.waitFor(async () => {
        const partial = (await readdir(mediaDirectory)).find((name) => name.startsWith('.part-'))
        expect(partial).toBeDefined()
        partialPath = path.join(mediaDirectory, partial!)
        expect((await readFile(partialPath)).length).toBe(8)
      })
      await seedCleanup(removed.id, 'parallel-maintenance')
      await maintain(await claim('ARCHIVE_MAINTENANCE'), removed.root)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: download.id } })).status).toBe('RUNNING')
      expect(await readFile(partialPath)).toEqual(png.subarray(0, 8))
      await expect(readdir(path.join(removed.root, sealed.stagingPath))).rejects.toMatchObject({ code: 'ENOENT' })
      const cleaned = await state(removed.id)
      expect(cleaned).toMatchObject({
        status: 'CANCELLED',
        phase: 'DOWNLOAD',
        cleanupRequestedAt: null,
        generationToken: null
      })
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: sealed.systemJobId } })).status).toBe('CANCELLED')
      expect(await claimOrNull('ARCHIVE_PUBLISH')).toBeNull()

      stream.end(png.subarray(8))
      await running
      const completed = await state(retained.id)
      expect(completed).toMatchObject({ phase: 'PUBLISH', completedItems: 1, generationToken: download.executionToken })
      expect(completed.generations[0]).toMatchObject({ cleanedAt: null })
      expect(completed.generations[0]?.sealedAt).not.toBeNull()
      expect(completed.items[0]?.sha256).toBe(createHash('sha256').update(png).digest('hex'))
      expect(await readFile(path.join(retained.root, completed.stagingPath, completed.items[0]!.stagedPath!))).toEqual(
        png
      )
      expect(await db!.archiveRevision.count({ where: { archiveImportId: removed.id } })).toBe(0)
    } finally {
      stream.end()
      await running.catch(() => undefined)
    }
  }, 20_000)
})

function blockManifestLink(token: string) {
  let reached = false
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.mocked(link).mockImplementation(async (source, target) => {
    if (String(target).includes(token) && path.basename(String(target)) === 'manifest.json') {
      reached = true
      await barrier
    }
    return actualFs.link(source, target)
  })
  return { release, waitUntilReached: () => vi.waitFor(() => expect(reached).toBe(true), { timeout: 5_000 }) }
}

async function seed(label: string, sharedRoot?: string) {
  const id = `${prefix}-${label}`
  const root = sharedRoot ?? (await mkdtemp(path.join(tmpdir(), 'archive-drain-recovery-')))
  if (!sharedRoot) roots.push(root)
  const jobId = await seedJob('ARCHIVE_DOWNLOAD', `${label}-job`, { archiveImportId: id, defaultTagIds: [] })
  await db!.archiveImport.create({
    data: {
      id,
      systemJobId: jobId,
      phase: 'DOWNLOAD',
      origin: 'MANUAL',
      providerKey: 'test',
      externalId: id,
      submittedUrl: 'https://example.test/archive',
      canonicalUrl: `https://example.test/${id}`,
      locator: {},
      normalizedMetadata: { titles: { display: prefix } },
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'bucket',
      stagingPath: `.archive-staging/${id}`,
      totalItems: 1,
      executions: { create: { jobId, phase: 'DOWNLOAD' } },
      items: {
        create: {
          pageIndex: 0,
          sourcePageUrl: 'https://example.test/image',
          locator: {},
          expectedFilename: 'image.png'
        }
      }
    }
  })
  return { id, jobId, root }
}

async function seedJob(type: JobType, label: string, payload: Record<string, unknown>) {
  const id = `${prefix}-${label}`
  jobs.add(id)
  await db!.systemJob.create({
    data: {
      id,
      type,
      executionLane: executionLaneForJobType(type),
      definitionVersion: 1,
      payload: payload as Prisma.InputJsonValue,
      triggerSource: 'MANUAL',
      queuePriority: 10,
      effectivePriority: 10,
      availableAt: clock.now()
    }
  })
  return id
}

function seedCleanup(archiveImportId: string, label: string) {
  return seedJob('ARCHIVE_MAINTENANCE', label, { action: 'CLEAN_STAGING', archiveImportId })
}
function state(id: string) {
  return db!.archiveImport.findUniqueOrThrow({
    where: { id },
    include: {
      items: { orderBy: { pageIndex: 'asc' } },
      generations: { orderBy: { token: 'asc' } }
    }
  })
}
function claimOrNull(type: JobType) {
  const lane = executionLaneForJobType(type)
  return repo!.claim(`${prefix}-worker-${lane}`, lane, [
    { jobType: type, executionLane: lane, definitionVersions: [1] }
  ])
}
async function claim(type: JobType) {
  const job = await claimOrNull(type)
  expect(job).not.toBeNull()
  return job!
}
function fence(job: ClaimedJob) {
  return { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
}
function context<TPayload>(job: ClaimedJob): ExecutionContext<TPayload, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as TPayload,
    signal: new AbortController().signal,
    progress: (update) => repo!.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('not used')
    },
    mutateInTransaction: (operation) => repo!.withFencedMutationTransaction(fence(job), operation),
    finalizeInTransaction: async (operation) => {
      await repo!.withFencedExecutionTransaction(fence(job), operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
}
function requestPause(job: ClaimedJob) {
  return db!.systemJob.update({ where: { id: job.id }, data: { status: 'PAUSING', pauseRequestedAt: clock.now() } })
}
function remote(stream: Readable) {
  return {
    stream,
    contentLength: png.length,
    mimeType: 'image/png',
    originalFilename: 'image.png',
    quality: 'ORIGINAL' as const,
    remoteHost: 'example.test'
  }
}
function dependencies(root: string, openMedia = async () => remote(Readable.from([png]))): ArchiveExecutorDependencies {
  return {
    database: db!,
    config: { scanRoot: root, mediaConcurrency: 1 },
    providers: { get: () => ({ key: 'test', openMedia }) },
    now: () => clock.now()
  }
}
function execute(job: ClaimedJob, deps: ArchiveExecutorDependencies, ctx = context<ArchiveImportV2Payload>(job)) {
  const executor = createArchiveExecutorRegistrations(deps).find(
    (entry) => entry.jobType === job.type && entry.definitionVersion === job.definitionVersion
  )!
  return executor.execute({ ...ctx, payload: executor.parsePayload!(job.payload) })
}
function maintain(job: ClaimedJob, root: string) {
  return executeArchiveMaintenance(context<ArchiveMaintenancePayload>(job), {
    database: db!,
    config: { scanRoot: root },
    now: () => clock.now()
  })
}
async function cleanup() {
  if (!db) return
  await cleanupFixtureContentDirectories(db, roots)
  const executions = await db.archiveImportExecution.findMany({
    where: { archiveImportId: { startsWith: prefix } },
    select: { jobId: true }
  })
  for (const execution of executions) jobs.add(execution.jobId)
  await db.artwork.deleteMany({ where: { title: prefix } })
  await db.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { in: [...jobs] } } })
  await db.systemJob.deleteMany({ where: { id: { in: [...jobs] } } })
  jobs.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}
