import { randomUUID } from 'node:crypto'
import type { WorkerCapability } from '@pixishelf/job-contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../../pixishelf-db/src/index.js'
import { MutableQueueClock } from '../queue-clock.js'
import {
  GLOBAL_BACKGROUND_WORKER_RESOURCE,
  JobExecutionFenceError,
  PostgresQueueRepository,
  type ClaimedJob,
  type QueueDatabase
} from '../queue-repository.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const testPrefix = `queue-kernel-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'SCAN', definitionVersions: [1] },
  { jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [1, 2] }
]
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null

describePostgres('PostgresQueueRepository integration', () => {
  const clock = new MutableQueueClock(new Date('2026-08-13T18:00:00.000Z'))

  beforeEach(async () => {
    clock.set(new Date('2026-08-13T18:00:00.000Z'))
    await client().jobResourceLease.deleteMany({
      where: { ownerJobId: { startsWith: testPrefix } }
    })
    await client().systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().systemJob.deleteMany({ where: { idempotencyKey: { startsWith: testPrefix } } })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.jobResourceLease.deleteMany({
      where: { ownerJobId: { startsWith: testPrefix } }
    })
    await prisma.systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.systemJob.deleteMany({ where: { idempotencyKey: { startsWith: testPrefix } } })
    await prisma.$disconnect()
  })

  it('allows exactly one winner across ten concurrent claims', async () => {
    await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => repository.claim(`queue-kernel-worker-${index}`, capabilities))
    )
    const winners = results.filter((result): result is ClaimedJob => result !== null)

    expect(winners).toHaveLength(1)
    expect(
      await client().systemJob.count({
        where: { id: { startsWith: testPrefix }, status: 'RUNNING' }
      })
    ).toBe(1)
    expect(
      await client().jobResourceLease.count({
        where: { resourceKey: GLOBAL_BACKGROUND_WORKER_RESOURCE }
      })
    ).toBe(1)

    await repository.complete(fence(winners[0]!))
  })

  it('sorts supported candidates and never claims an unsupported type or definition', async () => {
    const unsupportedType = await seedJob({
      type: 'ARCHIVE_IMPORT',
      effectivePriority: 0,
      createdAt: new Date('2026-08-13T17:00:00.000Z')
    })
    const unsupportedVersion = await seedJob({
      type: 'SCAN',
      definitionVersion: 2,
      effectivePriority: 1,
      createdAt: new Date('2026-08-13T17:01:00.000Z')
    })
    const later = await seedJob({
      type: 'SCAN',
      effectivePriority: 20,
      createdAt: new Date('2026-08-13T17:03:00.000Z')
    })
    const winner = await seedJob({
      type: 'VIDEO_MEDIA_PROBE',
      effectivePriority: 10,
      createdAt: new Date('2026-08-13T17:04:00.000Z')
    })
    const repository = createRepository(clock)

    expect(await repository.claim('queue-kernel-empty-capabilities', [])).toBeNull()
    const claimed = await repository.claim('queue-kernel-capability-worker', capabilities)

    expect(claimed?.id).toBe(winner)
    expect(
      await client().systemJob.findMany({
        where: { id: { in: [unsupportedType, unsupportedVersion, later] } },
        select: { status: true },
        orderBy: { id: 'asc' }
      })
    ).toEqual([{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'PENDING' }])
    await repository.complete(fence(claimed!))
  })

  it('orders equal-priority candidates by availableAt before creation order', async () => {
    const createdAt = new Date('2026-08-13T17:00:00.000Z')
    await seedJob({
      type: 'SCAN',
      effectivePriority: 10,
      createdAt,
      availableAt: new Date('2026-08-13T17:59:00.000Z')
    })
    const availableFirst = await seedJob({
      type: 'SCAN',
      effectivePriority: 10,
      createdAt,
      availableAt: new Date('2026-08-13T17:30:00.000Z')
    })

    const claimed = await createRepository(clock).claim('queue-kernel-available-order-worker', capabilities)

    expect(claimed?.id).toBe(availableFirst)
    await createRepository(clock).complete(fence(claimed!))
  })

  it('ages only a bounded priority band and prevents an old job from starving', async () => {
    const oldJob = await seedJob({
      type: 'SCAN',
      effectivePriority: 20,
      createdAt: new Date('2026-08-13T06:00:00.000Z')
    })
    await seedJob({
      type: 'SCAN',
      effectivePriority: 5,
      createdAt: new Date('2026-08-13T17:59:00.000Z')
    })
    const repository = createRepository(clock)

    const claimed = await repository.claim('queue-kernel-aging-worker', capabilities)

    expect(claimed).toMatchObject({ id: oldJob, effectivePriority: 0 })
    await repository.complete(fence(claimed!))
  })

  it('ages an old candidate even when more than one bounded batch of fresh high-priority jobs exists', async () => {
    const oldJob = await seedJob({
      type: 'SCAN',
      effectivePriority: 99,
      createdAt: new Date('2026-08-01T00:00:00.000Z')
    })
    const createdAt = new Date('2026-08-13T17:59:59.000Z')
    await client().systemJob.createMany({
      data: Array.from({ length: 205 }, () => ({
        id: `${testPrefix}-${randomUUID()}`,
        type: 'SCAN',
        definitionVersion: 1,
        status: 'PENDING' as const,
        triggerSource: 'MANUAL' as const,
        queuePriority: 1,
        effectivePriority: 1,
        availableAt: createdAt,
        maxAttempts: 3,
        createdAt,
        updatedAt: createdAt
      }))
    })
    const repository = createRepository(clock)

    const claimed = await repository.claim('queue-kernel-deep-aging-worker', capabilities)

    expect(claimed).toMatchObject({ id: oldJob, effectivePriority: 0 })
    await repository.complete(fence(claimed!))
  })

  it('never ages an automatic SYSTEM child below priority 100', async () => {
    const child = await seedJob({
      type: 'SCAN',
      triggerSource: 'SYSTEM',
      effectivePriority: 150,
      createdAt: new Date('2026-08-01T00:00:00.000Z')
    })
    const repository = createRepository(clock)

    const claimed = await repository.claim('queue-kernel-aging-floor-worker', capabilities)

    expect(claimed).toMatchObject({ id: child, effectivePriority: 100 })
    await repository.complete(fence(claimed!))
  })

  it('recovers an expired lease and rejects a stale execution token', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const first = await repository.claim('queue-kernel-stale-worker', capabilities)
    expect(first?.id).toBe(jobId)

    clock.advance(1_001)
    const recovered = await repository.recoverExpiredExecution()
    expect(recovered).toMatchObject({ jobId, status: 'RETRY_WAIT', attempt: 1 })
    const second = await repository.claim('queue-kernel-current-worker', capabilities)
    expect(second).toMatchObject({ id: jobId, attempt: 2 })

    await expect(repository.heartbeat(fence(first!))).rejects.toBeInstanceOf(JobExecutionFenceError)
    await expect(
      repository.updateProgress({
        ...fence(first!),
        progress: 50,
        stage: 'stale-stage'
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    await expect(repository.complete(fence(first!))).rejects.toBeInstanceOf(JobExecutionFenceError)
    await repository.complete(fence(second!))
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
    expect(
      await client().systemJobEvent.count({
        where: { jobId, type: { in: ['worker.lease_recovered', 'job.retry_scheduled'] } }
      })
    ).toBe(2)
  })

  it('persists progress and stage events only under the active execution fence', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-progress-worker', capabilities))!

    await repository.updateProgress({
      ...fence(claimed),
      progress: 35,
      stage: 'discovering',
      message: 'Discovered the first batch',
      data: { batch: 1 }
    })

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { progress: true, stage: true, message: true }
      })
    ).toEqual({ progress: 35, stage: 'discovering', message: 'Discovered the first batch' })
    expect(
      await client().systemJobEvent.findFirstOrThrow({
        where: { jobId, type: 'job.stage_changed' },
        select: { progress: true, stage: true, data: true }
      })
    ).toEqual({
      progress: 35,
      stage: 'discovering',
      data: { progress: 35, stage: 'discovering', data: { batch: 1 } }
    })
    await repository.complete(fence(claimed))
  })

  it('redacts event messages and nested event data before persistence', async () => {
    await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-redaction-worker', capabilities))!

    await repository.updateProgress({
      ...fence(claimed),
      progress: 40,
      message: 'Bearer event-message-secret at postgresql://queue-user:queue-password@postgres/pixishelf',
      data: {
        nested: {
          apiKey: 'nested-api-key-secret',
          note: 'dsn=postgresql://nested-user:nested-password@postgres/pixishelf'
        },
        authorization: 'Bearer nested-bearer-secret'
      }
    })

    const event = await client().systemJobEvent.findFirstOrThrow({
      where: { jobId: claimed.id, type: 'job.progress' },
      select: { message: true, data: true }
    })
    const persisted = JSON.stringify(event)
    expect(persisted).toContain('[REDACTED]')
    for (const secret of [
      'event-message-secret',
      'queue-user',
      'queue-password',
      'nested-api-key-secret',
      'nested-user',
      'nested-password',
      'nested-bearer-secret'
    ]) {
      expect(persisted).not.toContain(secret)
    }

    await repository.complete(fence(claimed))
  })

  it('validates and safely reuses idempotent child jobs under the parent fence', async () => {
    await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const parent = (await repository.claim('queue-kernel-parent-worker', capabilities))!
    const parentFence = fence(parent)
    const idempotencyKey = `${testPrefix}-child`
    const conflictMessage = 'conflicts with different job definition, payload, schedule, attempts, or parent semantics'

    const first = await repository.enqueueChild(parentFence, {
      type: 'VIDEO_MEDIA_PROBE',
      payload: {},
      idempotencyKey
    })
    const second = await repository.enqueueChild(parentFence, {
      type: 'VIDEO_MEDIA_PROBE',
      payload: {},
      idempotencyKey
    })
    clock.advance(1_000)
    const implicitAvailableAtReuse = await repository.enqueueChild(parentFence, {
      type: 'VIDEO_MEDIA_PROBE',
      payload: {},
      idempotencyKey
    })

    expect(first.created).toBe(true)
    expect(second).toEqual({ id: first.id, created: false })
    expect(implicitAvailableAtReuse).toEqual({ id: first.id, created: false })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: first.id },
        select: { parentJobId: true, payload: true, triggerSource: true }
      })
    ).toEqual({
      parentJobId: parent.id,
      payload: { force: false, enqueueMissingPosters: true },
      triggerSource: 'SYSTEM'
    })

    await expect(
      repository.enqueueChild(parentFence, {
        type: 'SCAN',
        payload: {},
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: { force: true },
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        deadlineAt: new Date(clock.now().getTime() + 60_000),
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        queuePriority: 101,
        effectivePriority: 100,
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        queuePriority: 100,
        effectivePriority: 101,
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        maxAttempts: 4,
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        availableAt: clock.now(),
        idempotencyKey
      })
    ).rejects.toThrow(conflictMessage)
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_POSTER_GENERATION',
        payload: { imageId: -1, relativePath: '../unsafe' }
      })
    ).rejects.toThrow()
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'SCAN',
        payload: {},
        availableAt: clock.now(),
        deadlineAt: clock.now()
      })
    ).rejects.toThrow('deadlineAt must be later')
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        queuePriority: 99,
        effectivePriority: 100
      })
    ).rejects.toThrow('queuePriority and effectivePriority must be in the 100-999 band')
    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        queuePriority: 100,
        effectivePriority: 1_000
      })
    ).rejects.toThrow('queuePriority and effectivePriority must be in the 100-999 band')

    await repository.complete(parentFence)
  })

  it('rejects an idempotency key reused by a different parent with the same definition and payload', async () => {
    const parentId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const otherParentId = await seedJob({ type: 'SCAN', effectivePriority: 20 })
    const repository = createRepository(clock)
    const parent = (await repository.claim('queue-kernel-parent-conflict-worker', capabilities))!
    expect(parent.id).toBe(parentId)
    const idempotencyKey = `${testPrefix}-other-parent-child`
    await client().systemJob.create({
      data: {
        id: `${testPrefix}-${randomUUID()}`,
        type: 'VIDEO_MEDIA_PROBE',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        idempotencyKey,
        payload: { force: false, enqueueMissingPosters: true },
        parentJobId: otherParentId,
        queuePriority: 100,
        effectivePriority: 100,
        availableAt: clock.now(),
        maxAttempts: 3,
        createdAt: clock.now(),
        updatedAt: clock.now()
      }
    })

    await expect(
      repository.enqueueChild(fence(parent), {
        type: 'VIDEO_MEDIA_PROBE',
        payload: {},
        idempotencyKey
      })
    ).rejects.toThrow('conflicts with different job definition, payload, schedule, attempts, or parent semantics')

    await repository.complete(fence(parent))
  })

  it.each(['complete', 'fail', 'retry', 'skip'] as const)(
    'gives cancellation priority over a concurrent %s outcome',
    async (outcome) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-cancel-${outcome}`, capabilities))!

      expect(await repository.requestCancellation(jobId)).toEqual({ jobId, status: 'CANCELLING' })
      const ownedFence = fence(claimed)
      const operation =
        outcome === 'complete'
          ? repository.complete(ownedFence)
          : outcome === 'fail'
            ? repository.fail({ ...ownedFence, errorCode: 'TEST', error: 'must not win' })
            : outcome === 'retry'
              ? repository.retry({
                  ...ownedFence,
                  availableAt: new Date(clock.now().getTime() + 1_000),
                  errorCode: 'TEST',
                  error: 'must not win'
                })
              : repository.skip({ ...ownedFence, reason: 'PRECONDITION_NOT_MET' })

      await expect(operation).rejects.toBeInstanceOf(JobExecutionFenceError)
      await repository.cancel(ownedFence)
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('CANCELLED')
    }
  )

  it.each(['complete', 'fail', 'retry', 'skip'] as const)(
    'gives cancellation priority over a transaction-bound %s finalizer',
    async (outcome) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-tx-cancel-${outcome}`, capabilities))!
      const ownedFence = fence(claimed)
      expect(await repository.requestCancellation(jobId)).toEqual({ jobId, status: 'CANCELLING' })

      await expect(
        repository.withFencedExecutionTransaction(ownedFence, async (scope) => {
          await scope.transaction.$executeRawUnsafe(
            `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
            jobId,
            'must roll back with the rejected finalizer'
          )
          if (outcome === 'complete') await scope.complete()
          if (outcome === 'fail') await scope.fail({ errorCode: 'TEST', error: 'must not win' })
          if (outcome === 'retry') {
            await scope.retry({
              availableAt: new Date(clock.now().getTime() + 1_000),
              errorCode: 'TEST',
              error: 'must not win'
            })
          }
          if (outcome === 'skip') await scope.skip({ reason: 'PRECONDITION_NOT_MET' })
        })
      ).rejects.toBeInstanceOf(JobExecutionFenceError)
      expect(
        await client().systemJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { status: true, message: true }
        })
      ).toEqual({ status: 'CANCELLING', message: null })
      await repository.cancel(ownedFence)
    }
  )

  it.each(['complete', 'fail', 'retry', 'skip'] as const)(
    'gives pause priority over a concurrent %s outcome',
    async (outcome) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-pause-${outcome}`, capabilities))!
      const ownedFence = fence(claimed)
      await client().systemJob.update({
        where: { id: jobId },
        data: { status: 'PAUSING', pauseRequestedAt: clock.now() }
      })
      const operation =
        outcome === 'complete'
          ? repository.complete(ownedFence)
          : outcome === 'fail'
            ? repository.fail({ ...ownedFence, errorCode: 'TEST', error: 'must not win' })
            : outcome === 'retry'
              ? repository.retry({
                  ...ownedFence,
                  availableAt: new Date(clock.now().getTime() + 1_000),
                  errorCode: 'TEST',
                  error: 'must not win'
                })
              : repository.skip({ ...ownedFence, reason: 'PRECONDITION_NOT_MET' })

      await expect(operation).rejects.toBeInstanceOf(JobExecutionFenceError)
      await repository.pause(ownedFence)
      expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PAUSED')
    }
  )

  it.each(['complete', 'fail', 'retry', 'skip'] as const)(
    'gives pause priority over a transaction-bound %s finalizer',
    async (outcome) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-tx-pause-${outcome}`, capabilities))!
      const ownedFence = fence(claimed)
      await client().systemJob.update({
        where: { id: jobId },
        data: { status: 'PAUSING', pauseRequestedAt: clock.now() }
      })

      await expect(
        repository.withFencedExecutionTransaction(ownedFence, async (scope) => {
          await scope.transaction.$executeRawUnsafe(
            `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
            jobId,
            'must roll back with the rejected pause race finalizer'
          )
          if (outcome === 'complete') await scope.complete()
          if (outcome === 'fail') await scope.fail({ errorCode: 'TEST', error: 'must not win' })
          if (outcome === 'retry') {
            await scope.retry({
              availableAt: new Date(clock.now().getTime() + 1_000),
              errorCode: 'TEST',
              error: 'must not win'
            })
          }
          if (outcome === 'skip') await scope.skip({ reason: 'PRECONDITION_NOT_MET' })
        })
      ).rejects.toBeInstanceOf(JobExecutionFenceError)
      expect(
        await client().systemJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { status: true, message: true }
        })
      ).toEqual({ status: 'PAUSING', message: null })
      await repository.pause(ownedFence)
    }
  )

  it.each(['release', 'pause', 'retry'] as const)(
    'clears finishedAt for the non-terminal %s transition',
    async (transition) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-finished-at-${transition}`, capabilities))!
      const ownedFence = fence(claimed)

      if (transition === 'release') await repository.release(ownedFence)
      if (transition === 'pause') {
        await client().systemJob.update({ where: { id: jobId }, data: { status: 'PAUSING' } })
        await repository.pause(ownedFence)
      }
      if (transition === 'retry') {
        await repository.retry({
          ...ownedFence,
          availableAt: new Date(clock.now().getTime() + 1_000),
          errorCode: 'TRANSIENT',
          error: 'retry later'
        })
      }

      expect(
        await client().systemJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { status: true, finishedAt: true }
        })
      ).toEqual({
        status: transition === 'release' ? 'PENDING' : transition === 'pause' ? 'PAUSED' : 'RETRY_WAIT',
        finishedAt: null
      })
    }
  )

  it('cleans a dirty global lease when a queued job is cancelled directly', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const executionToken = randomUUID()
    const expiresAt = new Date(clock.now().getTime() + 60_000)
    await client().systemJob.update({
      where: { id: jobId },
      data: {
        workerId: 'queue-kernel-dirty-worker',
        leaseToken: executionToken,
        leaseExpiresAt: expiresAt
      }
    })
    await client().jobResourceLease.create({
      data: {
        resourceKey: GLOBAL_BACKGROUND_WORKER_RESOURCE,
        ownerJobId: jobId,
        workerId: 'queue-kernel-dirty-worker',
        leaseToken: executionToken,
        expiresAt,
        heartbeatAt: clock.now(),
        updatedAt: clock.now()
      }
    })

    expect(await createRepository(clock).requestCancellation(jobId)).toEqual({
      jobId,
      status: 'CANCELLED'
    })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { workerId: true, leaseToken: true, leaseExpiresAt: true }
      })
    ).toEqual({ workerId: null, leaseToken: null, leaseExpiresAt: null })
    expect(
      await client().jobResourceLease.count({
        where: { resourceKey: GLOBAL_BACKGROUND_WORKER_RESOURCE }
      })
    ).toBe(0)
  })

  it.each([
    ['PAUSING', 'PAUSED', 'job.paused'],
    ['CANCELLING', 'CANCELLED', 'job.cancelled']
  ] as const)('honors %s control state during expired lease recovery', async (from, to, eventType) => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock, 1_000)
    await repository.claim(`queue-kernel-control-${from}`, capabilities)
    await client().systemJob.update({ where: { id: jobId }, data: { status: from } })

    clock.advance(1_001)
    expect(await repository.recoverExpiredExecution()).toMatchObject({ jobId, status: to })
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(to)
    expect(await client().systemJobEvent.count({ where: { jobId, type: eventType } })).toBe(1)
  })

  it('commits a domain mutation and terminal transition in one fenced transaction', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-domain-worker', capabilities))!

    await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      await scope.transaction.$executeRawUnsafe(
        `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
        jobId,
        'domain mutation committed'
      )
      await scope.complete({ result: { published: true } })
    })

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, result: true }
      })
    ).toEqual({
      status: 'COMPLETED',
      message: 'domain mutation committed',
      result: { published: true }
    })
  })

  it('rolls back domain changes when a fenced transaction omits its finalizer', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-rollback-worker', capabilities))!

    await expect(
      repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'must roll back'
        )
      })
    ).rejects.toThrow('must call exactly one terminal finalizer')

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true }
      })
    ).toEqual({ status: 'RUNNING', message: null })
    await repository.complete(fence(claimed))
  })
})

function client(): PrismaClient {
  if (!prisma) {
    throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  }
  return prisma
}

function createRepository(clock: MutableQueueClock, leaseDurationMs = 60_000) {
  return new PostgresQueueRepository(client() as unknown as QueueDatabase, {
    clock,
    leaseDurationMs,
    transactionMaxWaitMs: 15_000,
    transactionTimeoutMs: 20_000
  })
}

function fence(job: ClaimedJob) {
  return {
    jobId: job.id,
    workerId: job.workerId,
    executionToken: job.executionToken,
    attempt: job.attempt
  }
}

async function seedJob(input: {
  type: string
  definitionVersion?: number
  effectivePriority: number
  maxAttempts?: number
  createdAt?: Date
  availableAt?: Date
  triggerSource?: 'MANUAL' | 'SYSTEM'
}): Promise<string> {
  const id = `${testPrefix}-${randomUUID()}`
  const createdAt = input.createdAt ?? clockDate()
  await client().systemJob.create({
    data: {
      id,
      type: input.type,
      definitionVersion: input.definitionVersion ?? 1,
      status: 'PENDING',
      triggerSource: input.triggerSource ?? 'MANUAL',
      queuePriority: input.effectivePriority,
      effectivePriority: input.effectivePriority,
      availableAt: input.availableAt ?? createdAt,
      maxAttempts: input.maxAttempts ?? 3,
      createdAt,
      updatedAt: createdAt
    }
  })
  return id
}

function clockDate(): Date {
  return new Date('2026-08-13T18:00:00.000Z')
}
