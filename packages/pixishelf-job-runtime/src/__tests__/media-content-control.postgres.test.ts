import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../../pixishelf-db/src/index.js'
import { MutableQueueClock } from '../queue-clock.ts'
import { PostgresQueueRepository, type QueueDatabase } from '../queue-repository.ts'
import { hasBlockingMediaContentRecoveryResume } from '../media-content-control.ts'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `media-control-${randomUUID()}`
const now = new Date('2026-10-23T00:00:00Z')
const clock = new MutableQueueClock(now)
const db = () => database!
const repository = () => new PostgresQueueRepository(db() as unknown as QueueDatabase, { clock })

async function job(
  status: 'PENDING' | 'RETRY_WAIT' | 'PAUSED' | 'RUNNING' | 'CANCELLING',
  type = 'VIDEO_STREAMING_OPTIMIZATION'
) {
  const executing = status === 'RUNNING' || status === 'CANCELLING'
  return db().systemJob.create({
    data: {
      id: `${prefix}-${randomUUID()}`,
      type,
      status,
      attempt: 1,
      maxAttempts: 1,
      triggerSource: 'MANUAL',
      availableAt: now,
      payload: {},
      ...(executing ? { workerId: prefix, leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() - 1) } : {}),
      ...(status === 'CANCELLING' ? { cancelRequestedAt: new Date(now.getTime() - 5000) } : {})
    }
  })
}
async function claim(
  jobId: string,
  executionToken: string,
  executionAttempt = 1,
  status: 'ACTIVE' | 'RECOVERY_REQUIRED' | 'COMPLETED' = 'ACTIVE'
) {
  const id = randomUUID()
  return db().mediaContentPathWrite.create({
    data: {
      directory: { create: { logicalRoot: 'source-media:v1', rootIdentity: prefix, relativeDirectory: id } },
      scope: 'PATH',
      relativePath: `${id}/media.mp4`,
      sessionId: `video-remux:${jobId}`,
      sessionVersion: 1n,
      writeToken: randomUUID(),
      jobId,
      executionToken,
      executionAttempt,
      status,
      startedAt: now
    }
  })
}
async function cleanup() {
  await db().mediaContentRecoveryGrant.deleteMany({ where: { jobId: { startsWith: prefix } } })
  await db().mediaContentPathWrite.deleteMany({ where: { jobId: { startsWith: prefix } } })
  await db().mediaContentDirectoryState.deleteMany({ where: { rootIdentity: prefix } })
  await db().archiveImport.deleteMany({ where: { systemJobId: { startsWith: prefix } } })
  await db().systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
}

describe.skipIf(!url)('media content cancellation control PostgreSQL', () => {
  afterEach(cleanup)
  afterAll(async () => database?.$disconnect())

  it.each(['PENDING', 'RETRY_WAIT', 'PAUSED'] as const)(
    'rejects direct cancellation of %s with unresolved writes',
    async (status) => {
      const current = await job(status)
      await claim(current.id, randomUUID(), 1, 'RECOVERY_REQUIRED')
      await expect(repository().requestCancellation(current.id)).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_RECOVERY_REQUIRED'
      })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({
        status,
        cancelRequestedAt: null
      })
      expect(await db().systemJobEvent.count({ where: { jobId: current.id } })).toBe(0)
    }
  )

  it.each(['token', 'attempt'] as const)(
    'rejects running cancellation when another execution %s owns any claim',
    async (mismatch) => {
      const current = await job('RUNNING')
      await claim(current.id, current.leaseToken!)
      await claim(current.id, mismatch === 'token' ? randomUUID() : current.leaseToken!, mismatch === 'attempt' ? 2 : 1)
      await expect(repository().requestCancellation(current.id)).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_RECOVERY_REQUIRED'
      })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ status: 'RUNNING' })
    }
  )

  it('allows the original running execution to cancel and ignores completed old claims', async () => {
    const current = await job('RUNNING')
    await claim(current.id, current.leaseToken!)
    await claim(current.id, randomUUID(), 1, 'COMPLETED')
    expect(await repository().requestCancellation(current.id)).toEqual({ jobId: current.id, status: 'CANCELLING' })
  })

  it.each(['PENDING', 'PAUSED'] as const)(
    'keeps normal direct cancellation for %s without unresolved writes',
    async (status) => {
      const current = await job(status)
      expect(await repository().requestCancellation(current.id)).toEqual({ jobId: current.id, status: 'CANCELLED' })
    }
  )

  it('pauses an expired cancellation, preserves its claim and audit, and requires a grant to resume', async () => {
    const current = await job('CANCELLING')
    const original = await claim(current.id, current.leaseToken!)
    expect(await repository().recoverExpiredExecution()).toMatchObject({ jobId: current.id, status: 'PAUSED' })
    expect(await db().systemJob.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({
      status: 'PAUSED',
      errorCode: 'MEDIA_CONTENT_RECOVERY_REQUIRED',
      message: '取消未完成，需恢复处理',
      cancelRequestedAt: null,
      leaseToken: null,
      finishedAt: null,
      maxAttempts: 2
    })
    expect(await db().mediaContentPathWrite.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original)
    expect(
      await db().systemJobEvent.findFirstOrThrow({ where: { jobId: current.id, type: 'job.paused' } })
    ).toMatchObject({
      data: {
        reason: 'ACTION_REQUIRED',
        previousCancelRequestedAt: current.cancelRequestedAt!.toISOString(),
        cause: 'WORKER_LEASE_EXPIRED_WITH_UNRESOLVED_MEDIA_WRITE'
      }
    })
    expect(await db().$transaction((tx) => hasBlockingMediaContentRecoveryResume(tx, current.id))).toBe(true)
    await db().mediaContentRecoveryGrant.create({
      data: {
        jobId: current.id,
        sessionId: original.sessionId,
        expectedAttempt: 1,
        targetAttempt: 2,
        snapshot: {},
        snapshotSha256: 'a'.repeat(64),
        operator: 'fixture',
        backupCheckpointRef: 'fixture'
      }
    })
    expect(await db().$transaction((tx) => hasBlockingMediaContentRecoveryResume(tx, current.id))).toBe(false)
  })

  it('keeps an archive import PAUSED when its expired cancellation has an unresolved publication', async () => {
    const current = await job('CANCELLING', 'ARCHIVE_PUBLISH')
    await claim(current.id, current.leaseToken!)
    const archive = await db().archiveImport.create({
      data: {
        systemJobId: current.id,
        phase: 'PUBLISH',
        status: 'CANCELLING',
        providerKey: prefix,
        externalId: current.id,
        submittedUrl: 'https://example.test/gallery',
        canonicalUrl: 'https://example.test/gallery',
        locator: {},
        normalizedMetadata: {},
        rawMetadata: {},
        metadataHash: 'a'.repeat(64),
        creatorBucket: prefix,
        stagingPath: `.archive-staging/${current.id}`
      }
    })
    expect(await repository().recoverExpiredExecution()).toMatchObject({ jobId: current.id, status: 'PAUSED' })
    expect(await db().archiveImport.findUniqueOrThrow({ where: { id: archive.id } })).toMatchObject({
      status: 'PAUSED',
      finishedAt: null,
      retainUntil: null
    })
    expect(await db().$transaction((tx) => hasBlockingMediaContentRecoveryResume(tx, current.id))).toBe(false)
  })

  it('still confirms expired cancellation when no claim remains', async () => {
    const current = await job('CANCELLING')
    expect(await repository().recoverExpiredExecution()).toMatchObject({ jobId: current.id, status: 'CANCELLED' })
  })
})
