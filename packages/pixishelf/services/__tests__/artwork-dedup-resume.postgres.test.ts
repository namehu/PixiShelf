// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  db,
  seed,
  prepared,
  cleanupFixture,
  cleanupJobs
} from '../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import { controlArtworkDedupPrepare, getArtworkDedupOperation } from '../artwork-dedup-review-service'
describe.skipIf(!db)('PREPARE paused continuation under the stage-three gate', () => {
  const spawned: string[] = []
  afterEach(async () => {
    await cleanupJobs()
    if (db) await db.systemJob.deleteMany({ where: { id: { in: spawned } } })
  })
  afterAll(cleanupFixture)
  it('only offers a new preview for stale ownership, without capacity or retrying the old inventory', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    await db!.systemJob.update({
      where: { id: execution.jobId },
      data: { status: 'FAILED', leaseExpiresAt: null, leaseToken: null, workerId: null }
    })
    await db!.artworkDedupOperation.update({
      where: { id: execution.operationId },
      data: { status: 'STALE', errorCode: 'OWNERSHIP_CHANGED', logicalBytes: null, version: 2 }
    })
    const request = { expectedUserId: f.actor.id, operationId: execution.operationId }
    const result = await getArtworkDedupOperation(f.actor.id, request, db!)
    expect(result.operation).toMatchObject({
      status: 'STALE',
      counts: { logicalBytes: null },
      allowedActions: ['REPREPARE']
    })
    await expect(
      controlArtworkDedupPrepare(
        f.actor.id,
        { ...request, expectedVersion: 2, idempotencyKey: randomUUID() },
        'RETRY',
        db!
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.artworkDedupOperationArtwork.count({ where: { operationId: execution.operationId } })).toBe(2)
    expect(await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: execution.operationId } })).toMatchObject({
      status: 'STALE',
      version: 2,
      executionVersion: 1
    })
  })
  it('uses the same allowed predicate for DTO and command, retains frozen scope and retries idempotently', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const execution = await db!.$transaction((tx) => prepared(tx, f))
    await db!.systemJob.update({
      where: { id: execution.jobId },
      data: { status: 'PAUSED', leaseExpiresAt: null, leaseToken: null, workerId: null }
    })
    const request = { expectedUserId: f.actor.id, operationId: execution.operationId }
    const command = { ...request, expectedVersion: 1, idempotencyKey: randomUUID() }
    await db!.artworkDedupOperation.update({
      where: { id: execution.operationId },
      data: { readerToken: 'unproven', readerState: 'BLOCKED' }
    })
    expect((await getArtworkDedupOperation(f.actor.id, request, db!)).operation.allowedActions).not.toContain(
      'RETRY_PREPARE'
    )
    await expect(controlArtworkDedupPrepare(f.actor.id, command, 'RETRY', db!)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    // This fixture models the post-proof state; recovery itself is exercised in the DB tests.
    await db!.artworkDedupOperation.update({
      where: { id: execution.operationId },
      data: { readerToken: null, readerState: 'IDLE' }
    })
    expect((await getArtworkDedupOperation(f.actor.id, request, db!)).operation.allowedActions).toContain(
      'RETRY_PREPARE'
    )
    const before = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: execution.operationId } })
    const result = await controlArtworkDedupPrepare(f.actor.id, command, 'RETRY', db!)
    spawned.push(result.jobId!)
    expect(result).toMatchObject({
      operationId: execution.operationId,
      status: 'BUILDING',
      executionVersion: 2,
      version: 2
    })
    expect(result.allowedActions).not.toContain('RETRY_PREPARE')
    expect(await controlArtworkDedupPrepare(f.actor.id, command, 'RETRY', db!)).toEqual(result)
    expect(await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: execution.operationId } })).toEqual(
      before
    )
    expect(await db!.systemJob.findUnique({ where: { id: result.jobId! } })).toMatchObject({
      status: 'PENDING',
      queuePriority: 900,
      executionLane: 'BACKGROUND_WRITER'
    })
    await expect(
      controlArtworkDedupPrepare(f.actor.id, { ...command, idempotencyKey: randomUUID() }, 'RETRY', db!)
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
