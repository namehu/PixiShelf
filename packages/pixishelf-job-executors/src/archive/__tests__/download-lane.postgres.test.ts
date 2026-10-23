import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import sharp from 'sharp'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import { executionLaneForJobType, type JobType, type ArchiveImportV2Payload } from '@pixishelf/job-contracts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type FencedExecutionTransaction,
  type QueueSqlExecutor,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArchiveExecutorRegistrations } from '../executor.js'
import * as storage from '../storage.js'
import { CentralDispatcher } from '../../../../pixishelf-worker/src/dispatcher.js'
import { ExecutorRegistry } from '../../../../pixishelf-worker/src/executor-registry.js'
import { RuntimeDispatcherQueue } from '../../../../pixishelf-worker/src/runtime-dispatcher-queue.js'
import { executeArchiveMaintenance } from '../maintenance-executor.js'
import type { ArchiveExecutorDependencies } from '../types.js'

// No application DATABASE_URL fallback: this suite must be explicitly isolated.
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `download-lane-${randomUUID()}`
const roots: string[] = []
const extraJobs = new Set<string>()
const clock = new MutableQueueClock(new Date('2026-10-23T10:00:00Z'))
const repo = db ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, leaseDurationMs: 60_000 }) : null
const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#336699' } })
  .png()
  .toBuffer()
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})

suite('archive download lane real database and filesystem', () => {
  beforeEach(async () => {
    await cleanup()
    clock.set(new Date('2026-10-23T10:00:00Z'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it('runs a writer and resolver while slow download holds its lane; competing workers cannot take a second download', async () => {
    const a = await seed('slow')
    await seed('next')
    const stream = new PassThrough()
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    const deps = dependencies(a.root, async () => {
      opened()
      return remote(stream)
    })
    const job = await claim('ARCHIVE_DOWNLOAD')
    const running = execute(job, deps)
    await opening
    stream.write(png.subarray(0, 8))
    const competing = await Promise.all([
      claimOrNull('ARCHIVE_DOWNLOAD', 'other-1'),
      claimOrNull('ARCHIVE_DOWNLOAD', 'other-2')
    ])
    expect(competing).toEqual([null, null])
    await seedJob('SCAN', 'short-writer')
    await seedJob('ARCHIVE_TITLE_RULE_PREVIEW', 'short-resolver')
    const writer = await claim('SCAN')
    const resolver = await claim('ARCHIVE_TITLE_RULE_PREVIEW')
    await repo!.complete({ ...fence(writer), result: { done: true } })
    await repo!.complete({ ...fence(resolver), result: { done: true } })
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('RUNNING')
    stream.end(png.subarray(8))
    await running
    const state = await db!.archiveImport.findUniqueOrThrow({
      where: { id: a.id },
      include: { systemJob: true, generations: true }
    })
    expect(state).toMatchObject({
      status: 'PENDING',
      phase: 'PUBLISH',
      systemJob: { type: 'ARCHIVE_PUBLISH', progress: 95 }
    })
    expect(state.generations[0]?.sealedAt).not.toBeNull()
    // A awaiting publication does not keep B out of the download lane.
    const b = await claim('ARCHIVE_DOWNLOAD')
    expect(b.id).not.toBe(job.id)
    await execute(b, dependencies(a.root))
    expect(await db!.archiveImport.count({ where: { id: { startsWith: prefix }, phase: 'PUBLISH' } })).toBe(2)
  })

  it('three real dispatchers execute writer and resolver jobs while a real download stream remains open', async () => {
    const a = await seed('dispatchers')
    const writerId = await seedJob('SCAN', 'dispatch-writer')
    const resolverId = await seedJob('ARCHIVE_TITLE_RULE_PREVIEW', 'dispatch-resolver')
    const stream = new PassThrough()
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    const registry = new ExecutorRegistry()
    for (const registration of createArchiveExecutorRegistrations(
      dependencies(a.root, async () => {
        opened()
        return remote(stream)
      })
    ))
      registry.register(registration)
    const shortExecutor = vi.fn(async () => ({ kind: 'completed' as const, result: { actualExecutorRan: true } }))
    for (const jobType of ['SCAN', 'ARCHIVE_TITLE_RULE_PREVIEW'] as const)
      registry.register({ jobType, definitionVersion: 1, parsePayload: (payload) => payload, execute: shortExecutor })
    const dispatchers = (['ARCHIVE_DOWNLOAD', 'BACKGROUND_WRITER', 'ARCHIVE_RESOLVE'] as const).map((lane) => {
      const queue = new RuntimeDispatcherQueue(repo!)
      queue.claim = (workerId, capabilities) => repo!.claim(workerId, lane, capabilities)
      return new CentralDispatcher({
        enabled: true,
        workerId: `real-${lane}`,
        executionLane: lane,
        queue,
        registry,
        logger: context({} as ClaimedJob).logger,
        pollIntervalMs: 100,
        heartbeatIntervalMs: 1000,
        drainGraceMs: 1000
      })
    })
    try {
      await Promise.all(dispatchers.map((dispatcher) => dispatcher.prepare()))
      dispatchers.forEach((dispatcher) => dispatcher.activate())
      await opening
      await vi.waitFor(async () =>
        expect(await db!.systemJob.count({ where: { id: { in: [writerId, resolverId] }, status: 'COMPLETED' } })).toBe(
          2
        )
      )
      expect(shortExecutor).toHaveBeenCalledTimes(2)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: a.jobId } })).status).toBe('RUNNING')
      stream.end(png)
      await vi.waitFor(async () =>
        expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).phase).toBe('PUBLISH')
      )
    } finally {
      stream.end()
      await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop()))
    }
  })

  it('handoff and replay are fenced and create exactly one publish, freezing automatic priority and tags', async () => {
    const a = await seed('atomic', { origin: 'AUTO', tags: [21, 34] })
    const job = await claim('ARCHIVE_DOWNLOAD')
    await execute(job, dependencies(a.root))
    await expect(execute(job, dependencies(a.root))).rejects.toThrow()
    const state = await db!.archiveImport.findUniqueOrThrow({
      where: { id: a.id },
      include: { systemJob: true, executions: true }
    })
    expect(state.executions).toHaveLength(2)
    expect(state.systemJob).toMatchObject({
      type: 'ARCHIVE_PUBLISH',
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      payload: { archiveImportId: a.id, defaultTagIds: [21, 34] }
    })
    expect(await db!.systemJob.count({ where: { parentJobId: job.id, type: 'ARCHIVE_PUBLISH' } })).toBe(1)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).result).toMatchObject({
      outcome: 'HANDOFF'
    })
  })

  it('rolls back seal, successor, current pointer and completion together on a handoff transaction failure', async () => {
    const a = await seed('rollback')
    const job = await claim('ARCHIVE_DOWNLOAD')
    const ctx = context(job)
    ctx.finalizeInTransaction = async <TTransaction extends QueueSqlExecutor>(
      operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
    ) => {
      await repo!.withFencedExecutionTransaction<TTransaction>(fence(job), async (scope) => {
        await operation(scope)
        throw new Error('commit fault')
      })
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    }
    await expect(execute(job, dependencies(a.root), ctx)).rejects.toThrow('commit fault')
    const state = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { generations: true } })
    expect(state).toMatchObject({
      phase: 'DOWNLOAD',
      systemJobId: job.id,
      status: 'RUNNING',
      sealedManifestSha256: null
    })
    expect(state.generations[0]).toMatchObject({ sealedAt: null, drainedAt: null })
    expect(await db!.systemJob.count({ where: { parentJobId: job.id } })).toBe(0)
  })

  it.each(['PAUSING', 'CANCELLING'] as const)(
    'honors %s racing the final handoff after all writes drain',
    async (status) => {
      const a = await seed(status)
      const job = await claim('ARCHIVE_DOWNLOAD')
      const ctx = context(job)
      const original = ctx.finalizeInTransaction
      ctx.finalizeInTransaction = async (operation) => {
        await db!.systemJob.update({
          where: { id: job.id },
          data: {
            status,
            ...(status === 'PAUSING' ? { pauseRequestedAt: clock.now() } : { cancelRequestedAt: clock.now() })
          }
        })
        return original(operation)
      }
      await execute(job, dependencies(a.root), ctx)
      expect(await db!.systemJob.count({ where: { parentJobId: job.id } })).toBe(0)
      const state = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { generations: true } })
      expect(state.status).toBe(status === 'PAUSING' ? 'PAUSED' : 'CANCELLED')
      expect(state.generations[0]?.drainedAt).not.toBeNull()
    }
  )

  it('reuses checked completed media in a fresh generation and isolates an expired writer late file', async () => {
    const a = await seed('takeover')
    const job = await claim('ARCHIVE_DOWNLOAD')
    const ctx = context(job)
    ctx.finalizeInTransaction = async () => {
      throw new Error('worker lost after manifest')
    }
    await expect(execute(job, dependencies(a.root), ctx)).rejects.toThrow()
    const old = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } })
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('ARCHIVE_DOWNLOAD')
    clock.advance(600_000)
    const next = await claim('ARCHIVE_DOWNLOAD')
    const open = vi.fn(async () => remote(Readable.from([png])))
    await execute(next, dependencies(a.root, open))
    expect(open).not.toHaveBeenCalled()
    const fresh = await db!.archiveImport.findUniqueOrThrow({
      where: { id: a.id },
      include: { items: true, generations: true }
    })
    expect(fresh.generationToken).not.toBe(old.generationToken)
    expect(fresh.items[0]?.stagedPath).not.toBe(old.items[0]?.stagedPath)
    await writeFile(path.join(a.root, old.stagingPath, 'late-orphan'), 'late')
    await expect(readFile(path.join(a.root, fresh.stagingPath, 'late-orphan'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(fresh.generations.find((generation) => generation.token === old.generationToken)?.drainedAt).toBeNull()
  })

  it('fences a real old download continuation after takeover and keeps its immutable orphan out of the sealed generation', async () => {
    const a = await seed('late-stream')
    const stream = new PassThrough()
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    const oldJob = await claim('ARCHIVE_DOWNLOAD')
    const late = execute(
      oldJob,
      dependencies(a.root, async () => {
        opened()
        return remote(stream)
      })
    ).catch((error) => error)
    await opening
    stream.write(png.subarray(0, 8))
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('ARCHIVE_DOWNLOAD')
    clock.advance(600_000)
    const newJob = await claim('ARCHIVE_DOWNLOAD')
    await execute(newJob, dependencies(a.root))
    const sealed = await db!.archiveImport.findUniqueOrThrow({
      where: { id: a.id },
      include: { items: true, generations: true }
    })
    const checkpoint = sealed.items[0]!
    const sealedMedia = await readFile(path.join(a.root, sealed.stagingPath, checkpoint.stagedPath!))
    const sealedManifest = await readFile(path.join(a.root, sealed.stagingPath, 'manifest.json'))
    stream.end(png.subarray(8))
    expect(await late).toBeInstanceOf(Error)
    const after = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } })
    expect(after.generationToken).toBe(newJob.executionToken)
    expect(after.items[0]?.stagedPath).toBe(checkpoint.stagedPath)
    expect(await readFile(path.join(a.root, after.stagingPath, checkpoint.stagedPath!))).toEqual(sealedMedia)
    expect(await readFile(path.join(a.root, after.stagingPath, 'manifest.json'))).toEqual(sealedManifest)
    const oldGeneration = sealed.generations.find((generation) => generation.token === oldJob.executionToken)!
    expect(oldGeneration.drainedAt).toBeNull()
    const orphanFiles = await (await import('node:fs/promises')).readdir(path.join(a.root, oldGeneration.path, 'media'))
    expect(orphanFiles.some((name) => name.includes(oldJob.executionToken) && !name.startsWith('.part-'))).toBe(true)
  })

  it('recovers a rename-before-commit publication without network or media rehash', async () => {
    const a = await seed('rename')
    await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
    const validate = vi.spyOn(storage, 'validateArchiveStoredMedia').mockImplementation(async () => {
      throw new Error('publication must not rehash media')
    })
    const copy = vi.spyOn(storage, 'copyArchiveCheckpoint').mockImplementation(async () => {
      throw new Error('publication must not copy media')
    })
    const publish = await claim('ARCHIVE_PUBLISH')
    const ctx = context(publish)
    ctx.finalizeInTransaction = async () => {
      throw new Error('crash after rename')
    }
    const network = vi.fn(async () => {
      throw new Error('publication must not use network')
    })
    await expect(execute(publish, dependencies(a.root, network), ctx)).rejects.toThrow('crash after rename')
    const expected = `sources/test/bucket/${a.id}/revisions/${a.id}`
    expect(JSON.parse(await readFile(path.join(a.root, expected, 'manifest.json'), 'utf8')).revisionId).toBe(a.id)
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
    clock.advance(600_000)
    await execute(await claim('ARCHIVE_PUBLISH'), dependencies(a.root, network))
    expect(network).not.toHaveBeenCalled()
    const state = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { systemJob: true } })
    expect(state).toMatchObject({
      status: 'COMPLETED',
      phase: 'PUBLISH',
      systemJob: { progress: 100, status: 'COMPLETED' }
    })
    expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(1)
    expect(validate).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
    validate.mockRestore()
    copy.mockRestore()
  })

  it.each([1, 2])(
    'legacy v%i handoff performs no network and preserves tags, origin facts and retry budget',
    async (version) => {
      const a = await seed(`legacy-${version}`, { legacy: version })
      const availableAt = new Date(clock.now().getTime() - 10_000)
      await db!.systemJob.update({ where: { id: a.jobId }, data: { attempt: 1, status: 'RETRY_WAIT', availableAt } })
      const legacy = await claim('ARCHIVE_IMPORT', 'legacy', [version])
      const network = vi.fn(async () => {
        throw new Error('legacy must not download')
      })
      await execute(legacy, dependencies(a.root, network))
      const state = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { systemJob: true } })
      expect(network).not.toHaveBeenCalled()
      expect(state).toMatchObject({
        phase: 'DOWNLOAD',
        origin: null,
        systemJob: {
          type: 'ARCHIVE_DOWNLOAD',
          attempt: 1,
          maxAttempts: 3,
          queuePriority: 10,
          payload: { archiveImportId: a.id, defaultTagIds: version === 1 ? [] : [17] }
        }
      })
      expect(state.status).toBe('PENDING')
      expect(state.systemJob.availableAt).toEqual(availableAt)
    }
  )

  it('legacy final cleanup verifies manifest before removing files and clearing checkpoint evidence', async () => {
    const a = await seed('legacy-clean', { legacy: 2 })
    const finalPath = `sources/test/bucket/${a.id}/revisions/${a.id}`
    const mediaPath = 'media/old.png'
    await mkdir(path.join(a.root, finalPath, 'media'), { recursive: true })
    await writeFile(path.join(a.root, finalPath, mediaPath), png)
    const sha = createHash('sha256').update(png).digest('hex')
    await writeFile(
      path.join(a.root, finalPath, 'manifest.json'),
      JSON.stringify({
        revisionId: a.id,
        provider: { key: 'test', externalId: a.id },
        media: [{ index: 0, path: mediaPath, sha256: sha, bytes: String(png.length) }]
      })
    )
    await db!.archiveImportItem.updateMany({
      where: { archiveImportId: a.id },
      data: { status: 'COMPLETED', stagedPath: mediaPath, sha256: sha, byteCount: BigInt(png.length) }
    })
    await db!.systemJob.update({ where: { id: a.jobId }, data: { status: 'FAILED' } })
    await db!.archiveImport.update({
      where: { id: a.id },
      data: { status: 'FAILED', cleanupRequestedAt: clock.now(), completedItems: 1 }
    })
    await seedJob('ARCHIVE_MAINTENANCE', 'legacy-cleanup', { action: 'CLEAN_STAGING', archiveImportId: a.id })
    const maintenance = await claim('ARCHIVE_MAINTENANCE')
    await executeArchiveMaintenance(context(maintenance) as never, {
      database: db!,
      config: { scanRoot: a.root },
      now: () => clock.now()
    })
    await expect(readFile(path.join(a.root, finalPath, mediaPath))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).completedItems).toBe(0)
    // An explicit retry starts a new download phase after cleanup.
    const retryId = await seedJob('ARCHIVE_DOWNLOAD', 'legacy-clean-retry', {
      archiveImportId: a.id,
      defaultTagIds: [17]
    })
    await db!.archiveImport.update({
      where: { id: a.id },
      data: { systemJobId: retryId, phase: 'DOWNLOAD', status: 'PENDING' }
    })
    await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
    expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).phase).toBe('PUBLISH')
  })
  it('preserves unknown legacy final files and checkpoint evidence when cleanup rejects their identity', async () => {
    const a = await seed('unknown-final', { legacy: 2 })
    const finalPath = await createLegacyFinal(a)
    await writeFile(path.join(a.root, finalPath, 'manifest.json'), JSON.stringify({ revisionId: 'somebody-else' }))
    await db!.systemJob.update({ where: { id: a.jobId }, data: { status: 'FAILED' } })
    await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'FAILED', cleanupRequestedAt: clock.now() } })
    await seedJob('ARCHIVE_MAINTENANCE', 'unknown-cleanup', { action: 'CLEAN_STAGING', archiveImportId: a.id })
    await expect(
      executeArchiveMaintenance(context(await claim('ARCHIVE_MAINTENANCE')) as never, {
        database: db!,
        config: { scanRoot: a.root },
        now: () => clock.now()
      })
    ).rejects.toThrow()
    expect(await readFile(path.join(a.root, finalPath, 'media/old.png'))).toEqual(png)
    expect(JSON.parse(await readFile(path.join(a.root, finalPath, 'manifest.json'), 'utf8')).revisionId).toBe(
      'somebody-else'
    )
    const state = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } })
    expect(state.items[0]?.status).toBe('COMPLETED')
    expect(state.cleanupRequestedAt).not.toBeNull()
  })

  it.each(['PAUSING', 'CANCELLING'] as const)(
    'can clean and retry a verified legacy final interrupted by %s before seal',
    async (status) => {
      const a = await seed(`legacy-final-${status}`, { legacy: 2 })
      const finalPath = await createLegacyFinal(a)
      await execute(await claim('ARCHIVE_IMPORT', 'legacy', [2]), dependencies(a.root))
      const job = await claim('ARCHIVE_DOWNLOAD')
      const ctx = context(job)
      const finalize = ctx.finalizeInTransaction
      ctx.finalizeInTransaction = async (operation) => {
        await db!.systemJob.update({
          where: { id: job.id },
          data: {
            status,
            ...(status === 'PAUSING' ? { pauseRequestedAt: clock.now() } : { cancelRequestedAt: clock.now() })
          }
        })
        return finalize(operation)
      }
      await execute(
        job,
        dependencies(a.root, async () => {
          throw new Error('reuse must not download')
        }),
        ctx
      )
      const interrupted = await db!.archiveStagingGeneration.findUniqueOrThrow({ where: { token: job.executionToken } })
      expect(interrupted).toMatchObject({
        path: finalPath,
        sealedAt: null,
        manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        drainedAt: expect.any(Date)
      })
      await db!.archiveImport.update({ where: { id: a.id }, data: { cleanupRequestedAt: clock.now() } })
      await seedJob('ARCHIVE_MAINTENANCE', 'interrupted-cleanup', { action: 'CLEAN_STAGING', archiveImportId: a.id })
      await executeArchiveMaintenance(context(await claim('ARCHIVE_MAINTENANCE')) as never, {
        database: db!,
        config: { scanRoot: a.root },
        now: () => clock.now()
      })
      await expect(readFile(path.join(a.root, finalPath, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      const clean = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })
      expect(clean.cleanupRequestedAt).toBeNull()
      const retry = await seedJob('ARCHIVE_DOWNLOAD', 'interrupted-retry', { archiveImportId: a.id, defaultTagIds: [] })
      await db!.archiveImport.update({
        where: { id: a.id },
        data: { systemJobId: retry, phase: 'DOWNLOAD', status: 'PENDING' }
      })
      await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
      expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).phase).toBe('PUBLISH')
    }
  )
})

async function seed(label: string, options: { origin?: 'MANUAL' | 'AUTO'; tags?: number[]; legacy?: number } = {}) {
  const id = `${prefix}-${label}`
  const root = await mkdtemp(path.join(tmpdir(), 'archive-lanes-'))
  roots.push(root)
  const type = options.legacy ? 'ARCHIVE_IMPORT' : 'ARCHIVE_DOWNLOAD'
  const jobId = await seedJob(
    type,
    `${label}-job`,
    options.legacy === 1
      ? { archiveImportId: id }
      : { archiveImportId: id, defaultTagIds: options.tags ?? (options.legacy ? [17] : []) },
    options.legacy ?? 1,
    options.origin
  )
  await db!.archiveImport.create({
    data: {
      id,
      systemJobId: jobId,
      phase: options.legacy ? 'LEGACY' : 'DOWNLOAD',
      origin: options.legacy ? null : (options.origin ?? 'MANUAL'),
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
      executions: { create: { jobId, phase: options.legacy ? 'LEGACY' : 'DOWNLOAD' } },
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
async function seedJob(
  type: JobType,
  label: string,
  payload: Record<string, unknown> = {},
  version = 1,
  origin: 'MANUAL' | 'AUTO' = 'MANUAL'
) {
  const id = `${prefix}-${label}`
  extraJobs.add(id)
  await db!.systemJob.create({
    data: {
      id,
      type,
      executionLane: executionLaneForJobType(type),
      definitionVersion: version,
      payload: payload as Prisma.InputJsonValue,
      triggerSource: origin === 'AUTO' ? 'SYSTEM' : 'MANUAL',
      queuePriority: origin === 'AUTO' ? 900 : 10,
      effectivePriority: origin === 'AUTO' ? 900 : 10,
      availableAt: clock.now()
    }
  })
  return id
}
async function claimOrNull(type: JobType, worker = 'fixture', versions = [1]) {
  return repo!.claim(worker, executionLaneForJobType(type), [
    { jobType: type, executionLane: executionLaneForJobType(type), definitionVersions: versions }
  ])
}
async function claim(type: JobType, worker = 'fixture', versions = [1]) {
  const job = await claimOrNull(type, worker, versions)
  expect(job).not.toBeNull()
  return job!
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
    config: { scanRoot: root, mediaConcurrency: 2 },
    providers: { get: () => ({ key: 'test', openMedia }) },
    now: () => clock.now()
  }
}
function context(job: ClaimedJob): ExecutionContext<ArchiveImportV2Payload, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as ArchiveImportV2Payload,
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
function execute(job: ClaimedJob, deps: ArchiveExecutorDependencies, ctx = context(job)) {
  const executor = createArchiveExecutorRegistrations(deps).find(
    (entry) => entry.jobType === job.type && entry.definitionVersion === job.definitionVersion
  )!
  return executor.execute({ ...ctx, payload: executor.parsePayload!(job.payload) })
}
async function cleanup() {
  if (!db) return
  const executions = await db.archiveImportExecution.findMany({
    where: { archiveImportId: { startsWith: prefix } },
    select: { jobId: true }
  })
  for (const item of executions) extraJobs.add(item.jobId)
  await db.artwork.deleteMany({ where: { title: prefix } })
  await db.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { in: [...extraJobs] } } })
  await db.systemJob.deleteMany({ where: { id: { in: [...extraJobs] } } })
  extraJobs.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}

async function createLegacyFinal(a: { root: string; id: string }) {
  const finalPath = `sources/test/bucket/${a.id}/revisions/${a.id}`
  const mediaPath = 'media/old.png'
  const sha = createHash('sha256').update(png).digest('hex')
  await mkdir(path.join(a.root, finalPath, 'media'), { recursive: true })
  await writeFile(path.join(a.root, finalPath, mediaPath), png)
  await writeFile(
    path.join(a.root, finalPath, 'manifest.json'),
    JSON.stringify({
      revisionId: a.id,
      provider: { key: 'test', externalId: a.id },
      media: [{ index: 0, path: mediaPath, sha256: sha, bytes: String(png.length) }]
    })
  )
  await db!.archiveImportItem.updateMany({
    where: { archiveImportId: a.id },
    data: { status: 'COMPLETED', stagedPath: mediaPath, sha256: sha, byteCount: BigInt(png.length) }
  })
  await db!.archiveImport.update({ where: { id: a.id }, data: { completedItems: 1 } })
  return finalPath
}
