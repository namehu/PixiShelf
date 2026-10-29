// @vitest-environment node
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isArtworkDedupPrepareRetryable, freezeArtworkDedupOperation } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
// Only this trusted fixture module enables the unreleased branch; production constants stay closed.
vi.mock('@pixishelf/job-contracts', async (original) => {
  const actual = await original<typeof import('@pixishelf/job-contracts')>()
  const enabled: typeof actual.isArtworkDedupMaintenanceModeEnabled = (mode, purpose) =>
    mode === 'DIRECT_DELETE' ||
    purpose === 'DIRECT_DELETE' ||
    actual.isArtworkDedupMaintenanceModeEnabled(mode, purpose)
  return {
    ...actual,
    isArtworkDedupMaintenanceModeEnabled: enabled,
    assertArtworkDedupMaintenanceModeEnabled: (
      mode: Parameters<typeof enabled>[0],
      purpose: Parameters<typeof enabled>[1]
    ) => {
      if (!enabled(mode, purpose)) throw new Error('ARTWORK_DEDUP_MODE_DISABLED')
    }
  }
})
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-executor-fixture')).db
}))
import { type ArtworkDedupMaintenancePayload, type ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { artworkDedupRouter } from '@/server/routers/artwork-dedup'
import type { Context } from '@/server/context'
import { loadReaderIndex } from '@/services/artwork-service/reader'
import { listArchiveTrash } from '@/services/archive/archive-trash-service'
import { directDeleteArtworkDedupOperation } from '@/services/artwork-dedup-review-service'
import { freezeOldReimportIntent } from './artwork-dedup-reimport-fixture'
import { executeArtworkDedupMaintenance } from '../../../pixishelf-job-executors/src/artwork-dedup/maintenance-executor'
import { executeArtworkDedupDirectDelete } from '../../../pixishelf-job-executors/src/artwork-dedup/direct-delete'
import {
  db,
  fixture,
  repository,
  executionContext,
  readerOptions,
  root,
  clock,
  fence,
  trackMaintenanceJob
} from '../../../pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-executor-fixture'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !['/dedup_executor_next', '/dedup_containment_test', '/dedup_partial_core', '/dedup_confirm_core_20261029'].includes(target.pathname))
    {throw new Error('Use the authorized synthetic executor database')}
}
const dependencies = () => ({
  database: db!,
  sourceRoot: root,
  archiveRoot: root,
  readerOptions,
  now: () => clock.now().getTime()
})
const command = (op: ArtworkDedupOperationDto, userId: string) => ({
  expectedUserId: userId,
  operationId: op.operationId,
  expectedVersion: op.version,
  idempotencyKey: randomUUID()
})
const confirmation = (op: ArtworkDedupOperationDto, userId: string) => ({
  ...command(op, userId),
  purpose: 'DIRECT_DELETE' as const,
  protocolVersion: (op.protocolVersion ?? 1) as 1 | 2,
  scopeDigest: op.scopeDigest!,
  externalWritesStopped: true as const,
  permanentDeleteConfirmed: true as const,
  organizationImpactConfirmed: true as const
})
function callerFor(userId: string) {
  const context = {
    headers: new Headers({ 'x-forwarded-for': userId }),
    user: { id: userId },
    session: { id: `${userId}-session` },
    userId
  } as Context
  return artworkDedupRouter.createCaller(context)
}
async function claim(jobId: string) {
  clock.advance(Math.max(0, Date.now() + 1000 - clock.now().getTime()))
  const job = await repository!.claim('dedup-b2-app', [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [5, 6] }
  ])
  expect(job?.id).toBe(jobId)
  return job!
}
describe.skipIf(!db)('direct-delete App transaction and projection', () => {
  it('projects containment through the existing router and freezes preparation v2/protocol2 before deleting only the subset', async () => {
    const f = await fixture(2, 'LOCAL_DIRECTORY', { purpose: 'DIRECT_DELETE', beforeScan: async (ids) => {
      const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1] } })
      const extra = `${path.posix.dirname(image.path)}/extra.bin`
      await fs.writeFile(path.join(root, extra), 'extra')
      await db!.image.create({ data: { artworkId: ids[1]!, path: extra } })
    } })
    await f.close()
    const original = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
    const caller = callerFor(original.requestedBy)
    const page = await caller.listGroups({ expectedUserId: original.requestedBy, runId: original.runId, limit: 1 })
    if (page.kind !== 'GROUPS') throw new Error('Expected groups')
    expect(page.totalGroups).toBe(1)
    expect(page.items[0]).toMatchObject({ relationKind: 'CONTAINS', containedArtworkId: f.ids[0], containerArtworkId: f.ids[1], containedFileCount: '2', containerFileCount: '3', extraFileCount: '1' })
    const result = page.items[0]!
    const members = await caller.listGroups({ expectedUserId: original.requestedBy, runId: original.runId, groupId: result.groupId, limit: 1 })
    expect(members.kind).toBe('MEMBERS')
    if (members.kind !== 'MEMBERS') throw new Error('Expected members')
    expect(members.nextMemberCursor).not.toBeNull()
    const next = await caller.listGroups({ expectedUserId: original.requestedBy, runId: original.runId, groupId: result.groupId, memberCursor: members.nextMemberCursor!, limit: 1 })
    expect(next.items).toHaveLength(1)
    await expect(caller.saveReview({ expectedUserId: original.requestedBy, runId: original.runId, groupId: result.groupId, keeperArtworkId: f.ids[0]!, expectedRunVersion: page.runVersion, expectedReviewVersion: 0, idempotencyKey: randomUUID() })).rejects.toThrow()
    const workerId = `containment-app-${randomUUID()}`
    await db!.workerInstance.create({ data: { workerId, status: 'READY', heartbeatAt: new Date(), hostname: 'fixture', processId: process.pid, serviceVersion: 'fixture', capabilities: [{ jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [5, 6] }] } })
    try {
      const building = await caller.prepareCleanup({ expectedUserId: original.requestedBy, purpose: 'DIRECT_DELETE', protocolVersion: 1, runId: original.runId, expectedRunVersion: page.runVersion, expectedReviewRevision: 0, selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }, idempotencyKey: randomUUID() })
      expect(building).toMatchObject({ preparationVersion: 2, status: 'READY', jobId: null })
      expect(building.protocolVersion).toBe(2)
      expect(await repository!.claim('old-exact-worker', [{ jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2] }])).toBeNull()
      const ready = (await caller.getOperation({ expectedUserId: original.requestedBy, operationId: building.operationId })).operation
      expect(ready).toMatchObject({ status: 'READY', protocolVersion: 2 })
      await expect(caller.directDelete({ ...confirmation(ready, original.requestedBy), protocolVersion: 1 })).rejects.toThrow()
      const deleting = await caller.directDelete(confirmation(ready, original.requestedBy))
      trackMaintenanceJob(deleting.jobId!)
      await executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(await claim(deleting.jobId!)), dependencies())
      expect(await db!.artwork.findUnique({ where: { id: f.ids[0]! } })).toBeNull()
      expect(await db!.image.count({ where: { artworkId: f.ids[1]! } })).toBe(3)
    } finally { await db!.workerInstance.delete({ where: { workerId } }) }
  }, 30_000)
  it('replays a PREPARE retry receipt offline and after DIRECT_DELETE without new work', async () => {
    const f = await fixture(1)
    await f.close()
    const legacy = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
    const caller = callerFor(legacy.requestedBy)
    const workerId = `dedup-b2-retry-replay-${randomUUID()}`
    await db!.workerInstance.create({
      data: {
        workerId,
        status: 'READY',
        heartbeatAt: new Date(),
        hostname: 'fixture',
        processId: process.pid,
        serviceVersion: 'fixture',
        capabilities: [{ jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [5, 6] }]
      }
    })
    try {
      expect(isArtworkDedupPrepareRetryable(legacy, await db!.systemJob.findUniqueOrThrow({ where: { id: legacy.jobId! } }), new Date())).toBe(true)
      const legacyId = await db!.$transaction(async tx => {
        const { operation } = await freezeArtworkDedupOperation(tx, { userId: legacy.requestedBy, preparePurpose: 'DIRECT_DELETE', runId: legacy.runId, expectedRunVersion: legacy.runVersion, expectedReviewRevision: 0, selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }, idempotencyKey: randomUUID() })
        const job = await tx.systemJob.create({ data: { type: 'ARTWORK_DEDUP_MAINTENANCE', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: clock.now(), payload: { operationId: operation.id, executionVersion: 1, mode: 'PREPARE', purpose: 'DIRECT_DELETE', protocolVersion: 1 } } })
        await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { jobId: job.id } })
        return operation.id
      })
      const building = (await caller.getOperation({ expectedUserId: legacy.requestedBy, operationId: legacyId })).operation
      trackMaintenanceJob(building.jobId!)
      const firstJob = await claim(building.jobId!)
      await repository!.fail({ ...fence(firstJob), errorCode: 'INTERNAL_ERROR', error: 'synthetic PREPARE failure' })
      const failed = (await caller.getOperation({ operationId: building.operationId, expectedUserId: legacy.requestedBy })).operation
      expect(failed).toMatchObject({ status: 'FAILED', preparePurpose: 'DIRECT_DELETE' })
      expect(failed.allowedActions).toContain('RETRY_PREPARE')
      const failedOperation = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: failed.operationId } })
      const failedJob = await db!.systemJob.findUniqueOrThrow({ where: { id: failed.jobId! } })
      expect(isArtworkDedupPrepareRetryable(failedOperation, failedJob, new Date())).toBe(true)
      expect(isArtworkDedupPrepareRetryable({ ...failedOperation, protocolVersion: null }, failedJob, new Date())).toBe(false)
      expect(isArtworkDedupPrepareRetryable(failedOperation, { ...failedJob, definitionVersion: 1 }, new Date())).toBe(false)
      expect(isArtworkDedupPrepareRetryable(failedOperation, { ...failedJob, payload: { operationId: failed.operationId, executionVersion: failed.executionVersion, mode: 'PREPARE' } }, new Date())).toBe(false)
      expect(isArtworkDedupPrepareRetryable({ ...failedOperation, readerToken: 'still-running' }, failedJob, new Date())).toBe(false)
      const retry = command(failed, legacy.requestedBy)
      const retried = await caller.retryOperation(retry)
      trackMaintenanceJob(retried.jobId!)
      expect(retried.executionVersion).toBe(failed.executionVersion + 1)
      const counts = async () => ({
        jobs: await db!.systemJob.count({ where: { type: 'ARTWORK_DEDUP_MAINTENANCE', payload: { path: ['operationId'], equals: failed.operationId } } }),
        commands: await db!.artworkDedupCommand.count({ where: { operationId: failed.operationId } })
      })
      const beforeOffline = await counts()
      expect(beforeOffline).toEqual({ jobs: 2, commands: 1 })
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'STOPPING' } })
      expect(await caller.retryOperation(retry)).toMatchObject({ operationId: retried.operationId, jobId: retried.jobId, executionVersion: retried.executionVersion, version: retried.version })
      await expect(caller.retryOperation({ ...retry, expectedVersion: retry.expectedVersion + 1 })).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(caller.retryOperation({ ...command(retried, legacy.requestedBy) })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
      expect(await counts()).toEqual(beforeOffline)
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'READY' } })
      await expect(caller.retryOperation({ ...retry, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' })
      await executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(await claim(retried.jobId!)), dependencies())
      const ready = (await caller.getOperation({ operationId: failed.operationId, expectedUserId: legacy.requestedBy })).operation
      expect(ready.status).toBe('READY')
      const started = await caller.directDelete(confirmation(ready, legacy.requestedBy))
      trackMaintenanceJob(started.jobId!)
      const beforeAdvancedReplay = await counts()
      expect(beforeAdvancedReplay).toEqual({ jobs: 3, commands: 2 })
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'STOPPING' } })
      expect(await caller.retryOperation(retry)).toMatchObject({ operationId: started.operationId, jobId: started.jobId, mode: 'DIRECT_DELETE', executionVersion: started.executionVersion, version: started.version })
      await expect(caller.retryOperation({ ...retry, expectedVersion: retry.expectedVersion + 1 })).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(caller.cancelOperation(retry)).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(await counts()).toEqual(beforeAdvancedReplay)
      expect(await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: started.operationId } })).toMatchObject({ executionVersion: started.executionVersion, version: started.version, jobId: started.jobId })
      // Retire the queued deletion through its own domain control before the next fixture claims the lane.
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'READY' } })
      await caller.cancelOperation(command(started, legacy.requestedBy))
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(await claim(started.jobId!)), dependencies())
      expect((await caller.getOperation({ operationId: started.operationId, expectedUserId: legacy.requestedBy })).operation.status).toBe('CANCELLED')
    } finally {
      await db!.workerInstance.deleteMany({ where: { workerId } })
    }
  }, 30000)
  it('retains executable v1 ISOLATION preview but refuses v1 PREPARE against a DIRECT_DELETE operation and old preview authorization', async () => {
    const legacy = await fixture(1)
    await legacy.detachReader()
    await executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(legacy.job), dependencies())
    await legacy.close()
    const op = await db!.artworkDedupOperation.findUniqueOrThrow({
      where: { id: legacy.context.execution.operationId }
    })
    expect(op).toMatchObject({ status: 'READY', preparePurpose: 'ISOLATION', protocolVersion: null })
    const caller = callerFor(op.requestedBy)
    // An available v2 Worker cannot upgrade a legacy READY into delete authority.
    const workerId = `dedup-b2-version-${randomUUID()}`
    await db!.workerInstance.create({
      data: {
        workerId,
        status: 'READY',
        heartbeatAt: new Date(),
        hostname: 'fixture',
        processId: process.pid,
        serviceVersion: 'fixture',
        capabilities: [
          { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [5, 6] }
        ]
      }
    })
    try {
      const dto = (await caller.getOperation({ operationId: op.id, expectedUserId: op.requestedBy })).operation
      await expect(
        caller.directDelete({ ...confirmation(dto, op.requestedBy), scopeDigest: 'a'.repeat(64) })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      const modern = await fixture(1, 'LOCAL_DIRECTORY', { purpose: 'DIRECT_DELETE' })
      await modern.detachReader()
      await executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(modern.job), dependencies())
      expect(
        await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: modern.context.execution.operationId } })
      ).toMatchObject({ status: 'FAILED', errorCode: 'DIRECT_DELETE_PROTOCOL_REQUIRED' })
      expect(
        await db!.artworkDedupFileReceipt.count({ where: { operationId: modern.context.execution.operationId } })
      ).toBe(0)
      await modern.close()
      const modernOp = await db!.artworkDedupOperation.findUniqueOrThrow({
        where: { id: modern.context.execution.operationId }
      })
      const preparing = await caller.prepareCleanup({
        expectedUserId: op.requestedBy,
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        runId: modernOp.runId,
        expectedRunVersion: modernOp.runVersion,
        expectedReviewRevision: 0,
        selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] },
        idempotencyKey: randomUUID()
      })
      expect(preparing).toMatchObject({ preparationVersion: 2, status: 'READY', jobId: null })
      const ready = (await caller.getOperation({ operationId: preparing.operationId, expectedUserId: op.requestedBy }))
        .operation
      const started = await caller.directDelete(confirmation(ready, op.requestedBy))
      trackMaintenanceJob(started.jobId!)
      const stop = command(started, op.requestedBy)
      const stopping = await caller.cancelOperation(stop)
      expect((await caller.cancelOperation(stop)).jobId).toBe(started.jobId)
      expect(stopping.jobId).toBe(started.jobId)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: started.jobId! } })).status).toBe('PENDING')
      await executeArtworkDedupDirectDelete(
        executionContext<ArtworkDedupMaintenancePayload>(await claim(started.jobId!)),
        dependencies()
      )
      const cancelled = await caller.getOperation({
        operationId: started.operationId,
        expectedUserId: op.requestedBy,
        preview: { kind: 'ARTWORKS', limit: 100 }
      })
      expect(cancelled.operation).toMatchObject({ status: 'CANCELLED', counts: { deletedFiles: '0' } })
      expect(
        cancelled.preview?.kind === 'ARTWORKS' &&
          cancelled.preview.items.filter((item) => item.role === 'COPY').every((item) => item.status === 'CANCELLED')
      ).toBe(true)
      expect(await db!.artworkDedupClaim.count({ where: { operationId: started.operationId } })).toBe(0)
    } finally {
      await db!.workerInstance.deleteMany({ where: { workerId } })
    }
  }, 30000)
  it('freezes unloaded groups, binds v6 and Session, stops partial work and keeps deleted snapshots and current generations', async () => {
    const f = await fixture(2, 'LOCAL_DIRECTORY', { purpose: 'DIRECT_DELETE', groups: 3 })
    await f.close()
    const original = await db!.artworkDedupOperation.findUniqueOrThrow({
      where: { id: f.context.execution.operationId }
    })
    const caller = callerFor(original.requestedBy)
    const workerId = `dedup-b2-app-${randomUUID()}`
    await db!.workerInstance.create({
      data: {
        workerId,
        status: 'READY',
        heartbeatAt: new Date(),
        hostname: 'fixture',
        processId: process.pid,
        serviceVersion: 'fixture',
        capabilities: [
          { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
        ]
      }
    })
    try {
      const firstPage = await caller.listGroups({
        expectedUserId: original.requestedBy,
        runId: original.runId,
        limit: 1
      })
      expect(firstPage.kind).toBe('GROUPS')
      if (firstPage.kind !== 'GROUPS') throw new Error('Expected groups')
      expect(firstPage.totalGroups).toBe(3)
      expect(firstPage.nextCursor).not.toBeNull()
      const excluded = firstPage.items[0]!.groupId
      const input = {
        purpose: 'DIRECT_DELETE' as const,
        protocolVersion: 1 as const,
        expectedUserId: original.requestedBy,
        runId: original.runId,
        expectedRunVersion: original.runVersion,
        expectedReviewRevision: firstPage.reviewRevision,
        selection: { kind: 'ALL_RECOMMENDED' as const, excludedGroupIds: [excluded] },
        idempotencyKey: randomUUID()
      }
      await expect(caller.prepareCleanup(input)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
      expect(await db!.artworkDedupOperation.count({ where: { runId: original.runId } })).toBe(1)
      await db!.workerInstance.update({
        where: { workerId },
        data: {
          capabilities: [
            { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2, 3, 4, 5, 6] }
          ]
        }
      })
      await expect(caller.prepareCleanup({ ...input, expectedUserId: 'switched' })).rejects.toMatchObject({
        code: 'FORBIDDEN'
      })
      const building = await caller.prepareCleanup(input)
      expect(building).toMatchObject({ preparationVersion: 2, status: 'READY', jobId: null })
      expect((await caller.prepareCleanup(input)).jobId).toBe(building.jobId)
      const frozen = await db!.artworkDedupOperationGroup.findMany({
        where: { operationId: building.operationId, status: 'SELECTED' }
      })
      expect(frozen).toHaveLength(2)
      expect(frozen.every((group) => group.groupId !== excluded)).toBe(true)
      expect(await db!.systemJob.count({ where: { payload: { path: ['operationId'], equals: building.operationId } } })).toBe(0)
      expect(
        await repository!.claim('old-worker', [
          { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
        ])
      ).toBeNull()
      let response = await caller.getOperation({
        expectedUserId: original.requestedBy,
        operationId: building.operationId,
        preview: { kind: 'ARTWORKS', limit: 100 }
      })
      expect(response.operation).toMatchObject({
        preparePurpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        status: 'READY',
        counts: {
          selectedGroups: 2,
          excludedGroups: 1,
          keepers: 2,
          copies: 2,
          preparedFiles: '8',
          remainingFiles: '4'
        },
        allowedActions: ['DIRECT_DELETE']
      })
      expect(response.operation.scopeDigest).toMatch(/^[a-f0-9]{64}$/)
      const ready = response.operation
      const reimport = await freezeOldReimportIntent(ready.operationId)
      const rolledBack = confirmation(ready, original.requestedBy)
      await expect(
        directDeleteArtworkDedupOperation(original.requestedBy, rolledBack, {
          $transaction: (body) =>
            db!.$transaction((tx) =>
              body(
                new Proxy(tx, {
                  get(target, key, receiver) {
                    if (key === 'systemJob')
                      {return {
                        create: async () => {
                          throw new Error('synthetic enqueue failure')
                        }
                      }}
                    return Reflect.get(target, key, receiver)
                  }
                })
              )
            )
        })
      ).rejects.toThrow('synthetic enqueue failure')
      expect(
        (await caller.getOperation({ operationId: ready.operationId, expectedUserId: original.requestedBy })).operation
      ).toMatchObject({ status: 'READY', version: ready.version })
      expect(
        await db!.artworkDedupCommand.count({
          where: { requestedBy: original.requestedBy, idempotencyKey: rolledBack.idempotencyKey }
        })
      ).toBe(0)
      await expect(
        caller.directDelete({ ...confirmation(ready, original.requestedBy), expectedVersion: ready.version + 1 })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(
        caller.directDelete({ ...confirmation(ready, original.requestedBy), scopeDigest: 'f'.repeat(64) })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      const confirm = confirmation(ready, original.requestedBy)
      await expect(callerFor('switched').directDelete(confirm)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      const started = await caller.directDelete(confirm)
      trackMaintenanceJob(started.jobId!)
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'STOPPING' } })
      expect((await caller.directDelete(confirm)).jobId).toBe(started.jobId)
      expect((await caller.prepareCleanup(input)).jobId).toBe(started.jobId)
      await db!.workerInstance.update({ where: { workerId }, data: { status: 'READY' } })
      await expect(caller.directDelete({ ...confirm, scopeDigest: 'e'.repeat(64) })).rejects.toMatchObject({
        code: 'CONFLICT'
      })
      expect(await db!.systemJob.count({ where: { id: started.jobId! } })).toBe(1)
      const deleteJob = await claim(started.jobId!)
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(deleteJob), {
        ...dependencies(),
        onDirectDeleteBoundary: async (boundary) => {
          if (boundary === 'RECEIPTED') throw new Error('synthetic partial failure')
        }
      })
      response = await caller.getOperation({
        expectedUserId: original.requestedBy,
        operationId: ready.operationId,
        preview: { kind: 'ARTWORKS', limit: 100 }
      })
      expect(response.operation).toMatchObject({
        status: 'RECOVERY_REQUIRED',
        counts: { deletedFiles: '1', remainingFiles: '3', completedCopies: 0, remainingCopies: 2 }
      })
      expect(response.operation.allowedActions).toContain('STOP')
      if (response.preview?.kind !== 'ARTWORKS') throw new Error('Expected artworks')
      for (const item of response.preview.items) {
        if (item.role === 'COPY')
          {await expect(db!.$transaction((tx) => loadReaderIndex(tx as never, item.artworkId))).rejects.toMatchObject({
            code: 'NOT_FOUND'
          })}
        else
          {expect(
            (await db!.$transaction((tx) => loadReaderIndex(tx as never, item.artworkId))).index.items
          ).toHaveLength(2)}
      }
      await expect(
        caller.retryOperation({ ...command(response.operation, original.requestedBy), itemIds: [f.ids[0]!] })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      const stopping = await caller.cancelOperation(command(response.operation, original.requestedBy))
      trackMaintenanceJob(stopping.jobId!)
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: stopping.jobId! } })).status).toBe('PENDING')
      const stopJob = await claim(stopping.jobId!)
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(stopJob), dependencies())
      response = await caller.getOperation({ expectedUserId: original.requestedBy, operationId: ready.operationId })
      expect(response.operation).toMatchObject({
        status: 'STOPPED',
        counts: { deletedFiles: '1', remainingFiles: '3' },
        allowedActions: ['RETRY_OPERATION']
      })
      const retry = await caller.retryOperation(command(response.operation, original.requestedBy))
      trackMaintenanceJob(retry.jobId!)
      await executeArtworkDedupDirectDelete(
        executionContext<ArtworkDedupMaintenancePayload>(await claim(retry.jobId!)),
        dependencies()
      )
      response = await caller.getOperation({
        expectedUserId: original.requestedBy,
        operationId: ready.operationId,
        preview: { kind: 'ARTWORKS', limit: 100 }
      })
      expect(response.operation).toMatchObject({
        status: 'DELETED',
        counts: { deletedFiles: '4', remainingFiles: '0', completedCopies: 2, remainingCopies: 0 },
        allowedActions: ['ALLOW_REIMPORT']
      })
      if (response.preview?.kind !== 'ARTWORKS') throw new Error('Expected artworks')
      const copies = response.preview.items.filter((item) => item.role === 'COPY')
      expect(copies).toHaveLength(2)
      expect(
        copies.every(
          (item) => item.title.startsWith('prepare-executor-') && item.status === 'DELETED' && item.canAllowReimport
        )
      ).toBe(true)
      const source = copies[0]!.sources.find((item) => item.status === 'TOMBSTONE')!
      await reimport.assertTombstone()
      await expect(
        caller.allowReimport({
          ...command(response.operation, original.requestedBy),
          sources: [{ sourceId: source.sourceId, expectedGeneration: (BigInt(source.generation) + 1n).toString() }]
        })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      const allow = {
        ...command(response.operation, original.requestedBy),
        sources: copies[0]!.sources
          .filter((item) => item.status === 'TOMBSTONE')
          .map((item) => ({ sourceId: item.sourceId, expectedGeneration: item.generation }))
      }
      const reopened = await caller.allowReimport(allow)
      expect((await caller.allowReimport(allow)).version).toBe(reopened.version)
      const after = await caller.getOperation({
        expectedUserId: original.requestedBy,
        operationId: ready.operationId,
        preview: { kind: 'ARTWORKS', limit: 100 }
      })
      expect(
        after.preview?.kind === 'ARTWORKS' &&
          after.preview.items.flatMap((item) => item.sources).find((item) => item.sourceId === source.sourceId)
      ).toMatchObject({ generation: (BigInt(source.generation) + 1n).toString(), status: 'OPEN' })
      expect(JSON.stringify(after)).not.toContain(root)
      expect(JSON.stringify(after)).not.toContain('contentSha256')
      await reimport.assertNewIntentOnly()
    } finally {
      await db!.workerInstance.deleteMany({ where: { workerId } })
    }
  }, 60000)
  it('excludes hidden ACTIVE copies from ordinary archive trash while retaining normal trash states', async () => {
    const prefix = `dedup-b2-trash-${randomUUID()}`
    const ids: number[] = []
    try {
      for (const archiveLifecycleState of ['ACTIVE', 'TRASHING', 'TRASHED'] as const) {
        ids.push(
          (
            await db!.artwork.create({
              data: {
                title: prefix,
                source: 'URL_ARCHIVE',
                createdVia: 'URL_ARCHIVE',
                deletedAt: new Date(),
                archiveLifecycleState
              }
            })
          ).id
        )
      }
      const result = await listArchiveTrash({ search: prefix }, db!)
      expect(result.items.map((item) => item.id).sort()).toEqual(ids.slice(1).sort())
      expect(result.items.every((item) => item.lifecycleState !== 'ACTIVE')).toBe(true)
    } finally {
      await db!.artwork.deleteMany({ where: { id: { in: ids } } })
    }
  })
})
