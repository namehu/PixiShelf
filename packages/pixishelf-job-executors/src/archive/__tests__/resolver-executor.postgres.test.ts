import { randomUUID } from 'node:crypto'
import type { WorkerCapability } from '@pixishelf/job-contracts'
import { Prisma, PrismaClient } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeArchiveResolveItem } from '../resolver-executor.js'
import type { ArchiveProvider, ResolvedArchive } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const testPrefix = `archive-resolver-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }
]
const resolved: ResolvedArchive = {
  providerKey: 'test',
  externalId: 'gallery-1',
  canonicalUrl: 'https://example.test/g/gallery-1',
  locator: { id: 'gallery-1' },
  title: 'Resolved title',
  titleAliases: [],
  description: null,
  category: null,
  uploader: null,
  thumbnailUrl: null,
  postedAt: null,
  tags: [],
  relationships: [],
  media: [{ index: 0, sourcePageUrl: 'https://example.test/page/1', locator: {}, expectedFilename: '0001' }],
  normalizedMetadata: { title: 'Resolved title' },
  rawMetadata: { id: 'gallery-1' },
  warnings: [],
  creatorBucket: '_unknown'
}

describePostgres('archive resolver PostgreSQL integration', () => {
  beforeEach(async () => {
    await db().archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
    await db().systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveResolveQueueControl.update({
      where: { id: 'archive-resolve' },
      data: { paused: false, pausedAt: null, pausedBy: null }
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
    await prisma.systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.$disconnect()
  })

  it('atomically commits READY intake state with COMPLETED job settlement', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    const repository = createRepository(clock)
    const claimed = await repository.claim('archive-resolver-success', capabilities)
    expect(claimed?.id).toBe(jobId)

    await executeArchiveResolveItem(executionContext(repository, claimed!), {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now()
    })

    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, resolutionKind: true, resolvedTitle: true }
      })
    ).toEqual({ status: 'READY', resolutionKind: 'NEW', resolvedTitle: 'Resolved title' })
    expect(
      await db().systemJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, result: true } })
    ).toMatchObject({ status: 'COMPLETED', result: { intakeItemId: itemId, resolutionKind: 'NEW' } })
  })

  it('atomically marks a different submitted URL with the same resolved identity as DUPLICATE', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const existingSubmissionId = `${testPrefix}-existing-submission-${randomUUID()}`
    const existingItemId = `${testPrefix}-existing-item-${randomUUID()}`
    await db().archiveIntakeSubmission.create({
      data: {
        id: existingSubmissionId,
        idempotencyKey: existingSubmissionId,
        requestHash: '0'.repeat(64),
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            id: existingItemId,
            submittedUrl: 'https://example.test/alternate/gallery-1',
            normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '1'),
            status: 'READY',
            providerKey: resolved.providerKey,
            externalId: resolved.externalId,
            canonicalUrl: resolved.canonicalUrl,
            resolvedTitle: resolved.title,
            pageCount: resolved.media.length,
            resolvedSnapshot: JSON.parse(JSON.stringify(resolved)) as Prisma.InputJsonValue,
            metadataHash: 'a'.repeat(64),
            resolutionKind: 'NEW',
            resolvedAt: clock.now(),
            expiresAt: new Date(clock.now().getTime() + 60_000),
            finishedAt: clock.now(),
            createdAt: clock.now(),
            updatedAt: clock.now()
          }
        }
      }
    })
    const { jobId, itemId } = await seedResolverItem(clock.now())
    const repository = createRepository(clock)
    const claimed = (await repository.claim('archive-resolver-duplicate', capabilities))!

    await executeArchiveResolveItem(executionContext(repository, claimed), {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now()
    })

    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, resolutionKind: true, duplicateOfItemId: true }
      })
    ).toEqual({
      status: 'DUPLICATE',
      resolutionKind: 'DUPLICATE_IDENTITY',
      duplicateOfItemId: existingItemId
    })
    expect((await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
  })

  it('rolls back stale resolver finalization after lease recovery moves the intake item to RETRY_WAIT', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    const repository = createRepository(clock, 1_000)
    const claimed = (await repository.claim('archive-resolver-stale', capabilities))!
    let finishResolve: ((value: ResolvedArchive) => void) | undefined
    const resolving = new Promise<ResolvedArchive>((resolve) => {
      finishResolve = resolve
    })
    const execution = executeArchiveResolveItem(executionContext(repository, claimed), {
      database: db(),
      providers: providerRegistry(vi.fn(() => resolving)),
      now: () => clock.now()
    })
    await vi.waitFor(async () => {
      expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('RESOLVING')
    })

    clock.advance(1_001)
    await expect(repository.recoverExpiredExecution('ARCHIVE_RESOLVE')).resolves.toMatchObject({
      jobId,
      status: 'RETRY_WAIT'
    })
    finishResolve?.(resolved)

    await expect(execution).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, errorCode: true }
      })
    ).toEqual({ status: 'RETRY_WAIT', errorCode: 'WORKER_LEASE_EXPIRED' })
  })
})

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}

function createRepository(clock: MutableQueueClock, leaseDurationMs = 60_000) {
  return new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock,
    leaseDurationMs,
    transactionMaxWaitMs: Math.min(15_000, Math.max(100, Math.floor(leaseDurationMs / 4))),
    transactionTimeoutMs: Math.min(20_000, leaseDurationMs - 1)
  })
}

async function seedResolverItem(now: Date) {
  const jobId = `${testPrefix}-job-${randomUUID()}`
  const itemId = `${testPrefix}-item-${randomUUID()}`
  const submissionId = `${testPrefix}-submission-${randomUUID()}`
  await db().systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: 1,
      status: 'PENDING',
      triggerSource: 'SYSTEM',
      payload: { intakeItemId: itemId },
      queuePriority: 100,
      effectivePriority: 100,
      availableAt: now,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now
    }
  })
  await db().archiveIntakeSubmission.create({
    data: {
      id: submissionId,
      idempotencyKey: submissionId,
      requestHash: '0'.repeat(64),
      rawCount: 1,
      acceptedCount: 1,
      items: {
        create: {
          id: itemId,
          submittedUrl: 'https://example.test/g/gallery-1',
          normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          currentSystemJobId: jobId,
          createdAt: now,
          updatedAt: now
        }
      }
    }
  })
  return { jobId, itemId }
}

function executionContext(repository: PostgresQueueRepository, job: ClaimedJob) {
  const fence = {
    jobId: job.id,
    workerId: job.workerId,
    executionToken: job.executionToken,
    attempt: job.attempt
  }
  const context: ExecutionContext<{ intakeItemId: string }, EnqueuedChildJob> = {
    job,
    payload: { intakeItemId: String((job.payload as { intakeItemId: string }).intakeItemId) },
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('resolver integration test does not enqueue child jobs')
    },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return context
}

function providerRegistry(resolve: ArchiveProvider['resolve']) {
  const provider: ArchiveProvider = {
    key: 'test',
    requestGovernance: 'PER_REQUEST',
    accepts: () => true,
    resolve,
    openMedia: vi.fn()
  }
  return { get: () => provider, getForUrl: () => provider }
}
