import { randomUUID } from 'node:crypto'
import type { WorkerCapability } from '@pixishelf/job-contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../../pixishelf-db/src/index.js'
import { MutableQueueClock } from '../queue-clock.js'
import {
  ARCHIVE_RESOLVE_LANE_RESOURCE,
  BACKGROUND_WRITER_LANE_RESOURCE,
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
  { jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] },
  { jobType: 'VIDEO_MEDIA_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2] }
]
const resolveCapabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }
]
const uploaderResolveCapabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_UPLOADER_SCAN', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }
]
const archiveWriterCapabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_IMPORT', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] },
  { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null

describePostgres('PostgresQueueRepository integration', () => {
  const clock = new MutableQueueClock(new Date('2026-08-13T18:00:00.000Z'))

  beforeEach(async () => {
    clock.set(new Date('2026-08-13T18:00:00.000Z'))
    await client().archiveUploaderScanItem.deleteMany({ where: { run: { id: { startsWith: testPrefix } } } })
    await client().archiveUploaderScanRun.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().archiveUploaderSource.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().jobResourceLease.deleteMany({
      where: { ownerJobId: { startsWith: testPrefix } }
    })
    await client().systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await client().systemJob.deleteMany({ where: { idempotencyKey: { startsWith: testPrefix } } })
    await client().archiveResolveQueueControl.update({
      where: { id: 'archive-resolve' },
      data: { paused: false, pausedAt: null, pausedBy: null }
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveUploaderScanItem.deleteMany({ where: { run: { id: { startsWith: testPrefix } } } })
    await prisma.archiveUploaderScanRun.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
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

  it('allows one resolver and one writer concurrently while preserving resolver FIFO and lane serialization', async () => {
    const writerJobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const olderResolveJobId = await seedJob({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM',
      createdAt: new Date('2026-08-13T17:00:00.000Z')
    })
    const fifoWinnerJobId = await seedJob({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM',
      createdAt: new Date('2026-08-13T17:30:00.000Z')
    })
    const submissionId = `${testPrefix}-submission-${randomUUID()}`
    await client().archiveIntakeSubmission.create({
      data: {
        id: submissionId,
        idempotencyKey: submissionId,
        requestHash: '0'.repeat(64),
        rawCount: 2,
        acceptedCount: 2,
        items: {
          create: [
            {
              id: `${testPrefix}-intake-first-${randomUUID()}`,
              submittedUrl: 'https://e-hentai.org/g/1/token/',
              normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
              currentSystemJobId: fifoWinnerJobId
            },
            {
              id: `${testPrefix}-intake-second-${randomUUID()}`,
              submittedUrl: 'https://e-hentai.org/g/2/token/',
              normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
              currentSystemJobId: olderResolveJobId
            }
          ]
        }
      }
    })
    const repository = createRepository(clock)

    const [writer, resolver] = await Promise.all([
      repository.claim('queue-kernel-writer-lane', capabilities),
      repository.claim('queue-kernel-resolver-lane', resolveCapabilities)
    ])

    expect(writer?.id).toBe(writerJobId)
    expect(resolver?.id).toBe(fifoWinnerJobId)
    expect(await repository.claim('queue-kernel-second-resolver', resolveCapabilities)).toBeNull()
    expect(
      await client().jobResourceLease.findMany({
        where: { resourceKey: { in: [ARCHIVE_RESOLVE_LANE_RESOURCE, BACKGROUND_WRITER_LANE_RESOURCE] } },
        orderBy: { resourceKey: 'asc' },
        select: { resourceKey: true }
      })
    ).toHaveLength(2)

    await Promise.all([repository.complete(fence(writer!)), repository.complete(fence(resolver!))])
  })

  it('allows exactly one resolver winner across ten concurrent claims', async () => {
    const resolveJobId = await seedJob({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM'
    })
    const submissionId = `${testPrefix}-contention-submission-${randomUUID()}`
    await client().archiveIntakeSubmission.create({
      data: {
        id: submissionId,
        idempotencyKey: submissionId,
        requestHash: '0'.repeat(64),
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            id: `${testPrefix}-contention-item-${randomUUID()}`,
            submittedUrl: 'https://e-hentai.org/g/4/token/',
            normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
            currentSystemJobId: resolveJobId
          }
        }
      }
    })
    const repository = createRepository(clock)

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.claim(`queue-kernel-resolver-contention-${index}`, resolveCapabilities)
      )
    )
    const winners = results.filter((result): result is ClaimedJob => result !== null)

    expect(winners).toHaveLength(1)
    expect(winners[0]?.id).toBe(resolveJobId)
    await repository.complete(fence(winners[0]!))
  })

  it('rejects persisted job type and execution lane mismatches', async () => {
    await expect(
      client().systemJob.create({
        data: {
          id: `${testPrefix}-invalid-lane-${randomUUID()}`,
          type: 'ARCHIVE_RESOLVE_ITEM',
          executionLane: 'BACKGROUND_WRITER',
          definitionVersion: 1,
          status: 'PENDING',
          triggerSource: 'SYSTEM',
          queuePriority: 100,
          effectivePriority: 100,
          availableAt: clock.now()
        }
      })
    ).rejects.toThrow()
  })

  it('does not claim the resolver lane while its durable queue control is paused', async () => {
    await seedJob({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM'
    })
    await client().archiveResolveQueueControl.update({
      where: { id: 'archive-resolve' },
      data: { paused: true, pausedAt: clockDate(), pausedBy: 'test' }
    })

    await expect(createRepository(clock).claim('queue-kernel-paused-resolver', resolveCapabilities)).resolves.toBeNull()
  })

  it.each([
    [2, 'RETRY_WAIT'],
    [1, 'FAILED']
  ] as const)('recovers an expired resolver lease into %s-attempt domain state %s', async (maxAttempts, status) => {
    const jobId = await seedJob({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM',
      maxAttempts
    })
    const submissionId = `${testPrefix}-recovery-submission-${randomUUID()}`
    const itemId = `${testPrefix}-recovery-item-${randomUUID()}`
    await client().archiveIntakeSubmission.create({
      data: {
        id: submissionId,
        idempotencyKey: submissionId,
        requestHash: '0'.repeat(64),
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            id: itemId,
            submittedUrl: 'https://e-hentai.org/g/3/token/',
            normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
            currentSystemJobId: jobId
          }
        }
      }
    })
    const repository = createRepository(clock, 1_000)
    const claimed = await repository.claim('queue-kernel-resolver-recovery', resolveCapabilities)
    expect(claimed?.id).toBe(jobId)
    await client().archiveIntakeItem.update({ where: { id: itemId }, data: { status: 'RESOLVING' } })
    const queueOrderBefore = (await client().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).queueOrder

    clock.advance(1_001)
    await expect(repository.recoverExpiredExecution('ARCHIVE_RESOLVE')).resolves.toMatchObject({ jobId, status })

    const recovered = await client().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(recovered).toMatchObject({
      status,
      errorCode: 'WORKER_LEASE_EXPIRED',
      retryable: true
    })
    if (status === 'RETRY_WAIT') expect(recovered.queueOrder).toBeGreaterThan(queueOrderBefore)
    else expect(recovered.finishedAt).toEqual(clock.now())
  })

  it('recovers an uploader scan whose lease expires before the executor claims its domain run', async () => {
    const jobId = await seedJob({
      type: 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      effectivePriority: 20,
      maxAttempts: 2
    })
    const sourceId = `${testPrefix}-uploader-source-${randomUUID()}`
    const runId = `${testPrefix}-uploader-run-${randomUUID()}`
    await client().archiveUploaderSource.create({
      data: {
        id: sourceId,
        providerKey: 'e-hentai',
        identityKind: 'UID',
        identityValue: '123',
        normalizedIdentity: '123',
        displayName: 'UID 123',
        incrementalCursor: 'latest-cursor',
        historyCursor: 'history-cursor',
        runs: {
          create: {
            id: runId,
            systemJobId: jobId,
            mode: 'LATEST',
            cursorBefore: 'latest-cursor'
          }
        }
      }
    })
    const repository = createRepository(clock, 1_000)

    await expect(repository.claim('queue-kernel-uploader-recovery', uploaderResolveCapabilities)).resolves.toMatchObject({
      id: jobId
    })
    clock.advance(1_001)
    await expect(repository.recoverExpiredExecution('ARCHIVE_RESOLVE')).resolves.toMatchObject({
      jobId,
      status: 'RETRY_WAIT'
    })

    await expect(client().archiveUploaderScanRun.findUniqueOrThrow({ where: { id: runId } })).resolves.toMatchObject({
      status: 'RETRY_WAIT',
      errorCode: 'WORKER_LEASE_EXPIRED',
      cursorBefore: 'latest-cursor',
      cursorAfter: null
    })
    await expect(client().archiveUploaderSource.findUniqueOrThrow({ where: { id: sourceId } })).resolves.toMatchObject({
      latestSeenExternalId: null,
      incrementalCursor: 'latest-cursor',
      historyCursor: 'history-cursor',
      lastRunId: runId,
      lastErrorCode: 'WORKER_LEASE_EXPIRED'
    })
  })

  it.each([
    [2, 'RETRY_WAIT', 'PENDING', null],
    [1, 'FAILED', 'FAILED', 30]
  ] as const)(
    'recovers an expired archive writer lease with maxAttempts=%i into SystemJob %s and ArchiveImport %s',
    async (maxAttempts, jobStatus, importStatus, retentionDays) => {
      const jobId = await seedJob({
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        effectivePriority: 10,
        maxAttempts
      })
      const archiveImportId = await seedArchiveImport(jobId, { cleanupRequestedAt: null })
      await client().archiveImport.update({
        where: { id: archiveImportId },
        data: { status: 'RUNNING', totalItems: 4, completedItems: 1, failedItems: 1, startedAt: clock.now() }
      })
      await client().archiveImportItem.createMany({
        data: [
          archiveImportItem(archiveImportId, 0, 'COMPLETED'),
          archiveImportItem(archiveImportId, 1, 'FAILED'),
          { ...archiveImportItem(archiveImportId, 2, 'DOWNLOADING'), startedAt: clock.now() },
          archiveImportItem(archiveImportId, 3, 'PENDING')
        ]
      })
      const repository = createRepository(clock, 1_000)
      expect((await repository.claim('queue-kernel-archive-writer-recovery', archiveWriterCapabilities))?.id).toBe(
        jobId
      )

      clock.advance(1_001)
      await expect(repository.recoverExpiredExecution('BACKGROUND_WRITER')).resolves.toMatchObject({
        jobId,
        status: jobStatus
      })
      const recovered = await client().archiveImport.findUniqueOrThrow({ where: { id: archiveImportId } })
      expect(recovered).toMatchObject({
        status: importStatus,
        completedItems: 1,
        failedItems: 1,
        errorCode: 'WORKER_LEASE_EXPIRED',
        errorMessage: 'The archive worker lease expired before completion.'
      })
      expect(recovered.finishedAt).toEqual(retentionDays === null ? null : clock.now())
      expect(recovered.retainUntil).toEqual(
        retentionDays === null ? null : new Date(clock.now().getTime() + retentionDays * 24 * 60 * 60 * 1_000)
      )
      expect(
        await client().archiveImportItem.findMany({
          where: { archiveImportId },
          orderBy: { pageIndex: 'asc' },
          select: { status: true, startedAt: true, finishedAt: true }
        })
      ).toEqual([
        expect.objectContaining({ status: 'COMPLETED' }),
        expect.objectContaining({ status: 'FAILED' }),
        { status: 'PENDING', startedAt: null, finishedAt: null },
        { status: 'PENDING', startedAt: null, finishedAt: null }
      ])
    }
  )

  it.each([
    ['RUNNING', 1, 'FAILED'],
    ['CANCELLING', 3, 'CANCELLED']
  ] as const)(
    'recovers a pre-executor QUEUED intake item from %s into %s',
    async (executingStatus, maxAttempts, recoveredStatus) => {
      const jobId = await seedJob({
        type: 'ARCHIVE_RESOLVE_ITEM',
        executionLane: 'ARCHIVE_RESOLVE',
        effectivePriority: 100,
        triggerSource: 'SYSTEM',
        maxAttempts
      })
      const submissionId = `${testPrefix}-pre-executor-submission-${randomUUID()}`
      const itemId = `${testPrefix}-pre-executor-item-${randomUUID()}`
      await client().archiveIntakeSubmission.create({
        data: {
          id: submissionId,
          idempotencyKey: submissionId,
          requestHash: '0'.repeat(64),
          rawCount: 1,
          acceptedCount: 1,
          items: {
            create: {
              id: itemId,
              submittedUrl: 'https://e-hentai.org/g/5/token/',
              normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
              currentSystemJobId: jobId
            }
          }
        }
      })
      const repository = createRepository(clock, 1_000)
      expect((await repository.claim('queue-kernel-pre-executor-recovery', resolveCapabilities))?.id).toBe(jobId)
      if (executingStatus === 'CANCELLING') {
        await client().systemJob.update({ where: { id: jobId }, data: { status: 'CANCELLING' } })
      }

      clock.advance(1_001)
      await expect(repository.recoverExpiredExecution('ARCHIVE_RESOLVE')).resolves.toMatchObject({
        jobId,
        status: recoveredStatus
      })
      expect(
        await client().archiveIntakeItem.findUniqueOrThrow({
          where: { id: itemId },
          select: { status: true, finishedAt: true }
        })
      ).toEqual({ status: recoveredStatus, finishedAt: clock.now() })
    }
  )

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

  it('lets cleanup maintenance bypass a higher-priority archive import until its cleanup intent clears', async () => {
    const importJobId = await seedJob({ type: 'ARCHIVE_IMPORT', effectivePriority: 10 })
    const archiveImportId = await seedArchiveImport(importJobId, { cleanupRequestedAt: clock.now() })
    const maintenanceJobId = await seedJob({
      type: 'ARCHIVE_MAINTENANCE',
      effectivePriority: 100,
      triggerSource: 'SYSTEM'
    })
    const repository = createRepository(clock)

    const maintenance = await repository.claim('queue-kernel-cleanup-maintenance', archiveWriterCapabilities)

    expect(maintenance?.id).toBe(maintenanceJobId)
    await repository.complete(fence(maintenance!))

    await client().archiveImport.update({
      where: { id: archiveImportId },
      data: { cleanupRequestedAt: null }
    })
    const archiveImport = await repository.claim('queue-kernel-cleanup-import', archiveWriterCapabilities)

    expect(archiveImport?.id).toBe(importJobId)
    await repository.complete(fence(archiveImport!))
  })

  it('still claims an archive import that has no ArchiveImport relation', async () => {
    const importJobId = await seedJob({ type: 'ARCHIVE_IMPORT', effectivePriority: 10 })
    const repository = createRepository(clock)

    const claimed = await repository.claim('queue-kernel-relationless-import', archiveWriterCapabilities)

    expect(claimed?.id).toBe(importJobId)
    await repository.complete(fence(claimed!))
  })

  it('does not apply the archive cleanup gate to another job type', async () => {
    const scanJobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    await seedArchiveImport(scanJobId, { cleanupRequestedAt: clock.now() })
    const repository = createRepository(clock)

    const claimed = await repository.claim('queue-kernel-non-import-cleanup-relation', capabilities)

    expect(claimed?.id).toBe(scanJobId)
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
      payload: { mode: 'INCREMENTAL', force: false },
      triggerSource: 'SYSTEM'
    })

    const keyframeChild = await repository.enqueueChild(parentFence, {
      type: 'VIDEO_KEYFRAME_GENERATION',
      payload: {
        imageId: 42,
        relativePath: 'videos/example.mp4',
        mode: 'MANUAL_INCREMENTAL'
      },
      idempotencyKey: `${testPrefix}-keyframe-child`
    })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: keyframeChild.id },
        select: { targetImageId: true, targetPath: true, mode: true, payload: true }
      })
    ).toEqual({
      targetImageId: 42,
      targetPath: 'videos/example.mp4',
      mode: 'MANUAL_INCREMENTAL',
      payload: {
        imageId: 42,
        relativePath: 'videos/example.mp4',
        mode: 'MANUAL_INCREMENTAL'
      }
    })

    const streamingChild = await repository.enqueueChild(parentFence, {
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      payload: {
        imageId: 43,
        relativePath: 'videos/streaming.mp4',
        mode: 'REMUX_FASTSTART'
      },
      idempotencyKey: `${testPrefix}-streaming-child`
    })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: streamingChild.id },
        select: { targetImageId: true, targetPath: true, mode: true, payload: true }
      })
    ).toEqual({
      targetImageId: 43,
      targetPath: 'videos/streaming.mp4',
      mode: 'REMUX_FASTSTART',
      payload: {
        imageId: 43,
        relativePath: 'videos/streaming.mp4',
        mode: 'REMUX_FASTSTART'
      }
    })

    await expect(
      repository.enqueueChild(parentFence, {
        type: 'SCAN',
        payload: { mode: 'INCREMENTAL' },
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
        payload: { mode: 'INCREMENTAL' },
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
        payload: { force: false },
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

  it('atomically self-pauses a RUNNING domain job with an explicit action-required reason', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-domain-pause-worker', capabilities))!

    await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      await scope.transaction.$executeRawUnsafe(
        `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
        jobId,
        'waiting for an operator decision'
      )
      await scope.pause({
        reason: 'ACTION_REQUIRED',
        message: 'Original media is unavailable',
        data: { decisionCode: 'ORIGINAL_UNAVAILABLE' }
      })
    })

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, pauseRequestedAt: true, finishedAt: true }
      })
    ).toEqual({
      status: 'PAUSED',
      message: 'Original media is unavailable',
      pauseRequestedAt: null,
      finishedAt: null
    })
    const event = await client().systemJobEvent.findFirstOrThrow({
      where: { jobId, type: 'job.paused' },
      orderBy: { id: 'desc' }
    })
    expect(event.data).toEqual({
      reason: 'ACTION_REQUIRED',
      data: { decisionCode: 'ORIGINAL_UNAVAILABLE' }
    })
  })

  it('preserves the business retry attempt across repeated transaction-bound scheduling yields', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock)

    for (let yieldCount = 0; yieldCount < 2; yieldCount += 1) {
      const claimed = (await repository.claim(`queue-kernel-yield-${yieldCount}`, capabilities))!
      expect(claimed.attempt).toBe(1)
      await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.retry({
          availableAt: new Date(clock.now().getTime() + 1_000),
          errorCode: 'RESOURCE_BUSY',
          error: 'writer lane has provider priority',
          preserveAttempt: true
        })
      })
      expect(
        await client().systemJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, attempt: true } })
      ).toEqual({ status: 'RETRY_WAIT', attempt: 0 })
      clock.advance(1_000)
    }

    const firstBusinessAttempt = (await repository.claim('queue-kernel-business-attempt', capabilities))!
    expect(firstBusinessAttempt.attempt).toBe(1)
    await repository.withFencedExecutionTransaction(fence(firstBusinessAttempt), async (scope) => {
      await scope.retry({
        availableAt: new Date(clock.now().getTime() + 1_000),
        errorCode: 'INTERNAL_ERROR',
        error: 'first business failure'
      })
    })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, attempt: true, maxAttempts: true }
      })
    ).toEqual({ status: 'RETRY_WAIT', attempt: 1, maxAttempts: 3 })
  })

  it('gives cancellation priority over a transaction-bound domain self-pause', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-cancel-domain-pause-worker', capabilities))!
    const ownedFence = fence(claimed)
    expect(await repository.requestCancellation(jobId)).toEqual({ jobId, status: 'CANCELLING' })

    await expect(
      repository.withFencedExecutionTransaction(ownedFence, async (scope) => {
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'cancel must roll this pause back'
        )
        await scope.pause({ reason: 'ACTION_REQUIRED', data: { decisionCode: 'ORIGINAL_UNAVAILABLE' } })
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true }
      })
    ).toEqual({ status: 'CANCELLING', message: null })
    await repository.cancel(ownedFence)
  })

  it('rejects a stale-token domain self-pause before its callback can mutate state', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const stale = (await repository.claim('queue-kernel-stale-domain-pause-worker', capabilities))!
    clock.advance(1_001)
    await repository.recoverExpiredExecution()
    const current = (await repository.claim('queue-kernel-current-domain-pause-worker', capabilities))!
    let callbackEntered = false

    await expect(
      repository.withFencedExecutionTransaction(fence(stale), async (scope) => {
        callbackEntered = true
        await scope.pause({ reason: 'ACTION_REQUIRED' })
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(callbackEntered).toBe(false)
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('RUNNING')
    await repository.complete(fence(current))
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
      await scope.complete({ result: { published: true }, message: 'completed atomically' })
    })

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, result: true }
      })
    ).toEqual({
      status: 'COMPLETED',
      message: 'completed atomically',
      result: { published: true }
    })
  })

  it.each([
    ['RUNNING', 'CONTINUE', 'complete', 'COMPLETED'],
    ['PAUSING', 'PAUSE_REQUESTED', 'pause', 'PAUSED'],
    ['CANCELLING', 'CANCEL_REQUESTED', 'cancel', 'CANCELLED']
  ] as const)(
    'exposes the locked %s execution state and atomically applies its %s branch',
    async (executionStatus, controlStatus, operation, terminalStatus) => {
      const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
      const repository = createRepository(clock)
      const claimed = (await repository.claim(`queue-kernel-status-${executionStatus}`, capabilities))!
      if (executionStatus !== 'RUNNING') {
        await client().systemJob.update({
          where: { id: jobId },
          data:
            executionStatus === 'PAUSING'
              ? { status: executionStatus, pauseRequestedAt: clock.now() }
              : { status: executionStatus, cancelRequestedAt: clock.now() }
        })
      }

      await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        expect(scope.executionStatus).toBe(executionStatus)
        expect(scope.controlStatus).toBe(controlStatus)
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          `handled ${executionStatus}`
        )
        if (operation === 'complete') await scope.complete({ message: `settled ${executionStatus}` })
        else if (operation === 'pause') {
          await scope.pause({ reason: 'USER_REQUESTED', message: `settled ${executionStatus}` })
        } else await scope.cancel(`settled ${executionStatus}`)
      })

      expect(
        await client().systemJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { status: true, message: true }
        })
      ).toEqual({ status: terminalStatus, message: `settled ${executionStatus}` })
    }
  )

  it('linearizes a control request after a domain finalization transaction that acquired the job lock first', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-finalization-lock-winner', capabilities))!
    let releaseFinalization!: () => void
    let markFinalizationEntered!: () => void
    const finalizationEntered = new Promise<void>((resolve) => {
      markFinalizationEntered = resolve
    })
    const finalizationGate = new Promise<void>((resolve) => {
      releaseFinalization = resolve
    })

    const finalization = repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      expect(scope.executionStatus).toBe('RUNNING')
      markFinalizationEntered()
      await finalizationGate
      await scope.complete({ result: { winner: 'domain-finalization' } })
    })
    await finalizationEntered

    let cancellationSettled = false
    const cancellation = repository.requestCancellation(jobId).then((result) => {
      cancellationSettled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(cancellationSettled).toBe(false)

    releaseFinalization()
    await finalization
    await expect(cancellation).resolves.toBeNull()
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, result: true }
      })
    ).toEqual({ status: 'COMPLETED', result: { winner: 'domain-finalization' } })
  })

  it('rejects before entering domain code when the lease expires while the initial row lock is waiting', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const claimed = (await repository.claim('queue-kernel-expired-while-waiting', capabilities))!
    let releaseLock!: () => void
    let markLockHeld!: () => void
    const lockHeld = new Promise<void>((resolve) => {
      markLockHeld = resolve
    })
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const holder = client().$transaction(
      async (transaction) => {
        await transaction.$queryRawUnsafe(
          `SELECT "resourceKey"
           FROM "job_resource_leases"
           WHERE "resourceKey" = $1
             AND "ownerJobId" = $2
           FOR UPDATE`,
          GLOBAL_BACKGROUND_WORKER_RESOURCE,
          jobId
        )
        markLockHeld()
        await lockGate
      },
      { maxWait: 5_000, timeout: 10_000 }
    )
    await lockHeld

    let callbackEntered = false
    const finalization = repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      callbackEntered = true
      await scope.complete()
    })
    let observedLockWait = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await client().$queryRawUnsafe<Array<{ waiting: boolean }>>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND wait_event_type = 'Lock'
             AND query LIKE '%job_resource_leases%'
         ) AS "waiting"`
      )
      if (row?.waiting) {
        observedLockWait = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(observedLockWait).toBe(true)
    expect(callbackEntered).toBe(false)

    clock.advance(1_001)
    releaseLock()
    await holder
    await expect(finalization).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(callbackEntered).toBe(false)
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('RUNNING')
    expect(await repository.recoverExpiredExecution()).toMatchObject({ jobId, status: 'RETRY_WAIT' })
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

  it('rolls back the first terminal transition when a fenced transaction finalizes twice', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-double-finalizer-worker', capabilities))!

    await expect(
      repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'must roll back with duplicate finalizer'
        )
        await scope.complete({ result: { published: true } })
        await scope.complete({ result: { published: 'twice' } })
      })
    ).rejects.toThrow('already finalized')

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, result: true }
      })
    ).toEqual({ status: 'RUNNING', message: null, result: null })
    expect(await client().jobResourceLease.count({ where: { ownerJobId: jobId } })).toBe(1)
    await repository.complete(fence(claimed))
  })

  it('rolls back when an executor catches its own duplicate finalizer error', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-caught-double-finalizer-worker', capabilities))!

    await expect(
      repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'caught duplicate must still roll back'
        )
        await scope.complete()
        await scope.fail({ errorCode: 'TEST', error: 'duplicate' }).catch(() => undefined)
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

  it('rolls back a terminal domain transaction that outlives its execution lease', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const claimed = (await repository.claim('queue-kernel-expired-finalizer-worker', capabilities))!

    await expect(
      repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.complete({ result: { published: true } })
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'domain write after terminal intent must roll back'
        )
        clock.advance(1_001)
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, result: true }
      })
    ).toEqual({ status: 'RUNNING', message: null, result: null })
    expect(await repository.recoverExpiredExecution()).toMatchObject({ jobId, status: 'RETRY_WAIT' })
  })

  it('gives pause priority over a transaction-bound cancellation finalizer', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-tx-pause-cancel-worker', capabilities))!
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
          'pause must roll this cancellation publication back'
        )
        await scope.cancel()
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true }
      })
    ).toEqual({ status: 'PAUSING', message: null })
    await repository.pause(ownedFence)
  })

  it.each([
    ['pause', 'PAUSED', 'job.paused'],
    ['release', 'PENDING', 'job.retry_scheduled']
  ] as const)('atomically commits domain state with transaction-bound %s', async (operation, status, eventType) => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim(`queue-kernel-tx-${operation}-worker`, capabilities))!
    const ownedFence = fence(claimed)
    if (operation === 'pause') {
      await client().systemJob.update({
        where: { id: jobId },
        data: { status: 'PAUSING', pauseRequestedAt: clock.now() }
      })
    }

    await repository.withFencedExecutionTransaction(ownedFence, async (scope) => {
      await scope.transaction.$executeRawUnsafe(
        `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
        jobId,
        `${operation} domain state committed`
      )
      if (operation === 'pause') {
        await scope.pause({ reason: 'USER_REQUESTED', message: 'paused atomically' })
      } else await scope.release('released atomically')
    })

    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true, finishedAt: true, workerId: true, leaseToken: true }
      })
    ).toEqual({
      status,
      message: operation === 'pause' ? 'paused atomically' : 'released atomically',
      finishedAt: null,
      workerId: null,
      leaseToken: null
    })
    expect(await client().jobResourceLease.count({ where: { ownerJobId: jobId } })).toBe(0)
    expect(await client().systemJobEvent.count({ where: { jobId, type: eventType } })).toBe(1)
  })

  it('rejects stale-token checkpoint mutation before the callback can write domain state', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const stale = (await repository.claim('queue-kernel-stale-mutation-worker', capabilities))!
    clock.advance(1_001)
    await repository.recoverExpiredExecution()
    const current = (await repository.claim('queue-kernel-current-mutation-worker', capabilities))!
    let callbackEntered = false

    await expect(
      repository.withFencedMutationTransaction(fence(stale), async (transaction) => {
        callbackEntered = true
        await transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'stale checkpoint must not persist'
        )
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)

    expect(callbackEntered).toBe(false)
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).message).toBeNull()
    await repository.complete(fence(current))
  })

  it('gives cancellation priority over a checkpoint mutation and never enters its callback', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-cancel-mutation-worker', capabilities))!
    const ownedFence = fence(claimed)
    await repository.requestCancellation(jobId)
    let callbackEntered = false

    await expect(
      repository.withFencedMutationTransaction(ownedFence, async (transaction) => {
        callbackEntered = true
        await transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'cancelled checkpoint must not persist'
        )
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)

    expect(callbackEntered).toBe(false)
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).message).toBeNull()
    await repository.cancel(ownedFence)
  })

  it('serializes a concurrent cancellation behind an in-flight checkpoint transaction', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10 })
    const repository = createRepository(clock)
    const claimed = (await repository.claim('queue-kernel-cancel-race-worker', capabilities))!
    const ownedFence = fence(claimed)
    let releaseMutation!: () => void
    let markMutationEntered!: () => void
    const mutationEntered = new Promise<void>((resolve) => {
      markMutationEntered = resolve
    })
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })

    const mutation = repository.withFencedMutationTransaction(ownedFence, async (transaction) => {
      await transaction.$executeRawUnsafe(
        `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
        jobId,
        'linearized checkpoint'
      )
      markMutationEntered()
      await mutationGate
    })
    await mutationEntered

    let cancellationSettled = false
    const cancellation = repository.requestCancellation(jobId).then((result) => {
      cancellationSettled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(cancellationSettled).toBe(false)

    releaseMutation()
    await mutation
    await expect(cancellation).resolves.toEqual({ jobId, status: 'CANCELLING' })
    expect(
      await client().systemJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, message: true }
      })
    ).toEqual({ status: 'CANCELLING', message: 'linearized checkpoint' })
    await repository.cancel(ownedFence)
  })

  it('rolls back a checkpoint transaction that outlives its execution lease', async () => {
    const jobId = await seedJob({ type: 'SCAN', effectivePriority: 10, maxAttempts: 3 })
    const repository = createRepository(clock, 1_000)
    const claimed = (await repository.claim('queue-kernel-expired-mutation-worker', capabilities))!

    await expect(
      repository.withFencedMutationTransaction(fence(claimed), async (transaction) => {
        await transaction.$executeRawUnsafe(
          `UPDATE "system_jobs" SET "message" = $2 WHERE "id" = $1`,
          jobId,
          'expired checkpoint must roll back'
        )
        clock.advance(1_001)
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)

    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).message).toBeNull()
    expect(await repository.recoverExpiredExecution()).toMatchObject({ jobId, status: 'RETRY_WAIT' })
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
    transactionMaxWaitMs: Math.min(15_000, Math.max(100, Math.floor(leaseDurationMs / 4))),
    transactionTimeoutMs: Math.min(20_000, leaseDurationMs - 1)
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
  executionLane?: 'ARCHIVE_RESOLVE' | 'BACKGROUND_WRITER'
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
      executionLane: input.executionLane ?? 'BACKGROUND_WRITER',
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

async function seedArchiveImport(systemJobId: string, input: { cleanupRequestedAt: Date | null }): Promise<string> {
  const id = `${testPrefix}-archive-import-${randomUUID()}`
  await client().archiveImport.create({
    data: {
      id,
      systemJobId,
      providerKey: 'queue-kernel-test',
      externalId: id,
      submittedUrl: `https://example.test/${id}`,
      canonicalUrl: `https://example.test/${id}`,
      locator: {},
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: testPrefix,
      stagingPath: `.archive-staging/${id}`,
      cleanupRequestedAt: input.cleanupRequestedAt
    }
  })
  return id
}

function archiveImportItem(
  archiveImportId: string,
  pageIndex: number,
  status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED'
) {
  return {
    id: `${testPrefix}-archive-item-${randomUUID()}`,
    archiveImportId,
    pageIndex,
    sourcePageUrl: `https://example.test/${archiveImportId}/${pageIndex}`,
    locator: {},
    expectedFilename: `${pageIndex}.webp`,
    status
  }
}

function clockDate(): Date {
  return new Date('2026-08-13T18:00:00.000Z')
}
