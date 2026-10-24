import { createArchiveTaskFixture } from './archive-task-service-fixture'
import { requestArchiveStagingCleanup } from '../archive-maintenance-service'
import { PostgresQueueRepository, type QueueDatabase } from '@pixishelf/job-runtime'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, type Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as failurePolicy from '@/services/background-task/job-failure-policy'
import { archiveModule } from '../archive-module'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from '../archive-coordination'
import { archiveRequestFingerprint } from '../archive-bulk-operation'
import { actionArchiveTasksMany, listArchiveTasks } from '../archive-task-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `archive-task-stage2-${randomUUID()}`
const requestedByUserId = `${suitePrefix}-admin`
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
const { seedTask, seedCatalogCopies, projectControlState, projectRetryState, deferred, waitForBlockedTransactions, controlResult } = createArchiveTaskFixture(database, suitePrefix, requestedByUserId)

describePostgres('archive task PostgreSQL contracts', () => {
  beforeAll(async () => database.$connect())
  beforeEach(() => vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true'))

  afterEach(async () => {
    vi.unstubAllEnvs()
    await database.archiveBulkOperation.deleteMany({ where: { requestedByUserId } })
    await database.archiveUploaderSource.deleteMany({
      where: { normalizedIdentity: { startsWith: suitePrefix } }
    })
    const jobs = await database.systemJob.findMany({ where: { requestedByUserId }, select: { id: true } })
    await database.mediaContentPathWrite.deleteMany({ where: { jobId: { startsWith: suitePrefix } } })
    await database.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: suitePrefix } })
    if (jobs.length > 0) {
      await database.archiveImport.deleteMany({ where: { systemJobId: { in: jobs.map((job) => job.id) } } })
      await database.systemJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } })
    }
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId } })
  })

  afterAll(async () => disconnectDatabase(database))

  it.each([
    ['archive', 'RESUME', 'PAUSED'],
    ['bulk', 'RESUME', 'PAUSED'],
    ['archive', 'PAUSE', 'PENDING'],
    ['bulk', 'PAUSE', 'PENDING'],
    ['archive', 'RETRY', 'FAILED'],
    ['bulk', 'RETRY', 'FAILED']
  ] as const)(
    'serializes concurrent %s %s and competing control without deadlock',
    async (firstEntry, action, status) => {
      const task = await seedTask(`lock-${firstEntry}-${action}`, status, status)
      const held = deferred(),
        release = deferred()
      const holder = database.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
          held.resolve()
          await release.promise
        },
        { timeout: 15_000 }
      )
      await held.promise
      const first = controlResult(firstEntry, task, action)
      let second: ReturnType<typeof controlResult> | undefined
      try {
        await waitForBlockedTransactions(1)
        second = controlResult(
          firstEntry === 'archive' ? 'bulk' : 'archive',
          task,
          action === 'RETRY' ? 'RETRY' : 'CANCEL'
        )
        await waitForBlockedTransactions(2)
      } finally {
        release.resolve()
        await holder
      }
      const results = await Promise.all([first, second!])
      expect(results).toEqual(['APPLIED', 'STATE_CONFLICT'])
      const current = await database.archiveImport.findUniqueOrThrow({
        where: { id: task.importId },
        include: { systemJob: true }
      })
      expect(current.status).toBe(action === 'PAUSE' ? 'PAUSED' : 'PENDING')
      expect(current.systemJob.status).toBe(current.status)
      expect(await database.systemJob.count({ where: { requestedByUserId } })).toBe(action === 'RETRY' ? 2 : 1)
      expect(
        await database.systemJobEvent.count({
          where: { jobId: current.systemJobId, type: action === 'PAUSE' ? 'job.paused' : 'job.queued' }
        })
      ).toBe(1)
    }
  )

  it.each(['archive', 'bulk'] as const)(
    'orders %s PAUSE behind a running publication fence before coordination',
    async (entry) => {
      const task = await seedTask(`fence-${entry}`, 'RUNNING', 'RUNNING', { jobType: 'ARCHIVE_PUBLISH' })
      const job = await database.systemJob.findUniqueOrThrow({ where: { id: task.jobId } })
      await database.jobResourceLease.create({
        data: {
          resourceKey: 'lane/background-writer',
          ownerJobId: job.id,
          workerId: job.workerId!,
          leaseToken: job.leaseToken!,
          expiresAt: job.leaseExpiresAt!,
          heartbeatAt: new Date()
        }
      })
      const held = deferred(),
        release = deferred()
      const queue = new PostgresQueueRepository(database as unknown as QueueDatabase)
      const worker = queue.withFencedMutationTransaction<Prisma.TransactionClient>(
        {
          jobId: job.id,
          workerId: job.workerId!,
          executionToken: job.leaseToken!,
          attempt: job.attempt
        },
        async (tx) => {
          held.resolve()
          await release.promise
          await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
        }
      )
      await held.promise
      const control = controlResult(entry, task, 'PAUSE')
      try {
        await waitForBlockedTransactions(1)
        const available = await database.$transaction(async (tx) =>
          tx.$queryRawUnsafe<Array<{ acquired: boolean }>>(
            'SELECT pg_try_advisory_xact_lock($1) AS acquired',
            ARCHIVE_PUBLISH_ADVISORY_LOCK_ID
          )
        )
        expect(available[0]?.acquired).toBe(true)
      } finally {
        release.resolve()
        await worker
      }
      expect(await control).toBe('APPLIED')
      expect(await database.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'PAUSING' })
      expect(await database.systemJobEvent.count({ where: { jobId: job.id, type: 'job.pause_requested' } })).toBe(1)
    }
  )

  it.each(['archive', 'bulk'] as const)(
    'requeues the original unresolved publication through %s retry and preserves its execution binding',
    async (entry) => {
      const task = await seedTask(`publication-${entry}`, 'FAILED', 'FAILED', {
        maxAttempts: 1,
        jobType: 'ARCHIVE_PUBLISH'
      })
      await database.archiveImport.update({ where: { id: task.importId }, data: { phase: 'PUBLISH' } })
      await database.archiveImportExecution.create({
        data: { jobId: task.jobId, archiveImportId: task.importId, phase: 'PUBLISH' }
      })
      const claim = await database.mediaContentPathWrite.create({
        data: {
          directory: {
            create: {
              logicalRoot: 'source-media:v1',
              rootIdentity: suitePrefix,
              relativeDirectory: `${suitePrefix}/publication-${entry}`
            }
          },
          scope: 'DIRECTORY',
          sessionId: `archive-publish:${task.importId}`,
          sessionVersion: 1n,
          writeToken: randomUUID(),
          jobId: task.jobId,
          executionToken: randomUUID(),
          executionAttempt: 1,
          status: 'ACTIVE',
          startedAt: new Date()
        }
      })
      if (entry === 'archive') await archiveModule.requestJobAction(task.jobId, 'RETRY', requestedByUserId)
      else {
        const operation = await actionArchiveTasksMany(
          { idempotencyKey: `${suitePrefix}-publication-retry`, taskIds: [task.importId], action: 'RETRY' },
          requestedByUserId,
          { database }
        )
        expect(operation?.items).toEqual([expect.objectContaining({ result: 'APPLIED', relatedId: task.jobId })])
      }
      expect(await database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).toMatchObject({
        systemJobId: task.jobId,
        phase: 'PUBLISH',
        status: 'PENDING',
        selectedQuality: 'ORIGINAL'
      })
      expect(await database.archiveImportExecution.findUniqueOrThrow({ where: { jobId: task.jobId } })).toMatchObject({
        archiveImportId: task.importId,
        phase: 'PUBLISH'
      })
      expect(await database.systemJob.count({ where: { requestedByUserId } })).toBe(1)
      const queue = new PostgresQueueRepository(database as unknown as QueueDatabase)
      expect(
        await queue.claim(`${suitePrefix}-worker`, [
          { jobType: 'ARCHIVE_PUBLISH', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
        ])
      ).toMatchObject({ id: task.jobId, attempt: 2 })
      expect(await database.mediaContentPathWrite.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(claim)
    }
  )

  it.each(['generic', 'archive', 'bulk', 'cleanup'] as const)(
    'keeps unresolved content recoverable through the %s cancellation entry',
    async (entry) => {
      const task = await seedTask(`content-${entry}`, 'PAUSED', 'PAUSED')
      const claim = await database.mediaContentPathWrite.create({
        data: {
          directory: {
            create: {
              logicalRoot: 'source-media:v1',
              rootIdentity: suitePrefix,
              relativeDirectory: `${suitePrefix}/${entry}`
            }
          },
          scope: 'DIRECTORY',
          sessionId: `archive-publish:${task.importId}`,
          sessionVersion: 1n,
          writeToken: randomUUID(),
          jobId: task.jobId,
          executionToken: randomUUID(),
          executionAttempt: 1,
          status: 'ACTIVE',
          startedAt: new Date()
        }
      })
      if (entry === 'cleanup')
        {await expect(
          requestArchiveStagingCleanup({ archiveImportId: task.importId, requestedByUserId })
        ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })}
      if (entry === 'generic')
        {await expect(cancelJobCommand({ jobId: task.jobId }, database)).rejects.toMatchObject({
          code: 'INVALID_STATE_TRANSITION'
        })}
      if (entry === 'archive')
        {await expect(archiveModule.requestJobAction(task.jobId, 'CANCEL', requestedByUserId)).rejects.toMatchObject({
          code: 'STATE_CONFLICT'
        })}
      if (entry === 'bulk') {
        const operation = await actionArchiveTasksMany(
          { idempotencyKey: `${suitePrefix}-content-cancel`, taskIds: [task.importId], action: 'CANCEL' },
          requestedByUserId,
          { database }
        )
        expect(operation?.items).toEqual([
          expect.objectContaining({ result: 'CONFLICT', code: 'MEDIA_CONTENT_RECOVERY_REQUIRED' })
        ])
      }
      expect(await database.systemJob.findUniqueOrThrow({ where: { id: task.jobId } })).toMatchObject({
        status: 'PAUSED',
        cancelRequestedAt: null
      })
      expect(await database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).toMatchObject({
        status: 'PAUSED'
      })
      expect(await database.mediaContentPathWrite.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(claim)
    }
  )

  it('matches legacy single-item and bulk direct pause semantics including lease cleanup', async () => {
    const single = await seedTask('single-pause', 'PENDING', 'PENDING')
    const bulk = await seedTask('bulk-pause', 'PENDING', 'PENDING')
    for (const task of [single, bulk]) {
      await database.jobResourceLease.create({
        data: {
          resourceKey: `${suitePrefix}:${task.importId}`,
          ownerJobId: task.jobId,
          workerId: 'stale-worker',
          leaseToken: randomUUID(),
          expiresAt: new Date('2026-08-19T00:00:00.000Z'),
          heartbeatAt: new Date('2026-08-18T00:00:00.000Z')
        }
      })
    }

    await archiveModule.requestAction(single.importId, 'PAUSE', { requestedByUserId })
    const operation = await actionArchiveTasksMany(
      { idempotencyKey: `${suitePrefix}-pause-operation`, taskIds: [bulk.importId], action: 'PAUSE' },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T01:00:00.000Z') }
    )
    expect(operation?.items).toEqual([
      expect.objectContaining({ targetId: bulk.importId, result: 'APPLIED', relatedId: bulk.jobId })
    ])

    const [singleState, bulkState] = await Promise.all([
      database.archiveImport.findUniqueOrThrow({ where: { id: single.importId }, include: { systemJob: true } }),
      database.archiveImport.findUniqueOrThrow({ where: { id: bulk.importId }, include: { systemJob: true } })
    ])
    expect(projectControlState(bulkState)).toEqual(projectControlState(singleState))
    await expect(
      database.jobResourceLease.count({ where: { ownerJobId: { in: [single.jobId, bulk.jobId] } } })
    ).resolves.toBe(0)
  })

  it.each([
    ['RESUME', 'PAUSED', 'PAUSED'],
    ['CANCEL', 'PENDING', 'PENDING']
  ] as const)('matches legacy single-item and bulk %s state transitions', async (action, importStatus, jobStatus) => {
    const single = await seedTask(`single-${action.toLowerCase()}`, importStatus, jobStatus)
    const bulk = await seedTask(`bulk-${action.toLowerCase()}`, importStatus, jobStatus)

    await archiveModule.requestAction(single.importId, action, { requestedByUserId })
    const operation = await actionArchiveTasksMany(
      {
        idempotencyKey: `${suitePrefix}-${action.toLowerCase()}-operation`,
        taskIds: [bulk.importId],
        action
      },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T01:00:00.000Z') }
    )
    expect(operation?.items).toEqual([
      expect.objectContaining({ targetId: bulk.importId, result: 'APPLIED', relatedId: bulk.jobId })
    ])

    const [singleState, bulkState] = await Promise.all([
      database.archiveImport.findUniqueOrThrow({ where: { id: single.importId }, include: { systemJob: true } }),
      database.archiveImport.findUniqueOrThrow({ where: { id: bulk.importId }, include: { systemJob: true } })
    ])
    expect(projectControlState(bulkState)).toEqual(projectControlState(singleState))
  })

  it('resumes both records from the background control and clears stale errors while retaining quality', async () => {
    const task = await seedTask('background-resume', 'PAUSED', 'PAUSED', { decisionCode: 'USE_DISPLAY_QUALITY' })
    await database.systemJob.update({
      where: { id: task.jobId },
      data: { errorCode: 'ORIGINAL_UNAVAILABLE', error: 'old error' }
    })
    await archiveModule.requestJobAction(task.jobId, 'RESUME', requestedByUserId)
    const current = await database.archiveImport.findUniqueOrThrow({
      where: { id: task.importId },
      include: { systemJob: true }
    })
    expect(current).toMatchObject({
      status: 'PENDING',
      selectedQuality: 'ORIGINAL',
      decisionCode: null,
      errorCode: null,
      errorMessage: null
    })
    expect(current.systemJob).toMatchObject({ status: 'PENDING', errorCode: null, error: null })
  })

  it.each(['background', 'archive', 'bulk'] as const)(
    'repairs paused-import drift through %s retry and preserves completed files',
    async (entry) => {
      const task = await seedTask('background-retry-drift', 'PAUSED', 'FAILED', {
        withFailedItem: true,
        completedItems: 1,
        failedItems: 1,
        totalItems: 2
      })
      await database.archiveImportItem.create({
        data: {
          archiveImportId: task.importId,
          pageIndex: 0,
          sourcePageUrl: 'https://e-hentai.org/s/completed/123-1',
          locator: {},
          expectedFilename: '0000.jpg',
          status: 'COMPLETED',
          attempts: 1,
          stagedPath: 'media/0000.jpg',
          byteCount: 128n,
          sha256: 'a'.repeat(64),
          quality: 'ORIGINAL'
        }
      })
      const completedBefore = await database.archiveImportItem.findMany({
        where: { archiveImportId: task.importId, status: 'COMPLETED' }
      })
      expect(completedBefore).toHaveLength(1)
      const legacyJobBefore = await database.systemJob.findUniqueOrThrow({ where: { id: task.jobId } })
      if (entry === 'background') await archiveModule.requestJobAction(task.jobId, 'RETRY', requestedByUserId)
      else if (entry === 'archive') await archiveModule.requestAction(task.importId, 'RETRY', { requestedByUserId })
      else {
        const operation = await actionArchiveTasksMany(
          { idempotencyKey: `${suitePrefix}-drift-retry`, taskIds: [task.importId], action: 'RETRY' },
          requestedByUserId,
          { database }
        )
        expect(operation?.items[0]?.result).toBe('APPLIED')
      }
      const current = await database.archiveImport.findUniqueOrThrow({
        where: { id: task.importId },
        include: { systemJob: true }
      })
      expect(current.systemJobId).not.toBe(task.jobId)
      expect(current.systemJob).toMatchObject({
        type: 'ARCHIVE_DOWNLOAD',
        executionLane: 'ARCHIVE_DOWNLOAD',
        status: 'PENDING',
        parentJobId: task.jobId,
        definitionVersion: 1,
        payload: { archiveImportId: task.importId, defaultTagIds: [] }
      })
      expect(current).toMatchObject({ status: 'PENDING', phase: 'DOWNLOAD', origin: null })
      expect(await database.systemJob.findUniqueOrThrow({ where: { id: task.jobId } })).toEqual(legacyJobBefore)
      expect(
        await database.archiveImportExecution.findUniqueOrThrow({ where: { jobId: current.systemJobId } })
      ).toMatchObject({ archiveImportId: task.importId, phase: 'DOWNLOAD' })
      expect(await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: task.jobId } })).toMatchObject(
        {
          source: 'RETRY',
          acknowledgedByUserId: requestedByUserId
        }
      )
      expect(
        await database.archiveImportItem.findMany({ where: { archiveImportId: task.importId, status: 'COMPLETED' } })
      ).toEqual(completedBefore)
      await expect(archiveModule.requestJobAction(task.jobId, 'RETRY', requestedByUserId)).rejects.toMatchObject({
        code: 'STATE_CONFLICT'
      })
    }
  )

  it('preserves the first failure acknowledgement when retrying an already acknowledged task', async () => {
    const task = await seedTask('retry-acknowledged', 'FAILED', 'FAILED')
    const first = await database.systemJobFailureAcknowledgement.create({
      data: {
        jobId: task.jobId,
        acknowledgedAt: new Date('2026-10-01T00:00:00Z'),
        acknowledgedByUserId: 'first-admin',
        source: 'MANUAL'
      }
    })
    await archiveModule.requestJobAction(task.jobId, 'RETRY', requestedByUserId)
    expect(await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: task.jobId } })).toEqual(first)
  })

  it('rolls back retry linkage and item resets if failure acknowledgement cannot be saved', async () => {
    const task = await seedTask('retry-ack-failure', 'FAILED', 'FAILED', { withFailedItem: true })
    const fault = vi.spyOn(failurePolicy, 'acknowledgeJobFailure').mockRejectedValueOnce(new Error('ack write failed'))
    try {
      await expect(archiveModule.requestJobAction(task.jobId, 'RETRY', requestedByUserId)).rejects.toThrow(
        'ack write failed'
      )
    } finally {
      fault.mockRestore()
    }
    expect(await database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).toMatchObject({
      status: 'FAILED',
      systemJobId: task.jobId
    })
    expect(await database.systemJob.count({ where: { parentJobId: task.jobId } })).toBe(0)
    expect(await database.archiveImportItem.findFirst({ where: { archiveImportId: task.importId } })).toMatchObject({
      status: 'FAILED',
      attempts: 3
    })
    expect(await database.systemJobFailureAcknowledgement.findUnique({ where: { jobId: task.jobId } })).toBeNull()
  })

  it('allows only one concurrent resume and leaves both records queued', async () => {
    const task = await seedTask('background-resume-race', 'PAUSED', 'PAUSED')
    const results = await Promise.allSettled([
      archiveModule.requestJobAction(task.jobId, 'RESUME', requestedByUserId),
      archiveModule.requestJobAction(task.jobId, 'RESUME', requestedByUserId)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const current = await database.archiveImport.findUniqueOrThrow({
      where: { id: task.importId },
      include: { systemJob: true }
    })
    expect(current.status).toBe('PENDING')
    expect(current.systemJob.status).toBe('PENDING')
  })

  it('rolls back queue changes when resume encounters an incompatible import state', async () => {
    const task = await seedTask('background-conflict', 'COMPLETED', 'PAUSED')
    await expect(archiveModule.requestJobAction(task.jobId, 'RESUME', requestedByUserId)).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    expect((await database.systemJob.findUniqueOrThrow({ where: { id: task.jobId } })).status).toBe('PAUSED')
  })

  it('matches legacy retry linkage, priority, progress, max-attempt, item reset, and decision cleanup', async () => {
    const single = await seedTask('single-retry', 'FAILED', 'FAILED', {
      progress: 50,
      queuePriority: 12,
      maxAttempts: 5,
      decisionCode: 'USE_DISPLAY_QUALITY',
      failedItems: 1,
      completedItems: 1,
      totalItems: 2,
      withFailedItem: true
    })
    const bulk = await seedTask('bulk-retry', 'FAILED', 'FAILED', {
      progress: 50,
      queuePriority: 12,
      maxAttempts: 5,
      decisionCode: 'USE_DISPLAY_QUALITY',
      failedItems: 1,
      completedItems: 1,
      totalItems: 2,
      withFailedItem: true
    })

    await archiveModule.requestAction(single.importId, 'RETRY', { requestedByUserId })
    const operation = await actionArchiveTasksMany(
      { idempotencyKey: `${suitePrefix}-retry-operation`, taskIds: [bulk.importId], action: 'RETRY' },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T01:00:00.000Z'), uuid: randomUUID }
    )
    expect(operation?.items[0]).toMatchObject({ targetId: bulk.importId, result: 'APPLIED' })

    const [singleState, bulkState] = await Promise.all([
      database.archiveImport.findUniqueOrThrow({
        where: { id: single.importId },
        include: { systemJob: true, items: true }
      }),
      database.archiveImport.findUniqueOrThrow({
        where: { id: bulk.importId },
        include: { systemJob: true, items: true }
      })
    ])
    expect(projectRetryState(bulkState)).toEqual(projectRetryState(singleState))
    expect(bulkState.systemJob).toMatchObject({
      parentJobId: bulk.jobId,
      type: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      definitionVersion: 1,
      triggerSource: 'MANUAL',
      payload: { archiveImportId: bulk.importId, defaultTagIds: [] },
      queuePriority: 12,
      effectivePriority: 12,
      progress: 50,
      maxAttempts: 5
    })
    expect(bulkState).toMatchObject({ phase: 'DOWNLOAD', origin: null })
    expect(await database.systemJob.findUniqueOrThrow({ where: { id: bulk.jobId } })).toMatchObject({
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status: 'FAILED',
      triggerSource: 'MANUAL',
      queuePriority: 12,
      effectivePriority: 12,
      progress: 50,
      maxAttempts: 5
    })
    expect(bulkState.items).toEqual([expect.objectContaining({ status: 'PENDING', attempts: 0, errorCode: null })])
  })

  it('propagates bulk direct cancellation to every uploader catalog source for the same provider identity', async () => {
    const task = await seedTask('catalog-bulk-cancel', 'PENDING', 'PENDING')
    await seedCatalogCopies(task.importId, 'catalog-bulk-cancel', 'SUBMITTED')
    const cancelledAt = new Date('2026-08-18T01:30:00.000Z')

    const operation = await actionArchiveTasksMany(
      {
        idempotencyKey: `${suitePrefix}-catalog-bulk-cancel-operation`,
        taskIds: [task.importId],
        action: 'CANCEL'
      },
      requestedByUserId,
      { database, now: () => cancelledAt }
    )

    expect(operation?.items).toEqual([
      expect.objectContaining({ targetId: task.importId, result: 'APPLIED', relatedId: task.jobId })
    ])
    await expect(
      database.archiveUploaderCatalogItem.findMany({
        where: { providerKey: 'archive-task-test-provider', externalId: 'catalog-bulk-cancel' },
        orderBy: { sourceId: 'asc' },
        select: {
          lastArchiveImportId: true,
          lastOutcome: true,
          lastOutcomeAt: true,
          lastErrorCode: true
        }
      })
    ).resolves.toEqual([
      {
        lastArchiveImportId: task.importId,
        lastOutcome: 'CANCELLED',
        lastOutcomeAt: cancelledAt,
        lastErrorCode: 'CANCELLED'
      },
      {
        lastArchiveImportId: task.importId,
        lastOutcome: 'CANCELLED',
        lastOutcomeAt: cancelledAt,
        lastErrorCode: 'CANCELLED'
      }
    ])
  })

  it('resets every matching uploader catalog terminal summary when bulk retry is accepted', async () => {
    const task = await seedTask('catalog-bulk-retry', 'FAILED', 'FAILED')
    await seedCatalogCopies(task.importId, 'catalog-bulk-retry', 'FAILED')
    const retriedAt = new Date('2026-08-18T01:45:00.000Z')

    const operation = await actionArchiveTasksMany(
      {
        idempotencyKey: `${suitePrefix}-catalog-bulk-retry-operation`,
        taskIds: [task.importId],
        action: 'RETRY'
      },
      requestedByUserId,
      { database, now: () => retriedAt, uuid: randomUUID }
    )

    expect(operation?.items[0]).toMatchObject({ targetId: task.importId, result: 'APPLIED' })
    await expect(
      database.archiveUploaderCatalogItem.findMany({
        where: { providerKey: 'archive-task-test-provider', externalId: 'catalog-bulk-retry' },
        orderBy: { sourceId: 'asc' },
        select: {
          lastArchiveImportId: true,
          lastOutcome: true,
          lastOutcomeAt: true,
          lastErrorCode: true,
          lastErrorMessage: true
        }
      })
    ).resolves.toEqual([
      {
        lastArchiveImportId: task.importId,
        lastOutcome: 'SUBMITTED',
        lastOutcomeAt: retriedAt,
        lastErrorCode: null,
        lastErrorMessage: null
      },
      {
        lastArchiveImportId: task.importId,
        lastOutcome: 'SUBMITTED',
        lastOutcomeAt: retriedAt,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    ])
  })

  it('applies eligible targets, skips ineligible targets, and audits both independently', async () => {
    const eligible = await seedTask('mixed-pending', 'PENDING', 'PENDING')
    const ineligible = await seedTask('mixed-complete', 'COMPLETED', 'COMPLETED')
    const operation = await actionArchiveTasksMany(
      {
        idempotencyKey: `${suitePrefix}-mixed-operation`,
        taskIds: [eligible.importId, ineligible.importId],
        action: 'CANCEL'
      },
      requestedByUserId,
      { database }
    )
    expect(operation?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: eligible.importId, result: 'APPLIED' }),
        expect.objectContaining({ targetId: ineligible.importId, result: 'SKIPPED', code: 'INVALID_STATE' })
      ])
    )
    await expect(database.archiveImport.findUniqueOrThrow({ where: { id: eligible.importId } })).resolves.toMatchObject(
      {
        status: 'CANCELLED'
      }
    )
    await expect(
      database.archiveImport.findUniqueOrThrow({ where: { id: ineligible.importId } })
    ).resolves.toMatchObject({
      status: 'COMPLETED'
    })
  })

  it.each([
    ['PAUSE', 'PAUSED', 'PAUSED'],
    ['CANCEL', 'CANCELLING', 'CANCELLING'],
    ['CANCEL', 'CANCELLED', 'CANCELLED']
  ] as const)(
    'matches the legacy conflict for a new %s command against an already %s task',
    async (action, importStatus, jobStatus) => {
      const single = await seedTask(
        `already-single-${action.toLowerCase()}-${importStatus.toLowerCase()}`,
        importStatus,
        jobStatus
      )
      await expect(archiveModule.requestAction(single.importId, action, { requestedByUserId })).rejects.toMatchObject({
        code: 'STATE_CONFLICT'
      })
      await database.archiveImport.delete({ where: { id: single.importId } })
      await database.systemJob.delete({ where: { id: single.jobId } })
      const bulk = await seedTask(
        `already-bulk-${action.toLowerCase()}-${importStatus.toLowerCase()}`,
        importStatus,
        jobStatus
      )
      const operation = await actionArchiveTasksMany(
        {
          idempotencyKey: `${suitePrefix}-already-${action.toLowerCase()}-${importStatus.toLowerCase()}`,
          taskIds: [bulk.importId],
          action
        },
        requestedByUserId,
        { database }
      )
      expect(operation?.items).toEqual([
        expect.objectContaining({
          targetId: bulk.importId,
          result: 'SKIPPED',
          code: 'INVALID_STATE'
        })
      ])
      await expect(
        database.archiveImport.findUniqueOrThrow({ where: { id: bulk.importId }, select: { status: true } })
      ).resolves.toEqual({ status: importStatus })
    }
  )

  it('resumes a partially committed bulk operation without repeating the completed target', async () => {
    const completed = await seedTask('crash-completed', 'PAUSED', 'PAUSED')
    const missing = await seedTask('crash-missing', 'PENDING', 'PENDING')
    await database.systemJobEvent.create({
      data: {
        jobId: completed.jobId,
        type: 'job.paused',
        level: 'WARN',
        attempt: 0,
        message: 'Persisted before simulated process crash'
      }
    })
    const idempotencyKey = `${suitePrefix}-crash-replay-operation`
    const targetIds = [completed.importId, missing.importId]
    const seededOperation = await database.archiveBulkOperation.create({
      data: {
        idempotencyKey,
        requestHash: archiveRequestFingerprint({
          commandType: 'PAUSE',
          targetType: 'ARCHIVE_IMPORT',
          targetIds: [...targetIds].sort(),
          requestOptions: null
        }),
        requestedByUserId,
        commandType: 'PAUSE',
        requestedCount: 2,
        items: {
          create: {
            targetType: 'ARCHIVE_IMPORT',
            targetId: completed.importId,
            result: 'APPLIED',
            relatedId: completed.jobId,
            message: 'persisted https://e-hentai.org/g/123/bulk-crash-path-token/'
          }
        }
      }
    })
    const beforeCounts = {
      jobs: await database.systemJob.count({ where: { requestedByUserId } }),
      imports: await database.archiveImport.count({ where: { systemJob: { requestedByUserId } } }),
      completedEvents: await database.systemJobEvent.count({ where: { jobId: completed.jobId } })
    }

    const replay = await actionArchiveTasksMany(
      { idempotencyKey, taskIds: targetIds, action: 'PAUSE' },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T02:00:00.000Z') }
    )

    expect(replay).toMatchObject({
      id: seededOperation.id,
      requestedCount: 2,
      counts: { applied: 2 },
      completedAt: expect.any(Date)
    })
    expect(replay?.items).toHaveLength(2)
    expect(JSON.stringify(replay)).not.toContain('bulk-crash-path-token')
    await expect(database.archiveImport.findUniqueOrThrow({ where: { id: missing.importId } })).resolves.toMatchObject({
      status: 'PAUSED'
    })
    await expect(database.systemJobEvent.count({ where: { jobId: completed.jobId } })).resolves.toBe(
      beforeCounts.completedEvents
    )
    await expect(database.systemJob.count({ where: { requestedByUserId } })).resolves.toBe(beforeCounts.jobs)
    await expect(database.archiveImport.count({ where: { systemJob: { requestedByUserId } } })).resolves.toBe(
      beforeCounts.imports
    )
    await expect(database.archiveBulkOperationItem.count({ where: { operationId: seededOperation.id } })).resolves.toBe(
      2
    )
  })

  it('rejects an altered payload for the same bulk key without new side effects or audit', async () => {
    const task = await seedTask('payload-conflict', 'PENDING', 'PENDING')
    const idempotencyKey = `${suitePrefix}-payload-conflict-operation`
    const first = await actionArchiveTasksMany(
      { idempotencyKey, taskIds: [task.importId], action: 'PAUSE' },
      requestedByUserId,
      { database }
    )
    const beforeCounts = {
      jobs: await database.systemJob.count({ where: { requestedByUserId } }),
      imports: await database.archiveImport.count({ where: { systemJob: { requestedByUserId } } }),
      operations: await database.archiveBulkOperation.count({ where: { requestedByUserId } }),
      auditItems: await database.archiveBulkOperationItem.count({ where: { operationId: first!.id } }),
      events: await database.systemJobEvent.count({ where: { jobId: task.jobId } })
    }

    await expect(
      actionArchiveTasksMany({ idempotencyKey, taskIds: [task.importId], action: 'CANCEL' }, requestedByUserId, {
        database
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(database.systemJob.count({ where: { requestedByUserId } })).resolves.toBe(beforeCounts.jobs)
    await expect(database.archiveImport.count({ where: { systemJob: { requestedByUserId } } })).resolves.toBe(
      beforeCounts.imports
    )
    await expect(database.archiveBulkOperation.count({ where: { requestedByUserId } })).resolves.toBe(
      beforeCounts.operations
    )
    await expect(database.archiveBulkOperationItem.count({ where: { operationId: first!.id } })).resolves.toBe(
      beforeCounts.auditItems
    )
    await expect(database.systemJobEvent.count({ where: { jobId: task.jobId } })).resolves.toBe(beforeCounts.events)
  })

  it('audits an ordinary target failure as FAILED when the task state was not applied', async () => {
    const task = await seedTask('failure-internal', 'FAILED', 'FAILED')
    const beforeCounts = {
      jobs: await database.systemJob.count({ where: { requestedByUserId } }),
      imports: await database.archiveImport.count({ where: { systemJob: { requestedByUserId } } })
    }
    const operation = await actionArchiveTasksMany(
      {
        idempotencyKey: `${suitePrefix}-failure-internal-operation`,
        taskIds: [task.importId],
        action: 'RETRY'
      },
      requestedByUserId,
      {
        database,
        uuid: () => {
          throw new Error('injected https://e-hentai.org/g/123/failure-path-token/ locator=failure-private-locator')
        }
      }
    )
    expect(operation?.items).toEqual([
      expect.objectContaining({ targetId: task.importId, result: 'FAILED', code: 'INTERNAL' })
    ])
    expect(JSON.stringify(operation)).not.toContain('failure-path-token')
    expect(JSON.stringify(operation)).not.toContain('failure-private-locator')
    await expect(database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).resolves.toMatchObject({
      status: 'FAILED',
      systemJobId: task.jobId
    })
    await expect(database.systemJob.count({ where: { requestedByUserId } })).resolves.toBe(beforeCounts.jobs)
    await expect(database.archiveImport.count({ where: { systemJob: { requestedByUserId } } })).resolves.toBe(
      beforeCounts.imports
    )
  })

  it('audits a CAS ArchiveError as CONFLICT when the task state was not applied', async () => {
    const task = await seedTask('failure-cas', 'PENDING', 'PENDING')
    const functionName = `stage2_cas_${randomUUID().replaceAll('-', '')}`
    const triggerName = `${functionName}_trigger`
    const escapedJobId = task.jobId.replaceAll("'", "''")
    await database.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."id" = '${escapedJobId}' THEN RETURN NULL; END IF;
        RETURN NEW;
      END;
      $$
    `)
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "system_jobs"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `)
    let operation
    try {
      operation = await actionArchiveTasksMany(
        {
          idempotencyKey: `${suitePrefix}-failure-cas-operation`,
          taskIds: [task.importId],
          action: 'PAUSE'
        },
        requestedByUserId,
        { database }
      )
    } finally {
      await database.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "system_jobs"`)
      await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }
    expect(operation?.items).toEqual([
      expect.objectContaining({ targetId: task.importId, result: 'CONFLICT', code: 'STATE_CONFLICT' })
    ])
    await expect(database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).resolves.toMatchObject({
      status: 'PENDING',
      systemJobId: task.jobId
    })
    await expect(database.systemJobEvent.count({ where: { jobId: task.jobId } })).resolves.toBe(0)
  })

  it.each([
    ['PAUSE', 'PENDING', 'PENDING'],
    ['RESUME', 'PAUSED', 'PAUSED'],
    ['CANCEL', 'PENDING', 'PENDING'],
    ['RETRY', 'FAILED', 'FAILED']
  ] as const)(
    'rejects %s during staging cleanup in both single and bulk entry points',
    async (action, importStatus, jobStatus) => {
      const cleanupRequestedAt = new Date('2026-08-18T00:00:00.000Z')
      const single = await seedTask(`cleanup-single-${action.toLowerCase()}`, importStatus, jobStatus, {
        cleanupRequestedAt
      })
      const bulk = await seedTask(`cleanup-bulk-${action.toLowerCase()}`, importStatus, jobStatus, {
        cleanupRequestedAt
      })

      await expect(archiveModule.requestAction(single.importId, action, { requestedByUserId })).rejects.toMatchObject({
        code: 'STATE_CONFLICT'
      })
      const operation = await actionArchiveTasksMany(
        {
          idempotencyKey: `${suitePrefix}-cleanup-${action.toLowerCase()}-operation`,
          taskIds: [bulk.importId],
          action
        },
        requestedByUserId,
        { database }
      )
      expect(operation?.items).toEqual([
        expect.objectContaining({
          targetId: bulk.importId,
          result: 'CONFLICT',
          code: 'CLEANUP_IN_PROGRESS'
        })
      ])
      await expect(
        database.archiveImport.findMany({
          where: { id: { in: [single.importId, bulk.importId] } },
          select: { status: true, cleanupRequestedAt: true }
        })
      ).resolves.toEqual(
        expect.arrayContaining([
          { status: importStatus, cleanupRequestedAt },
          { status: importStatus, cleanupRequestedAt }
        ])
      )
    }
  )

  it.each(['OUTBOUND', 'INBOUND'])('reclassifies persisted legacy notices read-only: %s', async (direction) => {
    const task = await seedTask(`version-notice-${direction}`, 'COMPLETED', 'COMPLETED')
    const before = await database.archiveImport.update({
      where: { id: task.importId },
      data: {
        providerKey: 'e-hentai',
        externalId: '123',
        warning: '检测到 E-Hentai 画廊版本替代关系，将在关联作品存在时建立显式关系',
        normalizedMetadata: {
          titles: { display: 'Historical gallery' },
          relationships: [{ type: 'REPLACES', providerKey: 'e-hentai', externalId: '122', direction }]
        }
      }
    })
    const page = await listArchiveTasks({ taskId: task.importId }, { database })
    expect(page.items[0]?.warning).toBe(
      direction === 'OUTBOUND'
        ? '解析时发现此画廊关联了历史版本，不影响本次归档。'
        : '解析时此链接已是旧版，远端另有更新版本；本次仍归档此链接，新版需另行添加，不会覆盖旧版。'
    )
    expect(await database.archiveImport.findUniqueOrThrow({ where: { id: task.importId } })).toEqual(before)
  })

  it('uses a createdAt/id keyset, composes filters, and redacts task URLs and messages', async () => {
    const createdAt = new Date('2026-08-18T05:00:00.000Z')
    const first = await seedTask('page-a', 'PENDING', 'PENDING', {
      createdAt,
      submittedUrl: 'https://e-hentai.org/g/page-a/private-token/?token=secret',
      message: 'job https://e-hentai.org/g/page-a/message-path-token/ Bearer private-bearer',
      errorMessage: 'error https://e-hentai.org/g/page-a/error-path-token/ token=private-error',
      warning: 'warning https://e-hentai.org/g/page-a/warning-path-token/ locator=private-locator'
    })
    const second = await seedTask('page-b', 'PENDING', 'PENDING', {
      createdAt,
      submittedUrl: 'https://e-hentai.org/g/page-b/private-token/?token=secret',
      message: 'job https://e-hentai.org/g/page-b/message-path-token/ Bearer private-bearer',
      errorMessage: 'error https://e-hentai.org/g/page-b/error-path-token/ token=private-error',
      warning: 'warning https://e-hentai.org/g/page-b/warning-path-token/ locator=private-locator'
    })
    const firstPage = await listArchiveTasks(
      {
        limit: 1,
        statuses: ['PENDING'],
        providerKey: 'archive-task-test-provider',
        search: 'private-token'
      },
      { database }
    )
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toBeTruthy()
    expect(JSON.stringify(firstPage)).not.toContain('private-token')
    expect(JSON.stringify(firstPage)).not.toContain('private-bearer')
    expect(JSON.stringify(firstPage)).not.toContain('private-error')
    expect(JSON.stringify(firstPage)).not.toContain('message-path-token')
    expect(JSON.stringify(firstPage)).not.toContain('error-path-token')
    expect(JSON.stringify(firstPage)).not.toContain('warning-path-token')
    expect(JSON.stringify(firstPage)).not.toContain('private-locator')

    const secondPage = await listArchiveTasks(
      {
        limit: 1,
        statuses: ['PENDING'],
        providerKey: 'archive-task-test-provider',
        search: 'private-token',
        cursor: firstPage.nextCursor!
      },
      { database }
    )
    expect(secondPage.items).toHaveLength(1)
    expect(new Set([firstPage.items[0]!.id, secondPage.items[0]!.id])).toEqual(
      new Set([first.importId, second.importId])
    )
  })

  it('attributes tasks to the matching filter or the earliest creator intake by default', async () => {
    const task = await seedTask('attribution', 'PENDING', 'PENDING')
    const firstSubmissionId = `${suitePrefix}-attribution-created`
    const secondSubmissionId = `${suitePrefix}-attribution-reused`
    await database.archiveIntakeSubmission.create({
      data: {
        id: firstSubmissionId,
        idempotencyKey: firstSubmissionId,
        requestHash: '8'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        createdAt: new Date('2026-08-18T06:00:00.000Z'),
        items: {
          create: {
            submittedUrl: 'https://e-hentai.org/g/attribution/creator-token/',
            normalizedUrlHash: '8'.repeat(64),
            status: 'ENQUEUED',
            providerKey: 'archive-task-test-provider',
            externalId: 'attribution',
            resolutionKind: 'NEW',
            archiveImportId: task.importId,
            activeArchiveImportId: task.importId,
            createdAt: new Date('2026-08-18T06:00:00.000Z'),
            updatedAt: new Date('2026-08-18T06:00:00.000Z')
          }
        }
      }
    })
    await database.archiveIntakeSubmission.create({
      data: {
        id: secondSubmissionId,
        idempotencyKey: secondSubmissionId,
        requestHash: '9'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        createdAt: new Date('2026-08-18T07:00:00.000Z'),
        items: {
          create: {
            submittedUrl: 'https://e-hentai.org/g/attribution/reuse-token/',
            normalizedUrlHash: '9'.repeat(64),
            status: 'ENQUEUED',
            providerKey: 'archive-task-test-provider',
            externalId: 'attribution',
            resolutionKind: 'ACTIVE_TASK',
            archiveImportId: task.importId,
            activeArchiveImportId: task.importId,
            createdAt: new Date('2026-08-18T07:00:00.000Z'),
            updatedAt: new Date('2026-08-18T07:00:00.000Z')
          }
        }
      }
    })

    const unfiltered = await listArchiveTasks({ limit: 50, providerKey: 'archive-task-test-provider' }, { database })
    expect(unfiltered.items.find((item) => item.id === task.importId)).toMatchObject({
      submissionId: firstSubmissionId,
      kind: 'NEW'
    })

    const creatorFiltered = await listArchiveTasks(
      {
        limit: 50,
        providerKey: 'archive-task-test-provider',
        submissionId: firstSubmissionId,
        kind: 'NEW'
      },
      { database }
    )
    expect(creatorFiltered.items).toEqual([
      expect.objectContaining({ id: task.importId, submissionId: firstSubmissionId, kind: 'NEW' })
    ])

    const reusedFiltered = await listArchiveTasks(
      { limit: 50, providerKey: 'archive-task-test-provider', submissionId: secondSubmissionId },
      { database }
    )
    expect(reusedFiltered.items).toEqual([
      expect.objectContaining({ id: task.importId, submissionId: secondSubmissionId, kind: 'ACTIVE_TASK' })
    ])
  })
})
