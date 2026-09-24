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

function context(repository: PostgresQueueRepository, job: ClaimedJob): ExecutionContext<Record<string, never>, EnqueuedChildJob> {
  const owned = fence(job)
  return {
    job,
    payload: {},
    signal: new AbortController().signal,
    progress: async () => undefined,
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

  it('pages 10001 real WebP rows, including old classifications, and skips persisted READY rows', async () => {
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
    const ready = await client().image.findFirstOrThrow({ where: { path: `${fixturePrefix}0.webp` } })
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
    expect(seen).toBe(10_000)
    expect(pages).toBeGreaterThanOrEqual(100)
    expect(classified).toEqual(new Set([0, 1, 2]))
    await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
  }, 120_000)

  it('enqueues, claims, fences publication, yields its writer lane, and resumes without rereading successes', async () => {
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
        webpAnimationStatus: index % 2 ? 1 : 2,
        mediaType: index % 2 ? 'IMAGE' as const : 'ANIMATION' as const
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
      const yielded = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
      expect(yielded.status).toBe('RETRY_WAIT')
      expect(yielded.attempt).toBe(claimed.attempt - 1)
      expect(yielded.errorCode).toBeNull()
      expect(yielded.error).toBeNull()
      expect(await client().systemJobDiagnosticReport.count({ where: { jobId } })).toBe(0)
      expect(await client().systemJobEvent.findFirstOrThrow({
        where: { jobId, type: 'job.retry_scheduled' }, orderBy: { id: 'desc' }
      })).toMatchObject({ level: 'INFO', data: { reason: 'SCHEDULING_YIELD' } })
      expect(await client().imageAnimationMetadata.count({ where: { image: { path: { startsWith: fixturePrefix } }, status: 'READY' } })).toBe(10)
      expect(await repository.claim(`${prefix}-worker`, capability)).toBeNull()
      await expect(repository.withFencedMutationTransaction(fence(claimed), async (tx) => {
        await (tx as Prisma.TransactionClient).imageAnimationMetadata.create({
          data: { imageId: unpublished.id, status: 'PENDING' }
        })
      })).rejects.toThrow()
      expect(await client().imageAnimationMetadata.findUnique({ where: { imageId: unpublished.id } })).toBeNull()

      clock.set(new Date(clock.now().getTime() + 5_001))
      const second = await repository.claim(`${prefix}-worker`, capability)
      expect(second?.id).toBe(jobId)
      expect(second!.executionToken).not.toBe(claimed.executionToken)
      expect(second!.attempt).toBe(claimed.attempt)
      await executeAnimationDurationProbe(context(repository, second!), {
        database: client(), scanRoot: root, now: () => clock.now()
      })
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
      expect(await client().imageAnimationMetadata.count({ where: { image: { path: { startsWith: fixturePrefix } }, status: 'READY' } })).toBe(11)

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
        data: Array.from({ length: 12 }, (_, index) => ({ path: `${fixturePrefix}${index}.webp` }))
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
      expect(checkpoint.afterImageId).toBe(0)
    } finally {
      await client().image.deleteMany({ where: { path: { startsWith: fixturePrefix } } })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records a changing first source as transient failure and still publishes the next file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-duration-changing-'))
    const fixturePrefix = `${prefix}/changing/`
    try {
      await mkdir(path.join(root, prefix, 'changing'), { recursive: true })
      await client().image.createMany({ data: [
        { path: `${fixturePrefix}a.webp` }, { path: `${fixturePrefix}b.webp` }
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
      const image = await client().image.create({ data: { path: `${fixturePrefix}item.webp` } })
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
