import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveModule } from '../archive-module'
import { archiveRequestFingerprint } from '../archive-bulk-operation'
import { actionArchiveTasksMany, listArchiveTasks } from '../archive-task-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `archive-task-stage2-${randomUUID()}`
const requestedByUserId = `${suitePrefix}-admin`
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)

describePostgres('archive task PostgreSQL contracts', () => {
  beforeAll(async () => database.$connect())
  beforeEach(() => vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true'))

  afterEach(async () => {
    vi.unstubAllEnvs()
    await database.archiveBulkOperation.deleteMany({ where: { requestedByUserId } })
    const jobs = await database.systemJob.findMany({ where: { requestedByUserId }, select: { id: true } })
    if (jobs.length > 0) {
      await database.archiveImport.deleteMany({ where: { systemJobId: { in: jobs.map((job) => job.id) } } })
      await database.systemJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } })
    }
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId } })
  })

  afterAll(async () => disconnectDatabase(database))

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
      queuePriority: 12,
      effectivePriority: 12,
      progress: 50,
      maxAttempts: 5
    })
    expect(bulkState.items).toEqual([expect.objectContaining({ status: 'PENDING', attempts: 0, errorCode: null })])
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

async function seedTask(
  suffix: string,
  importStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  jobStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  options: {
    progress?: number
    queuePriority?: number
    maxAttempts?: number
    decisionCode?: string
    failedItems?: number
    completedItems?: number
    totalItems?: number
    withFailedItem?: boolean
    createdAt?: Date
    submittedUrl?: string
    message?: string
    errorMessage?: string
    warning?: string
    cleanupRequestedAt?: Date
  } = {}
) {
  const jobId = `${suitePrefix}-${suffix}-job`
  const importId = `${suitePrefix}-${suffix}-import`
  await database.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status: jobStatus,
      triggerSource: 'MANUAL',
      requestedByUserId,
      payload: { archiveImportId: importId },
      queuePriority: options.queuePriority ?? 10,
      effectivePriority: options.queuePriority ?? 10,
      maxAttempts: options.maxAttempts ?? 3,
      progress: options.progress ?? 0,
      message: options.message,
      createdAt: options.createdAt,
      ...(jobStatus === 'COMPLETED' || jobStatus === 'FAILED' || jobStatus === 'CANCELLED'
        ? { finishedAt: options.createdAt ?? new Date() }
        : {})
    }
  })
  await database.archiveImport.create({
    data: {
      id: importId,
      systemJobId: jobId,
      providerKey: 'archive-task-test-provider',
      externalId: suffix,
      submittedUrl: options.submittedUrl ?? `https://e-hentai.org/g/${suffix}/private-token/`,
      canonicalUrl: `https://e-hentai.org/g/${suffix}/private-token/`,
      locator: { token: 'private-token' },
      status: importStatus,
      requestedQuality: 'ORIGINAL',
      selectedQuality: 'ORIGINAL',
      decisionCode: options.decisionCode,
      normalizedMetadata: { titles: { display: `Task ${suffix}` } },
      rawMetadata: { token: 'private-token' },
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'test-creator',
      stagingPath: `.archive-staging/${importId}`,
      totalItems: options.totalItems ?? (options.withFailedItem ? 1 : 0),
      completedItems: options.completedItems ?? 0,
      failedItems: options.failedItems ?? 0,
      errorMessage: options.errorMessage,
      warning: options.warning,
      cleanupRequestedAt: options.cleanupRequestedAt,
      createdAt: options.createdAt,
      ...(options.withFailedItem
        ? {
            items: {
              create: {
                pageIndex: 1,
                sourcePageUrl: `https://e-hentai.org/s/private/${suffix}`,
                locator: { token: 'private' },
                expectedFilename: '0001',
                status: 'FAILED',
                attempts: 3,
                errorCode: 'REMOTE_RESPONSE_INVALID'
              }
            }
          }
        : {})
    }
  })
  return { jobId, importId }
}

function projectControlState(task: { status: string; systemJob: { status: string }; failedItems: number }) {
  return { importStatus: task.status, jobStatus: task.systemJob.status, failedItems: task.failedItems }
}

function projectRetryState(task: {
  status: string
  decisionCode: string | null
  errorCode: string | null
  errorMessage: string | null
  failedItems: number
  systemJob: {
    status: string
    triggerSource: string
    queuePriority: number
    effectivePriority: number
    progress: number
    maxAttempts: number
  }
}) {
  return {
    importStatus: task.status,
    decisionCode: task.decisionCode,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    failedItems: task.failedItems,
    jobStatus: task.systemJob.status,
    triggerSource: task.systemJob.triggerSource,
    priority: task.systemJob.queuePriority,
    effectivePriority: task.systemJob.effectivePriority,
    progress: task.systemJob.progress,
    maxAttempts: task.systemJob.maxAttempts
  }
}
