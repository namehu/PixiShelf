import { archiveCatalogProbe } from './catalog-order-probe.ts'
import { captureArchiveFixtureSource } from './dedup-source-fixture.ts'
import { cleanupFixtureContentDirectories } from '../../scan/__tests__/content-directory-cleanup.ts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import sharp from 'sharp'
import {
  PrismaClient,
  Prisma,
  inspectMediaContentRecovery,
  grantMediaContentRecovery,
  resumeGrantedMediaContentRecovery
} from '@pixishelf/db'
import {
  parseArtworkDedupSourceSnapshot,
  executionLaneForJobType,
  type JobType,
  type ArchiveImportV2Payload
} from '@pixishelf/job-contracts'
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
import { readExecutorMediaRecoveryDomainSnapshot } from '../../scan/media-content-recovery.ts'
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

  it.each(['NULL', 'HOLD', 'REOPEN'] as const)(
    'rejects original source %s before staging or network',
    async (fault) => {
      const a = await seed(`source-start-${fault}`)
      const original = (await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot
      const sourceId = parseArtworkDedupSourceSnapshot(original).sources[0]!.sourceId
      if (fault === 'NULL')
        await db!.archiveImport.update({ where: { id: a.id }, data: { dedupSourceSnapshot: Prisma.DbNull } })
      else {
        await db!.artworkDedupSourceIdentity.update({ where: { id: sourceId }, data: { status: 'HOLD', ownerOperationId: 'synthetic-source-proof-hold' } })
        if (fault === 'REOPEN')
          await db!.artworkDedupSourceIdentity.update({
            where: { id: sourceId },
            data: { status: 'OPEN', ownerOperationId: null, generation: { increment: 1 } }
          })
      }
      const network = vi.fn(async () => remote(Readable.from([png])))
      const job = await claim('ARCHIVE_DOWNLOAD')
      await execute(job, dependencies(a.root, network))
      expect(network).not.toHaveBeenCalled()
      expect(await readdir(a.root)).toEqual([])
      expect(await db!.archiveStagingGeneration.count({ where: { archiveImportId: a.id } })).toBe(0)
      const failed = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })
      expect(failed.status).toBe('FAILED')
      expect(failed.dedupSourceSnapshot).toEqual(fault === 'NULL' ? null : original)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('FAILED')
    }
  )

  it('registers the original fenced execution generation before the first staging mkdir', async () => {
    const a = await seed('register-before-fs')
    const job = await claim('ARCHIVE_DOWNLOAD')
    const prepare = storage.prepareArchiveStagingDirectory
    const firstFs = vi.spyOn(storage, 'prepareArchiveStagingDirectory').mockImplementation(async (...args) => {
      const current = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })
      const generation = await db!.archiveStagingGeneration.findUniqueOrThrow({ where: { token: job.executionToken } })
      expect(current).toMatchObject({
        status: 'RUNNING',
        generationToken: job.executionToken,
        stagingPath: generation.path
      })
      expect(generation).toMatchObject({ jobId: job.id, archiveImportId: a.id, drainedAt: null })
      expect(await readdir(a.root)).toEqual([])
      return prepare(...args)
    })
    await execute(job, dependencies(a.root))
    expect(firstFs).toHaveBeenCalledOnce()
  })

  it.each(['HOLD', 'REOPEN'] as const)(
    'rejects media success receipt under original source %s and still drains its token',
    async (fault) => {
      const a = await seed(`source-receipt-${fault}`)
      const original = (await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot
      const sourceId = parseArtworkDedupSourceSnapshot(original).sources[0]!.sourceId
      const stream = new PassThrough()
      let opened!: () => void
      const opening = new Promise<void>((resolve) => {
        opened = resolve
      })
      const job = await claim('ARCHIVE_DOWNLOAD')
      const running = execute(
        job,
        dependencies(a.root, async () => {
          opened()
          return remote(stream)
        })
      )
      try {
        await opening
        stream.write(png.subarray(0, 8))
        await db!.artworkDedupSourceIdentity.update({ where: { id: sourceId }, data: { status: 'HOLD', ownerOperationId: 'synthetic-source-proof-hold' } })
        if (fault === 'REOPEN')
          await db!.artworkDedupSourceIdentity.update({
            where: { id: sourceId },
            data: { status: 'OPEN', ownerOperationId: null, generation: { increment: 1 } }
          })
        stream.end(png.subarray(8))
        await running
        const failed = await db!.archiveImport.findUniqueOrThrow({
          where: { id: a.id },
          include: { items: true, generations: true }
        })
        expect(failed.status).toBe('FAILED')
        expect(failed.items[0]!.status).not.toBe('COMPLETED')
        expect(failed.generations[0]).toMatchObject({ token: job.executionToken, sealedAt: null })
        expect(failed.generations[0]!.drainedAt).not.toBeNull()
        expect(failed.dedupSourceSnapshot).toEqual(original)
        expect(await db!.systemJob.count({ where: { parentJobId: job.id } })).toBe(0)
      } finally {
        stream.end()
        await running.catch(() => undefined)
      }
    }
  )

  it('rejects source generation changes at final publication without creating Artwork or recapturing proof', async () => {
    const a = await seed('source-final-publish')
    await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
    const original = (await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot
    const sourceId = parseArtworkDedupSourceSnapshot(original).sources[0]!.sourceId
    const publish = await claim('ARCHIVE_PUBLISH')
    const ctx = context(publish)
    const finalize = ctx.finalizeInTransaction
    ctx.finalizeInTransaction = async (operation) => {
      await db!.artworkDedupSourceIdentity.update({ where: { id: sourceId }, data: { generation: { increment: 1 } } })
      return finalize(operation)
    }
    await expect(execute(publish, dependencies(a.root), ctx)).rejects.toThrow('SOURCE_GENERATION_CHANGED')
    expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(0)
    expect(await db!.artworkExternalRef.count({ where: { providerKey: 'test', externalId: a.id } })).toBe(0)
    expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot).toEqual(original)
    expect(
      (await db!.mediaContentPathWrite.findFirstOrThrow({ where: { sessionId: `archive-publish:${a.id}` } })).status
    ).toBe('ACTIVE')
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

  it('catalog barrier: handoff and replay are fenced and create exactly one publish, freezing automatic priority and tags', async () => {
    const a = await seed('atomic', { origin: 'AUTO', tags: [21, 34] })
    const job = await claim('ARCHIVE_DOWNLOAD')
    const originalProof = (await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot
    const probe = archiveCatalogProbe(db!, parseArtworkDedupSourceSnapshot(originalProof).sources[0]!.sourceId)
    const ctx = context(job), finalize = ctx.finalizeInTransaction
    ctx.finalizeInTransaction = (operation) => finalize<Parameters<typeof operation>[0]['transaction']>((scope) => operation({ ...scope, transaction: probe.wrap(scope.transaction) }))
    await execute(job, dependencies(a.root), ctx)
    expect(probe.hits()).toBe(1)
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
    expect(state.generations[0]?.sealedAt).toBeNull()
    expect(state.generations[0]?.drainedAt).not.toBeNull()
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

  it.each(['PAUSE_REQUESTED', 'CANCEL_REQUESTED', 'SHUTDOWN'] as const)(
    'saves the unsaved final batch on %s and resumes without downloading completed media again',
    async (reason) => {
      const a = await seed(`batch-stop-${reason}`)
      await addPages(a.id, 2)
      const job = await claim('ARCHIVE_DOWNLOAD')
      const controller = new AbortController()
      const ctx = { ...context(job), signal: controller.signal }
      const slow = new PassThrough()
      const open = vi.fn(async () => remote(open.mock.calls.length === 1 ? Readable.from([png]) : slow))
      const deps = dependencies(a.root, open)
      deps.config.mediaConcurrency = 1
      const running = execute(job, deps, ctx)
      void running.catch(() => undefined)
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
      // The first file exists, but the sub-ten batch has not been written yet.
      expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(0)
      if (reason !== 'SHUTDOWN') {
        await db!.systemJob.update({ where: { id: job.id }, data: {
          status: reason === 'PAUSE_REQUESTED' ? 'PAUSING' : 'CANCELLING'
        } })
        if (reason === 'CANCEL_REQUESTED') await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'CANCELLING' } })
      }
      controller.abort({ reason })
      await running
      const stopped = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true, generations: true } })
      expect(stopped.status).toBe(reason === 'PAUSE_REQUESTED' ? 'PAUSED' : reason === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'PENDING')
      expect(stopped.completedItems).toBe(1)
      expect(stopped.items.filter((item) => item.status === 'COMPLETED')).toHaveLength(1)
      expect(stopped.generations[0]!.drainedAt).not.toBeNull()
      expect(slow.destroyed).toBe(true)
      expect(await db!.systemJob.count({ where: { parentJobId: job.id, type: 'ARCHIVE_PUBLISH' } })).toBe(0)
      if (reason === 'CANCEL_REQUESTED') return
      await db!.systemJob.update({ where: { id: job.id }, data: { status: 'PENDING', availableAt: clock.now() } })
      await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'PENDING' } })
      const resumed = await claim('ARCHIVE_DOWNLOAD')
      const reopen = vi.fn(async () => remote(Readable.from([png])))
      await execute(resumed, dependencies(a.root, reopen))
      expect(reopen).toHaveBeenCalledOnce()
      expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(2)
    }
  )

  it('saves a small batch after five seconds while the next image is still streaming', async () => {
    const a = await seed('batch-timer')
    await addPages(a.id, 2)
    const slow = new PassThrough()
    const open = vi.fn(async () => remote(open.mock.calls.length === 1 ? Readable.from([png]) : slow))
    const job = await claim('ARCHIVE_DOWNLOAD')
    const deps = dependencies(a.root, open)
    deps.config.mediaConcurrency = 1
    const running = execute(job, deps)
    void running.catch(() => undefined)
    try {
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
      expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(0)
      await vi.waitFor(async () => {
        expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(1)
      }, { timeout: 8_000, interval: 100 })
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).message).toBe('已下载 1/2')
    } finally {
      slow.end(png)
      await running
    }
    expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).phase).toBe('PUBLISH')
  }, 15_000)

  it('commits ten completed files together, then flushes the remaining two with progress', async () => {
    const a = await seed('batch-ten')
    await addPages(a.id, 12)
    const job = await claim('ARCHIVE_DOWNLOAD')
    const ctx = context(job)
    const commit = ctx.checkpointInTransaction!
    const checkpoint = vi.fn()
    ctx.checkpointInTransaction = (operation) => { checkpoint(); return commit(operation) }
    const open = vi.fn(async () => {
      if (open.mock.calls.length === 10) {
        expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(0)
      }
      if (open.mock.calls.length === 11) {
        expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(10)
        expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).message).toBe('已下载 10/12')
      }
      return remote(Readable.from([png]))
    })
    const deps = dependencies(a.root, open)
    deps.config.mediaConcurrency = 1
    await execute(job, deps, ctx)
    expect(checkpoint).toHaveBeenCalledTimes(2)
    expect(await db!.archiveImportItem.count({ where: { archiveImportId: a.id, status: 'COMPLETED' } })).toBe(12)
    const events = await db!.systemJobEvent.findMany({ where: { jobId: job.id, type: 'job.progress' } })
    expect(events.some((event) => (event.data as { data?: { completedItems: number } })?.data?.completedItems === 12)).toBe(true)
  })

  it('downloads the unsaved final batch again after an abrupt restart', async () => {
    const a = await seed('batch-crash')
    const job = await claim('ARCHIVE_DOWNLOAD')
    const ctx = context(job)
    ctx.checkpointInTransaction = async () => { throw new Error('simulated process exit before batch commit') }
    ctx.finalizeInTransaction = async () => { throw new Error('simulated process exit before batch commit') }
    await expect(execute(job, dependencies(a.root), ctx)).rejects.toThrow('simulated process exit')
    const old = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } })
    expect(old.items[0]!.status).toBe('PENDING')
    const files = await readdir(path.join(a.root, old.stagingPath, 'media'))
    expect(files).toHaveLength(1)
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('ARCHIVE_DOWNLOAD')
    clock.advance(600_000)
    const next = await claim('ARCHIVE_DOWNLOAD')
    const open = vi.fn(async () => remote(Readable.from([png])))
    await execute(next, dependencies(a.root, open))
    expect(open).toHaveBeenCalledOnce()
    const result = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } })
    expect(result.items[0]!.status).toBe('COMPLETED')
    expect(result.phase).toBe('PUBLISH')
    expect(await readFile(path.join(a.root, result.stagingPath, result.items[0]!.stagedPath!))).toEqual(png)
  })

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
    expect(fresh.generations.find((generation) => generation.token === old.generationToken)?.drainedAt).not.toBeNull()
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

  it.each(['crash-before-rename', 'rename-enospc', 'cancel-before-rename'] as const)(
    'restores an exact pre-rename publication through an offline grant: %s',
    async (fault) => {
      const a = await seed(`pre-rename-${fault}`)
      await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
      const publish = await claim('ARCHIVE_PUBLISH')
      const ctx = context(publish)
      const prepare = vi.spyOn(storage, 'prepareArchiveRevisionDirectory').mockImplementation(async () => {
        if (fault === 'cancel-before-rename')
          await db!.systemJob.update({
            where: { id: publish.id },
            data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
          })
        throw Object.assign(new Error('injected before rename'), { code: 'ENOSPC' })
      })
      if (fault === 'crash-before-rename')
        ctx.finalizeInTransaction = async () => {
          throw new Error('process stopped before settlement')
        }
      if (fault === 'rename-enospc') await execute(publish, dependencies(a.root), ctx)
      else await expect(execute(publish, dependencies(a.root), ctx)).rejects.toThrow()
      const oldClaim = await db!.mediaContentPathWrite.findFirstOrThrow({ where: { jobId: publish.id } })
      expect(oldClaim.status).toBe('ACTIVE')
      const finalPath = path.join(a.root, `sources/test/bucket/${a.id}/revisions/${a.id}`)
      expect(await storage.pathExists(finalPath)).toBe(false)
      if (fault !== 'rename-enospc') {
        clock.advance(61_000)
        await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
        clock.advance(600_000)
      }
      if (fault === 'cancel-before-rename') {
        expect((await db!.systemJob.findUniqueOrThrow({ where: { id: publish.id } })).status).toBe('PAUSED')
        expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('PAUSED')
      }
      await db!.systemJob.update({
        where: { id: publish.id },
        data: { status: 'PENDING', availableAt: clock.now(), cancelRequestedAt: null, pauseRequestedAt: null }
      })
      await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'PENDING' } })
      const ordinaryRetry = await claim('ARCHIVE_PUBLISH')
      prepare.mockRestore()
      await execute(ordinaryRetry, dependencies(a.root))
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: publish.id } })).status).toBe('PAUSED')
      expect(await storage.pathExists(finalPath)).toBe(false)
      expect(await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: oldClaim.id } })).toEqual(oldClaim)
      const inspection = await db!.$transaction((tx) =>
        inspectMediaContentRecovery(tx, {
          jobId: publish.id,
          sessionId: `archive-publish:${a.id}`,
          now: clock.now(),
          readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
        })
      )
      if (inspection.status !== 'READY') throw new Error(`inspection ${inspection.status}`)
      const grant = await db!.$transaction((tx) =>
        grantMediaContentRecovery(tx, {
          snapshot: inspection.value.snapshot,
          expectedDigest: inspection.value.digest,
          backupCheckpointRef: 'fixture://pre-rename',
          operator: 'fixture',
          confirmAllWritersStopped: true,
          now: clock.now(),
          readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
        })
      )
      if (grant.status !== 'READY') throw new Error(`grant ${grant.status}`)
      const resume = await db!.$transaction((tx) =>
        resumeGrantedMediaContentRecovery(tx, {
          grantId: grant.value.grantId,
          operator: 'fixture',
          confirmAllWritersStopped: true,
          now: clock.now(),
          readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
        })
      )
      expect(resume.status).toBe('READY')
      expect((await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('PENDING')
      const recovered = await claim('ARCHIVE_PUBLISH')
      const recoveredContext = context(recovered)
      await execute(recovered, dependencies(a.root), recoveredContext)
      if ((await db!.systemJob.findUniqueOrThrow({ where: { id: publish.id } })).status !== 'COMPLETED')
        throw (
          vi.mocked(recoveredContext.logger.error).mock.calls.at(-1)?.[1] ??
          new Error('recovered publication did not complete')
        )
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: publish.id } })).status).toBe('COMPLETED')
      expect(await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: oldClaim.id } })).toMatchObject({
        status: 'COMPLETED',
        writeToken: oldClaim.writeToken,
        directoryId: oldClaim.directoryId,
        declarationVersion: oldClaim.declarationVersion + 2n,
        executionToken: recovered.executionToken
      })
      expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(1)
      await expect(execute(publish, dependencies(a.root))).rejects.toThrow()
    }
  )

  it('preserves unresolved post-rename proof against direct cleanup and RECONCILE, then resumes publication', async () => {
    const a = await seed('cleanup-publish-gate')
    await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
    const publish = await claim('ARCHIVE_PUBLISH')
    const ctx = context(publish)
    ctx.finalizeInTransaction = async () => {
      throw new Error('crash after rename')
    }
    await expect(execute(publish, dependencies(a.root), ctx)).rejects.toThrow('crash after rename')
    const oldClaim = await db!.mediaContentPathWrite.findFirstOrThrow({ where: { jobId: publish.id } })
    const finalPath = path.join(a.root, `sources/test/bucket/${a.id}/revisions/${a.id}`)
    const manifest = await readFile(path.join(finalPath, 'manifest.json'))
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
    await db!.systemJob.update({ where: { id: publish.id }, data: { status: 'PAUSED' } })
    await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'PAUSED', cleanupRequestedAt: clock.now() } })
    const before = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })
    await seedJob('ARCHIVE_MAINTENANCE', 'blocked-cleanup', { action: 'CLEAN_STAGING', archiveImportId: a.id })
    const cleanupJob = await claim('ARCHIVE_MAINTENANCE')
    await expect(
      executeArchiveMaintenance(context(cleanupJob) as never, { database: db!, config: { scanRoot: a.root } })
    ).rejects.toThrow('恢复原 PUBLISH')
    await repo!.release(fence(cleanupJob))
    await db!.systemJob.update({ where: { id: cleanupJob.id }, data: { status: 'CANCELLED' } })
    await seedJob('ARCHIVE_MAINTENANCE', 'blocked-reconcile', { action: 'RECONCILE' })
    const reconcile = await claim('ARCHIVE_MAINTENANCE')
    const reconcileContext = context(reconcile)
    reconcileContext.enqueueChild = vi.fn(async () => {
      throw new Error('must not enqueue cleanup')
    })
    await executeArchiveMaintenance(reconcileContext as never, {
      database: db!,
      config: { scanRoot: a.root },
      now: () => clock.now()
    })
    expect(reconcileContext.enqueueChild).not.toHaveBeenCalled()
    expect(await readFile(path.join(finalPath, 'manifest.json'))).toEqual(manifest)
    expect(await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).toEqual(before)
    expect(await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: oldClaim.id } })).toEqual(oldClaim)
    await db!.archiveImport.update({ where: { id: a.id }, data: { status: 'PENDING', cleanupRequestedAt: null } })
    await db!.systemJob.update({ where: { id: publish.id }, data: { status: 'PENDING', availableAt: clock.now() } })
    await execute(await claim('ARCHIVE_PUBLISH'), dependencies(a.root))
    expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(1)
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
    const prepare = vi.spyOn(storage, 'prepareArchiveRevisionDirectory').mockImplementation(async () => {
      throw new Error('completed publication recovery must not write files')
    })
    clock.advance(61_000)
    await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
    clock.advance(600_000)
    const retry = await claim('ARCHIVE_PUBLISH')
    const retryContext = context(retry)
    retryContext.finalizeInTransaction = async () => {
      throw new Error('crash after rebind')
    }
    await expect(execute(retry, dependencies(a.root, network), retryContext)).rejects.toThrow('crash after rebind')
    await expect(execute(publish, dependencies(a.root, network))).rejects.toThrow()
    await execute(retry, dependencies(a.root, network))
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
    expect(prepare).not.toHaveBeenCalled()
    const contentClaim = await db!.mediaContentPathWrite.findFirstOrThrow({
      where: { sessionId: `archive-publish:${a.id}` }
    })
    expect(contentClaim).toMatchObject({
      status: 'COMPLETED',
      executionToken: retry.executionToken,
      executionAttempt: retry.attempt,
      declarationVersion: 3n
    })
    await expect(execute(publish, dependencies(a.root, network))).rejects.toThrow()
    expect(prepare).not.toHaveBeenCalled()
    expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(1)
    validate.mockRestore()
    copy.mockRestore()
  })

  it.each(['staging-remains', 'manifest-changed', 'cleanup-requested'])(
    'preserves the old publication claim when recovery proof fails: %s',
    async (fault) => {
      const a = await seed(`claim-proof-${fault}`)
      await execute(await claim('ARCHIVE_DOWNLOAD'), dependencies(a.root))
      const publish = await claim('ARCHIVE_PUBLISH')
      const ctx = context(publish)
      ctx.finalizeInTransaction = async () => {
        throw new Error('crash after rename')
      }
      await expect(execute(publish, dependencies(a.root), ctx)).rejects.toThrow('crash after rename')
      const oldClaim = await db!.mediaContentPathWrite.findFirstOrThrow({
        where: { sessionId: `archive-publish:${a.id}` }
      })
      const sealed = await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })
      const finalPath = path.join(a.root, `sources/test/bucket/${a.id}/revisions/${a.id}`)
      if (fault === 'staging-remains') await mkdir(path.join(a.root, sealed.stagingPath), { recursive: true })
      if (fault === 'manifest-changed') await writeFile(path.join(finalPath, 'manifest.json'), '{}')
      clock.advance(61_000)
      await repo!.recoverExpiredExecution('BACKGROUND_WRITER')
      clock.advance(600_000)
      const retry = await claim('ARCHIVE_PUBLISH')
      if (fault === 'cleanup-requested')
        await db!.archiveImport.update({ where: { id: a.id }, data: { cleanupRequestedAt: clock.now() } })
      await execute(retry, dependencies(a.root))
      const retained = await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: oldClaim.id } })
      expect(retained).toMatchObject({
        status: 'ACTIVE',
        declarationVersion: oldClaim.declarationVersion,
        executionToken: publish.executionToken
      })
      expect(await db!.archiveRevision.count({ where: { archiveImportId: a.id } })).toBe(0)
      expect(await storage.pathExists(path.join(finalPath, 'media'))).toBe(true)
    }
  )

  it.each([1, 2])(
    'catalog barrier: legacy v%i handoff performs no network and preserves tags, origin facts and retry budget',
    async (version) => {
      const a = await seed(`legacy-${version}`, { legacy: version })
      const availableAt = new Date(clock.now().getTime() - 10_000)
      await db!.systemJob.update({ where: { id: a.jobId }, data: { attempt: 1, status: 'RETRY_WAIT', availableAt } })
      const legacy = await claim('ARCHIVE_IMPORT', 'legacy', [version])
      const network = vi.fn(async () => {
        throw new Error('legacy must not download')
      })
      const originalProof = (await db!.archiveImport.findUniqueOrThrow({ where: { id: a.id } })).dedupSourceSnapshot
      const probe = archiveCatalogProbe(db!, parseArtworkDedupSourceSnapshot(originalProof).sources[0]!.sourceId)
      const ctx = context(legacy), finalize = ctx.finalizeInTransaction
      ctx.finalizeInTransaction = (operation) => finalize<Parameters<typeof operation>[0]['transaction']>((scope) => operation({ ...scope, transaction: probe.wrap(scope.transaction) }))
      await execute(legacy, dependencies(a.root, network), ctx)
      expect(probe.hits()).toBe(1)
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
    await db!.archiveStagingGeneration.create({ data: {
      token: randomUUID(), archiveImportId: a.id, jobId: a.jobId,
      path: finalPath, drainedAt: clock.now(),
      manifestSha256: await storage.readArchiveManifestDigest(path.join(a.root, finalPath))
    } })
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
      dedupSourceSnapshot: await captureArchiveFixtureSource(db!, 'test', id),
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
async function addPages(archiveImportId: string, total: number) {
  await db!.archiveImport.update({ where: { id: archiveImportId }, data: { totalItems: total } })
  await db!.archiveImportItem.createMany({ data: Array.from({ length: total - 1 }, (_, index) => ({
    archiveImportId, pageIndex: index + 1, sourcePageUrl: `https://example.test/${index + 1}`,
    locator: {}, expectedFilename: `${index + 1}.png`
  })) })
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
    checkpointInTransaction: async (operation) => (await repo!.withFencedProgressTransaction(fence(job), operation)).result,
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
  await db.mediaContentRecoveryGrant.deleteMany({
    where: { job: { archiveExecutions: { some: { archiveImportId: { startsWith: prefix } } } } }
  })
  await cleanupFixtureContentDirectories(db, roots)
  const executions = await db.archiveImportExecution.findMany({
    where: { archiveImportId: { startsWith: prefix } },
    select: { jobId: true }
  })
  for (const item of executions) extraJobs.add(item.jobId)
  await db.artwork.deleteMany({ where: { title: prefix } })
  await db.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await db.artworkDedupSourceIdentity.deleteMany({ where: { providerKey: 'test', externalId: { startsWith: prefix } } })
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
