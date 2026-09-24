import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { WorkerCapability } from '@pixishelf/job-contracts'
import {
  finishAnimationDurationSourceWrite,
  listAnimationDurationCandidates,
  PrismaClient,
  type Prisma
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type ExecutionFence,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { executeAnimationDurationProbe } from '../animation-duration-probe.ts'
import { IsolatedDurationProbe } from '../animation-duration-child.ts'

const databaseUrl = process.env.ANIMATION_DURATION_TEST_DATABASE_URL ??
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ??
  (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const prefix = `duration-job-${randomUUID()}`
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const clock = new MutableQueueClock(new Date('2026-09-24T00:00:00.000Z'))
const capability: WorkerCapability[] = [
  { jobType: 'ANIMATION_DURATION_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]

function client(): PrismaClient {
  if (!database) throw new Error('Animation duration Postgres URL is required')
  return database
}

function fence(job: ClaimedJob): ExecutionFence {
  return { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
}

function context(repository: PostgresQueueRepository, job: ClaimedJob, signal = new AbortController().signal): ExecutionContext<Record<string, never>, EnqueuedChildJob> {
  const owned = fence(job)
  return {
    job,
    payload: {},
    signal,
    progress: (update) => repository.updateProgress({ ...owned, ...update }),
    enqueueChild: async () => { throw new Error('No child job expected') },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(owned, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(owned, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}

async function seedJob(): Promise<string> {
  const id = `${prefix}-${randomUUID()}`
  await client().systemJob.create({
    data: {
      id, type: 'ANIMATION_DURATION_PROBE', executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1, status: 'PENDING', triggerSource: 'MANUAL',
      payload: {}, queuePriority: 35, effectivePriority: 35,
      availableAt: clock.now(), maxAttempts: 3
    }
  })
  return id
}

describePostgres('animation duration queue and database boundaries', () => {
  beforeEach(async () => {
    await client().jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
    await client().systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  })

  afterAll(async () => {
    if (!database) return
    await database.image.deleteMany({ where: { path: { startsWith: prefix } } })
    await database.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await database.$disconnect()
  })

  it('pages only classified animated WebP rows and skips persisted READY rows', async () => {
    const fixturePrefix = `${prefix}/paging/`
    for (let first = 0; first < 10_001; first += 1_000) {
      const count = Math.min(1_000, 10_001 - first)
      await client().image.createMany({
        data: Array.from({ length: count }, (_, offset) => ({
          path: `${fixturePrefix}${first + offset}.webp`,
          webpAnimationStatus: (first + offset) % 3,
          mediaType: (first + offset) % 3 === 2 ? 'ANIMATION' as const : 'IMAGE' as const
        }))
      })
    }
    const ready = await client().image.findFirstOrThrow({ where: { path: `${fixturePrefix}2.webp` } })
    await client().imageAnimationMetadata.create({
      data: { imageId: ready.id, status: 'READY', format: 'WEBP', durationMs: 100n,
        frameCount: 1, loopCount: 0, timingPolicyVersion: 1, sourcePath: ready.path }
    })
    let cursor = 0
    let seen = 0
    let pages = 0
    const classified = new Set<number | null>()
    while (true) {
      const page = await listAnimationDurationCandidates(client(), { afterImageId: cursor, limit: 100, now: clock.now() })
      if (page.length === 0) break
      expect(page.length).toBeLessThanOrEqual(100)
      for (const item of page) {
        if (!item.path.startsWith(fixturePrefix)) continue
        seen += 1
        classified.add(item.webpAnimationStatus)
        expect(item.id).toBeGreaterThan(cursor)
        expect(item.id).not.toBe(ready.id)
      }
      cursor = page.at(-1)!.id
      pages += 1
    }
    expect(seen).toBe(3_332)
    expect(pages).toBeGreaterThanOrEqual(34)
    expect(classified).toEqual(new Set([2]))
    await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
  }, 120_000)

  it('does not read static or unknown WebP, then picks up a newly classified animation below an old checkpoint', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-scope-'))
    const fixturePrefix = `${prefix}/scope/`
    try {
      await mkdir(path.join(root, prefix, 'scope'), { recursive: true })
      const filePath = path.join(root, fixturePrefix, 'unknown.webp')
      await writeFile(filePath, await readFile(path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp')))
      const fileStat = await stat(filePath, { bigint: true })
      const fileState = { size: fileStat.size, mtimeMs: fileStat.mtimeMs, ctimeMs: fileStat.ctimeMs,
        deviceId: fileStat.dev, inode: fileStat.ino }
      const images = await Promise.all([
        client().image.create({ data: { path: `${fixturePrefix}static.webp`, webpAnimationStatus: 1 } }),
        client().image.create({ data: { path: `${fixturePrefix}unknown.webp`, webpAnimationStatus: 0 } }),
        client().image.create({ data: { path: `${fixturePrefix}unclassified.webp`, webpAnimationStatus: null } })
      ])
      const calls: string[] = []
      const fakeProbe = { probe: async (_root: string, relativePath: string) => {
        calls.push(relativePath)
        return { probe: { status: 'READY', format: 'WEBP', durationMs: 200, frameCount: 2,
          loopCount: 0, readBytes: 100, readOperations: 1, chunks: 3 },
          preState: fileState, postState: fileState, elapsedMs: 2 }
      } } as unknown as IsolatedDurationProbe
      const jobId = await seedJob()
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const claimed = await repository.claim(`${prefix}-worker`, capability)
      await executeAnimationDurationProbe(context(repository, claimed!), {
        database: client(), scanRoot: root, now: () => clock.now(), createProbe: () => fakeProbe
      })
      expect(calls).toEqual([])
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
      const unknown = images[1]!
      await client().image.update({ where: { id: unknown.id }, data: { webpAnimationStatus: 2, mediaType: 'ANIMATION' } })
      const resumeId = await seedJob()
      await client().systemJob.update({ where: { id: resumeId }, data: { result: {
        kind: 'ANIMATION_DURATION_CHECKPOINT', afterImageId: images[2]!.id,
        succeeded: 0, static: 0, failedAttempts: 0, logicalReadBytes: 0,
        logicalReadOperations: 0, unmeasuredFailureAttempts: 0, probeElapsedMs: 0
      } } })
      const resumed = await repository.claim(`${prefix}-worker`, capability)
      expect(resumed?.id).toBe(resumeId)
      await executeAnimationDurationProbe(context(repository, resumed!), {
        database: client(), scanRoot: root, now: () => clock.now(), createProbe: () => fakeProbe
      })
      expect(calls).toEqual([unknown.path])
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: resumeId } })).status).toBe('COMPLETED')
      expect((await client().imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: unknown.id } })).status).toBe('READY')
      expect(await client().imageAnimationMetadata.count({ where: { imageId: { in: [images[0]!.id, images[2]!.id] } } })).toBe(0)
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('continues across 100-row pages and refreshes legacy progress without a retry', async () => {
    const fixturePrefix = `${prefix}/continuous/`
    try {
      await client().image.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
        path: `${fixturePrefix}${index}.webp`, webpAnimationStatus: 2, mediaType: 'ANIMATION' as const
      })) })
      const jobId = await seedJob()
      await client().systemJob.update({ where: { id: jobId }, data: {
        stage: 'YIELDING', message: '正在让出 Worker', progress: 51,
        progressData: {
          version: 1, kind: 'animation-duration-probe', stage: 'YIELDING',
          succeededItems: 0, staticItems: 0, failedItems: 0, remainingItems: 213_294,
          retryPendingItems: 0, writePendingItems: 0, logicalReadBytes: 0,
          logicalReadOperations: 0, unmeasuredFailureAttempts: 0, probeElapsedMs: 0,
          sampledAt: clock.now().toISOString()
        }
      } })
      const fileState = { size: 123n, mtimeMs: 1n, ctimeMs: 1n, deviceId: 1n, inode: 1n }
      const calls: string[] = []
      const fakeProbe = { probe: async (_root: string, relativePath: string) => {
        calls.push(relativePath)
        return { probe: { status: 'READY', format: 'WEBP', durationMs: 200, frameCount: 2,
          loopCount: 0, readBytes: 100, readOperations: 1, chunks: 3 },
          preState: fileState, postState: fileState, elapsedMs: 1 }
      } } as unknown as IsolatedDurationProbe
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const claimed = await repository.claim(`${prefix}-worker`, capability)
      await executeAnimationDurationProbe(context(repository, claimed!), {
        database: client(), scanRoot: 'unused', now: () => clock.now(), createProbe: () => fakeProbe
      })
      expect(calls).toHaveLength(101)
      const job = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
      expect(job.status).toBe('COMPLETED')
      expect(job.progress).toBe(100)
      expect(await client().systemJobEvent.count({ where: { jobId, type: 'job.retry_scheduled' } })).toBe(0)
      const progressEvents = await client().systemJobEvent.findMany({
        where: { jobId, type: { in: ['job.progress', 'job.stage_changed'] } }, orderBy: { id: 'asc' }
      })
      expect(progressEvents.length).toBeGreaterThanOrEqual(5)
      expect(progressEvents[0]).toMatchObject({
        stage: 'PROBING', message: expect.stringContaining('剩余 101'),
        data: { progressData: { remainingItems: 101, stage: 'PROBING' } }
      })
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
    }
  }, 120_000)

  it('enqueues, claims, fences publication, and completes beyond the old 10-file batch in one execution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-'))
    const fixturePrefix = `${prefix}/execution/`
    try {
      await mkdir(path.join(root, prefix, 'execution'), { recursive: true })
      const realFixture = await readFile(path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp'))
      for (let index = 0; index < 11; index += 1) {
        await writeFile(path.join(root, fixturePrefix, `${index}.webp`), realFixture)
      }
      await client().image.createMany({ data: Array.from({ length: 11 }, (_, index) => ({
        path: `${fixturePrefix}${index}.webp`,
        webpAnimationStatus: 2,
        mediaType: 'ANIMATION' as const
      })) })
      const jobId = await seedJob()
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const first = await repository.claim(`${prefix}-worker`, capability)
      expect(first?.id).toBe(jobId)
      const claimed = first!
      const unpublished = await client().image.findFirstOrThrow({ where: { path: `${fixturePrefix}10.webp` } })
      await expect(repository.withFencedMutationTransaction({ ...fence(claimed), executionToken: 'stale' }, async (tx) => {
        await (tx as Prisma.TransactionClient).imageAnimationMetadata.create({
          data: { imageId: unpublished.id, status: 'PENDING' }
        })
      })).rejects.toThrow()
      expect(await client().imageAnimationMetadata.findUnique({ where: { imageId: unpublished.id } })).toBeNull()

      await executeAnimationDurationProbe(context(repository, claimed), {
        database: client(), scanRoot: root, now: () => clock.now()
      })
      const completed = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
      expect(completed.status).toBe('COMPLETED')
      expect(completed.errorCode).toBeNull()
      expect(completed.error).toBeNull()
      expect(await client().systemJobDiagnosticReport.count({ where: { jobId } })).toBe(0)
      expect(await client().systemJobEvent.count({ where: { jobId, type: 'job.retry_scheduled' } })).toBe(0)
      expect(await client().imageAnimationMetadata.count({ where: { image: { path: { startsWith: fixturePrefix } }, status: 'READY' } })).toBe(11)
      expect(await repository.claim(`${prefix}-worker`, capability)).toBeNull()
      await expect(repository.withFencedMutationTransaction(fence(claimed), async (tx) => {
        await (tx as Prisma.TransactionClient).imageAnimationMetadata.create({
          data: { imageId: unpublished.id, status: 'PENDING' }
        })
      })).rejects.toThrow()
      expect((await client().imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: unpublished.id } })).status).toBe('READY')

      const replayJobId = await seedJob()
      const replay = await repository.claim(`${prefix}-worker`, capability)
      expect(replay?.id).toBe(replayJobId)
      const noRead = { probe: async () => { throw new Error('READY source reread') } } as unknown as IsolatedDurationProbe
      await executeAnimationDurationProbe(context(repository, replay!), {
        database: client(), scanRoot: root, now: () => clock.now(), createProbe: () => noRead
      })
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: replayJobId } })).status).toBe('COMPLETED')
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('handles a due low-ID retry before the high-ID cursor without moving that cursor backward', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-priority-'))
    const fixturePrefix = `${prefix}/priority/`
    try {
      await mkdir(path.join(root, prefix, 'priority'), { recursive: true })
      const realFixture = await readFile(path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp'))
      await client().image.createMany({
        data: Array.from({ length: 12 }, (_, index) => ({ path: `${fixturePrefix}${index}.webp`, webpAnimationStatus: 2 }))
      })
      const images = await client().image.findMany({
        where: { path: { startsWith: fixturePrefix } }, orderBy: { id: 'asc' }
      })
      const low = images[0]!
      const last = images.at(-1)!
      await writeFile(path.join(root, low.path), realFixture)
      await writeFile(path.join(root, last.path), realFixture)
      await client().imageAnimationMetadata.create({
        data: { imageId: low.id, status: 'FAILED', format: 'WEBP', sourcePath: low.path,
          failureCode: 'ENOENT', attemptCount: 1, nextRetryAt: new Date(clock.now().getTime() - 1_000) }
      })
      const jobId = await seedJob()
      await client().systemJob.update({
        where: { id: jobId },
        data: { result: {
          kind: 'ANIMATION_DURATION_CHECKPOINT', afterImageId: images[10]!.id,
          succeeded: 0, static: 0, failedAttempts: 1, logicalReadBytes: 0,
          logicalReadOperations: 0, unmeasuredFailureAttempts: 1, probeElapsedMs: 0
        } }
      })
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const claimed = await repository.claim(`${prefix}-worker`, capability)
      expect(claimed?.id).toBe(jobId)
      await executeAnimationDurationProbe(context(repository, claimed!), {
        database: client(), scanRoot: root, now: () => clock.now()
      })
      expect((await client().imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: low.id } })).status).toBe('READY')
      expect((await client().imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: last.id } })).status).toBe('READY')
      const checkpoint = (await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).result as Record<string, unknown>
      expect(checkpoint.afterImageId).toBeGreaterThanOrEqual(images[10]!.id)
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['PAUSING', 'CANCELLING'] as const)(
    'stops at a file boundary for %s, preserves completed work and resumes a paused job', async (requestedStatus) => {
      const fixturePrefix = `${prefix}/control-${requestedStatus.toLowerCase()}/`
      try {
        await client().image.createMany({ data: Array.from({ length: 3 }, (_, index) => ({
          path: `${fixturePrefix}${index}.webp`, webpAnimationStatus: 2, mediaType: 'ANIMATION' as const
        })) })
        const images = await client().image.findMany({ where: { path: { startsWith: fixturePrefix } }, orderBy: { id: 'asc' } })
        const jobId = await seedJob()
        const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
        const claimed = await repository.claim(`${prefix}-worker`, capability)
        const controller = new AbortController()
        const calls: string[] = []
        let interrupt = true
        const fileState = { size: 123n, mtimeMs: 1n, ctimeMs: 1n, deviceId: 1n, inode: 1n }
        const fakeProbe = { probe: async (_root: string, relativePath: string) => {
          calls.push(relativePath)
          if (interrupt && calls.length === 2) {
            if (requestedStatus === 'PAUSING') {
              await client().systemJob.update({ where: { id: jobId }, data: { status: 'PAUSING' } })
            } else {
              await repository.requestCancellation(jobId)
            }
            controller.abort()
          }
          return { probe: { status: 'READY', format: 'WEBP', durationMs: 200, frameCount: 2,
            loopCount: 0, readBytes: 100, readOperations: 1, chunks: 3 },
            preState: fileState, postState: fileState, elapsedMs: 1 }
        } } as unknown as IsolatedDurationProbe
        await executeAnimationDurationProbe(context(repository, claimed!, controller.signal), {
          database: client(), scanRoot: 'unused', now: () => clock.now(), createProbe: () => fakeProbe
        })
        const stopped = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
        expect(stopped.status).toBe(requestedStatus === 'PAUSING' ? 'PAUSED' : 'CANCELLED')
        expect((stopped.result as Record<string, number>).succeeded).toBe(1)
        expect(await client().imageAnimationMetadata.count({ where: { imageId: { in: images.map((item) => item.id) }, status: 'READY' } })).toBe(1)
        expect(calls).toEqual([images[0]!.path, images[1]!.path])
        if (requestedStatus === 'PAUSING') {
          interrupt = false
          await client().systemJob.update({ where: { id: jobId }, data: {
            status: 'PENDING', pauseRequestedAt: null, availableAt: clock.now()
          } })
          const resumed = await repository.claim(`${prefix}-worker`, capability)
          expect(resumed?.id).toBe(jobId)
          await executeAnimationDurationProbe(context(repository, resumed!), {
            database: client(), scanRoot: 'unused', now: () => clock.now(), createProbe: () => fakeProbe
          })
          expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
          expect(calls.filter((item) => item === images[0]!.path)).toHaveLength(1)
          expect(await client().imageAnimationMetadata.count({ where: { imageId: { in: images.map((item) => item.id) }, status: 'READY' } })).toBe(3)
        }
      } finally {
        await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      }
    }, 120_000
  )

  it('records a changing first source as transient failure and still publishes the next file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-changing-'))
    const fixturePrefix = `${prefix}/changing/`
    try {
      await mkdir(path.join(root, prefix, 'changing'), { recursive: true })
      await client().image.createMany({ data: [
        { path: `${fixturePrefix}a.webp`, webpAnimationStatus: 2 },
        { path: `${fixturePrefix}b.webp`, webpAnimationStatus: 2 }
      ] })
      const valid = await readFile(path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp'))
      const validPath = path.join(root, fixturePrefix, 'b.webp')
      await writeFile(validPath, valid)
      const fileStat = await stat(validPath, { bigint: true })
      const fileState = {
        size: fileStat.size, mtimeMs: fileStat.mtimeMs, ctimeMs: fileStat.ctimeMs,
        deviceId: fileStat.dev, inode: fileStat.ino
      }
      const fakeProbe = { probe: async (_root: string, relativePath: string) => {
        if (relativePath.endsWith('a.webp')) throw Object.assign(new Error('changed'), { code: 'SOURCE_CHANGED' })
        return {
          probe: { status: 'READY', format: 'WEBP', durationMs: 200, frameCount: 2,
            loopCount: 0, readBytes: 100, readOperations: 1, chunks: 3 },
          preState: fileState, postState: fileState, elapsedMs: 2
        }
      } } as unknown as IsolatedDurationProbe
      const jobId = await seedJob()
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const claimed = await repository.claim(`${prefix}-worker`, capability)
      expect(claimed?.id).toBe(jobId)
      await executeAnimationDurationProbe(context(repository, claimed!), {
        database: client(), scanRoot: root, now: () => clock.now(), createProbe: () => fakeProbe
      })
      const rows = await client().image.findMany({
        where: { path: { startsWith: fixturePrefix } }, include: { animationMetadata: true }, orderBy: { id: 'asc' }
      })
      expect(rows[0]?.animationMetadata).toMatchObject({ status: 'FAILED', failureCode: 'SOURCE_CHANGED', attemptCount: 1 })
      expect(rows[0]?.animationMetadata?.nextRetryAt).toEqual(new Date(clock.now().getTime() + 60_000))
      expect(rows[1]?.animationMetadata).toMatchObject({ status: 'READY', durationMs: 200n })
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for a source writer without finishing or holding the lane, then resumes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-write-'))
    const fixturePrefix = `${prefix}/write/`
    try {
      await mkdir(path.join(root, prefix, 'write'), { recursive: true })
      const media = await readFile(path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp'))
      await writeFile(path.join(root, fixturePrefix, 'item.webp'), media)
      const image = await client().image.create({ data: { path: `${fixturePrefix}item.webp`, webpAnimationStatus: 2 } })
      await client().imageAnimationMetadata.create({
        data: { imageId: image.id, status: 'PENDING', sourcePath: image.path, writeInProgress: true }
      })
      const jobId = await seedJob()
      const repository = new PostgresQueueRepository(client() as unknown as QueueDatabase, { clock })
      const first = await repository.claim(`${prefix}-worker`, capability)
      expect(first?.id).toBe(jobId)
      await executeAnimationDurationProbe(context(repository, first!), {
        database: client(), scanRoot: root, now: () => clock.now()
      })
      const waiting = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
      expect(waiting).toMatchObject({ status: 'RETRY_WAIT', stage: 'WAITING_SOURCE_WRITE' })
      expect(waiting.errorCode).toBeNull()
      expect(waiting.error).toBeNull()
      expect(waiting.availableAt).toEqual(new Date(clock.now().getTime() + 600_000))
      expect(await repository.claim(`${prefix}-worker`, capability)).toBeNull()
      await client().$transaction(async (tx) => {
        await finishAnimationDurationSourceWrite(tx, { imageId: image.id, expectedRevision: 0 })
      })
      clock.set(new Date(clock.now().getTime() + 600_001))
      const second = await repository.claim(`${prefix}-worker`, capability)
      expect(second?.id).toBe(jobId)
      await executeAnimationDurationProbe(context(repository, second!), {
        database: client(), scanRoot: root, now: () => clock.now()
      })
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
      expect((await client().imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: image.id } })).status).toBe('READY')
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  })
})
