import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { enqueueSingletonManualJobWithResult } from '@/services/background-task/manual-job-singleton'
import { getSourceAuditApplyOperation, startSourceAuditApply } from '../source-audit-apply-service'
import { startSourceAudit } from '../source-audit-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `source-audit-lock-${randomUUID()}`
const requestedByUserId = `${suitePrefix}-admin`
const workerId = `${suitePrefix}-worker`.slice(0, 120)
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
let previousInventoryState: Awaited<ReturnType<typeof database.pixivMetadataInventoryState.findUnique>> = null

describePostgres('source audit PostgreSQL singleton contract', () => {
  beforeAll(async () => {
    await database.$connect()
    previousInventoryState = await database.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
    await database.pixivMetadataInventoryState.upsert({
      where: { id: 'pixiv' },
      update: { status: 'READY' },
      create: {
        id: 'pixiv',
        status: 'READY',
        rootPathHash: '0'.repeat(64),
        rootDeviceId: 1n,
        rootInode: 1n,
        baselineGeneration: 1,
        baselineStartedAt: new Date('2026-08-20T00:00:00.000Z'),
        baselineCompletedAt: new Date('2026-08-20T00:00:00.000Z')
      }
    })
  })

  afterEach(async () => {
    await database.scanRun.deleteMany({ where: { systemJob: { is: { requestedByUserId } } } })
    await database.systemJob.deleteMany({ where: { requestedByUserId } })
    await database.workerInstance.deleteMany({ where: { workerId } })
  })

  afterAll(async () => {
    if (previousInventoryState) {
      const data = {
        status: previousInventoryState.status,
        rootPathHash: previousInventoryState.rootPathHash,
        rootDeviceId: previousInventoryState.rootDeviceId,
        rootInode: previousInventoryState.rootInode,
        baselineGeneration: previousInventoryState.baselineGeneration,
        baselineStartedAt: previousInventoryState.baselineStartedAt,
        baselineCompletedAt: previousInventoryState.baselineCompletedAt
      }
      await database.pixivMetadataInventoryState.upsert({
        where: { id: previousInventoryState.id },
        update: data,
        create: { id: previousInventoryState.id, ...data }
      })
    } else {
      await database.pixivMetadataInventoryState.deleteMany({ where: { id: 'pixiv' } })
    }
    await disconnectDatabase(database)
  })

  it('serializes an ordinary SCAN@v1 enqueue against SCAN@v2 audit start', async () => {
    const heartbeatAt = new Date()
    await database.workerInstance.create({
      data: {
        workerId,
        status: 'READY',
        serviceVersion: 'postgres-test',
        hostname: 'postgres-test',
        processId: 1,
        capabilities: [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2] }],
        startedAt: heartbeatAt,
        heartbeatAt
      }
    })

    const ordinary = enqueueSingletonManualJobWithResult(
      {
        type: 'SCAN',
        triggerSource: 'MANUAL',
        requestedByUserId,
        idempotencyKey: `${suitePrefix}-ordinary`,
        payload: { mode: 'INCREMENTAL' },
        priority: 10,
        maxAttempts: 3
      },
      { client: database }
    )
    const audit = startSourceAudit({ requestId: randomUUID() }, requestedByUserId, {
      database: database as never,
      environment: {
        CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'true',
        WORKER_DISPATCH_ENABLED: 'true'
      },
      getScanRoot: async () => '/postgres-test/source',
      inspectRoot: async () => undefined
    })

    const results = await Promise.allSettled([ordinary, audit])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const active = await database.systemJob.findMany({
      where: {
        type: 'SCAN',
        requestedByUserId,
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] }
      },
      select: { id: true, definitionVersion: true }
    })
    expect(active).toHaveLength(1)
    expect([1, 2]).toContain(active[0]!.definitionVersion)
    await expect(database.systemJobEvent.count({ where: { jobId: active[0]!.id, type: 'job.queued' } })).resolves.toBe(
      1
    )
  })

  it('atomically freezes an apply operation and durably replays its idempotency key', async () => {
    const audit = await seedCompletedSourceAudit()
    await seedWorker([1, 2, 3])
    const idempotencyKey = randomUUID()
    const input = { auditRunId: audit.runId, itemIds: [audit.itemId], idempotencyKey }

    const first = await startSourceAuditApply(input, requestedByUserId, applyOptions())
    expect(first).toMatchObject({ outcome: 'ACCEPTED', reused: false })
    if (first.outcome !== 'ACCEPTED') throw new Error('Expected source audit apply to be accepted')

    const [storedRun, frozenInputs, runItems, queuedEvents] = await Promise.all([
      database.scanRun.findUnique({
        where: { id: first.operationId },
        select: {
          operationKind: true,
          sourceAuditRunId: true,
          status: true,
          inputDigest: true,
          systemJob: { select: { definitionVersion: true, payload: true } }
        }
      }),
      database.scanRunMetadataInput.findMany({ where: { scanRunId: first.operationId } }),
      database.scanRunItem.findMany({ where: { scanRunId: first.operationId } }),
      database.systemJobEvent.count({ where: { jobId: first.jobId, type: 'job.queued' } })
    ])
    expect(storedRun).toMatchObject({
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: audit.runId,
      status: 'PENDING',
      systemJob: { definitionVersion: 3, payload: expect.objectContaining({ mode: 'AUDIT_APPLY' }) }
    })
    expect(storedRun?.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(frozenInputs).toHaveLength(1)
    expect(frozenInputs[0]).toMatchObject({
      sourceAuditItemId: audit.itemId,
      auditDifferenceKind: 'NEW',
      observedExternalId: 'postgres-101'
    })
    expect(runItems).toHaveLength(1)
    expect(runItems[0]).toMatchObject({ sourceAuditItemId: audit.itemId, status: 'PENDING', action: 'CREATE' })
    expect(queuedEvents).toBe(1)

    await expect(startSourceAuditApply(input, requestedByUserId, applyOptions())).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      operationId: first.operationId,
      jobId: first.jobId,
      reused: true
    })
    await database.$transaction([
      database.scanRunItem.updateMany({
        where: { scanRunId: first.operationId },
        data: { status: 'SUCCESS', applyOutcome: 'APPLIED', applyRetryable: false, finishedAt: new Date() }
      }),
      database.scanRun.update({
        where: { id: first.operationId },
        data: { status: 'COMPLETED', finishedAt: new Date() }
      }),
      database.systemJob.update({
        where: { id: first.jobId },
        data: { status: 'COMPLETED', finishedAt: new Date() }
      })
    ])
    await expect(
      startSourceAuditApply({ ...input, idempotencyKey: randomUUID() }, requestedByUserId, applyOptions())
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'ITEMS_NOT_ELIGIBLE', activeOperationId: null })
    await expect(
      database.systemJob.count({
        where: { requestedByUserId, definitionVersion: 3, scanRun: { is: { operationKind: 'AUDIT_APPLY' } } }
      })
    ).resolves.toBe(1)
  })

  it('serializes an ordinary SCAN@v1 enqueue against SCAN@v3 apply start', async () => {
    const audit = await seedCompletedSourceAudit()
    await seedWorker([1, 2, 3])
    const ordinary = enqueueSingletonManualJobWithResult(
      {
        type: 'SCAN',
        triggerSource: 'MANUAL',
        requestedByUserId,
        idempotencyKey: `${suitePrefix}-ordinary-v3`,
        payload: { mode: 'INCREMENTAL' },
        priority: 10,
        maxAttempts: 3
      },
      { client: database }
    )
    const apply = startSourceAuditApply(
      { auditRunId: audit.runId, itemIds: [audit.itemId], idempotencyKey: randomUUID() },
      requestedByUserId,
      applyOptions()
    )

    await Promise.allSettled([ordinary, apply])
    const active = await database.systemJob.findMany({
      where: {
        type: 'SCAN',
        requestedByUserId,
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] }
      },
      select: { definitionVersion: true }
    })
    expect(active).toHaveLength(1)
    expect([1, 3]).toContain(active[0]!.definitionVersion)
  })

  it('makes a pre-start cancelled apply operation complete and leaves its item retryable', async () => {
    const audit = await seedCompletedSourceAudit()
    await seedWorker([1, 2, 3])
    const accepted = await startSourceAuditApply(
      { auditRunId: audit.runId, itemIds: [audit.itemId], idempotencyKey: randomUUID() },
      requestedByUserId,
      applyOptions()
    )
    if (accepted.outcome !== 'ACCEPTED') throw new Error('Expected source audit apply to be accepted')

    await expect(
      cancelJobCommand({ jobId: accepted.jobId }, { $transaction: database.$transaction.bind(database) })
    ).resolves.toMatchObject({ status: 'CANCELLED' })
    await expect(
      getSourceAuditApplyOperation({ operationId: accepted.operationId }, { database: database as never })
    ).resolves.toMatchObject({
      status: 'CANCELLED',
      terminal: true,
      resultComplete: true,
      progress: 100,
      counts: { failed: 1 },
      items: [{ state: 'FAILED', code: 'OPERATION_CANCELLED', retryable: true }]
    })

    await expect(
      startSourceAuditApply(
        { auditRunId: audit.runId, itemIds: [audit.itemId], idempotencyKey: randomUUID() },
        requestedByUserId,
        applyOptions()
      )
    ).resolves.toMatchObject({ outcome: 'ACCEPTED', reused: false })
  })
})

async function seedWorker(definitionVersions: number[]) {
  const heartbeatAt = new Date()
  await database.workerInstance.create({
    data: {
      workerId,
      status: 'READY',
      serviceVersion: 'postgres-test',
      hostname: 'postgres-test',
      processId: 1,
      capabilities: [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions }],
      startedAt: heartbeatAt,
      heartbeatAt
    }
  })
}

async function seedCompletedSourceAudit() {
  const inventory = await database.pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })
  const job = await database.systemJob.create({
    data: {
      type: 'SCAN',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 2,
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      requestedByUserId,
      idempotencyKey: `${suitePrefix}-audit-${randomUUID()}`,
      payload: { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' },
      finishedAt: new Date()
    }
  })
  const run = await database.scanRun.create({
    data: {
      systemJobId: job.id,
      type: 'PIXIV',
      mode: 'INCREMENTAL',
      operationKind: 'CONSISTENCY_AUDIT',
      status: 'COMPLETED',
      inputFrozenAt: new Date(),
      inventoryBaselineGeneration: inventory.baselineGeneration,
      inputCount: 1,
      auditNewInputs: 1,
      finishedAt: new Date()
    }
  })
  const item = await database.pixivSourceAuditItem.create({
    data: {
      scanRunId: run.id,
      ordinal: 0,
      differenceKind: 'NEW',
      relativePath: 'postgres-101-meta.json',
      expectedExternalId: 'postgres-101',
      observedExternalId: 'postgres-101',
      title: 'Postgres source audit item',
      artistName: 'Postgres artist',
      inventoryId: 'postgres-inventory-101',
      observedContentHash: 'a'.repeat(64),
      sizeBytes: 100n,
      mtimeMs: 200n
    }
  })
  await database.scanRunMetadataInput.create({
    data: {
      scanRunId: run.id,
      ordinal: 0,
      relativePath: 'postgres-101-meta.json',
      contentHash: 'a'.repeat(64),
      sizeBytes: 100n,
      mtimeMs: 200n,
      sourceAuditItemId: item.id,
      auditDifferenceKind: 'NEW',
      expectedExternalId: 'postgres-101',
      expectedInventoryId: 'postgres-inventory-101'
    }
  })
  return { runId: run.id, itemId: item.id }
}

function applyOptions() {
  return {
    database: database as never,
    environment: { CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'true', WORKER_DISPATCH_ENABLED: 'true' },
    getScanRoot: async () => '/postgres-test/source',
    inspectRoot: async () => undefined
  }
}
