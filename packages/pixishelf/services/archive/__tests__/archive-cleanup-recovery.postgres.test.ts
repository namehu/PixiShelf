// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ArchiveMaintenancePayload, WorkerCapability } from '@pixishelf/job-contracts'
import {
  Prisma,
  PrismaClient,
  inspectMediaContentRecovery,
  grantMediaContentRecovery,
  resumeGrantedMediaContentRecovery,
  captureArtworkDedupSources
} from '@pixishelf/db'
import { readExecutorMediaRecoveryDomainSnapshot } from '../../../../pixishelf-job-executors/src/scan/media-content-recovery.ts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMediaContentRoots } from '../../../../pixishelf-job-executors/src/media-content/roots.ts'
import { executeArchiveMaintenance } from '../../../../pixishelf-job-executors/src/archive/maintenance-executor.ts'

import { requestArchiveStagingCleanup } from '../archive-maintenance-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-cleanup-command-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]
const roots: string[] = []
const sourceIds: string[] = []

describePostgres('archive staging cleanup recovery PostgreSQL integration', () => {
  beforeEach(async () => {
    await cleanupDatabase()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    await prisma.$disconnect()
  })

  it.each(['FAILED', 'CANCELLED'] as const)(
    'preserves %s cleanup intent through App and RECONCILE, then recovers the original scope',
    async (status) => {
      const fixture = await interruptedStagingCleanup(status)
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({ status })
      if (status === 'CANCELLED') {
        // Cancellation is not a general recovery bypass: only this original cleanup domain is eligible.
        await db().systemJob.update({
          where: { id: fixture.jobId },
          data: { payload: { action: 'RECONCILE' }, cancelRequestedAt: fixture.now }
        })
        expect(
          await db().$transaction((tx) =>
            inspectMediaContentRecovery(tx, {
              jobId: fixture.jobId,
              sessionId: `archive-cleanup:${fixture.jobId}`,
              now: fixture.now,
              readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
            })
          )
        ).toMatchObject({ status: 'WRITING' })
        await db().systemJob.update({
          where: { id: fixture.jobId },
          data: { payload: { action: 'CLEAN_STAGING', archiveImportId: fixture.importId } }
        })
      }
      const before = await inspectCleanup(fixture)
      const requestedAt = new Date(fixture.now.getTime() + 1_000)
      await expect(
        requestArchiveStagingCleanup(
          { archiveImportId: fixture.importId, requestedByUserId: null, requestedAt },
          { database: db() as never, now: () => requestedAt }
        )
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      const reconcileId = await seedSystemJob(
        `${prefix}-reconcile`,
        'ARCHIVE_MAINTENANCE',
        { action: 'RECONCILE' },
        fixture.now
      )
      const reconcile = (await fixture.repository.claim(`${prefix}-reconciler`, capabilities))!
      expect(reconcile.id).toBe(reconcileId)
      const ctx = executionContext(fixture.repository, reconcile)
      ctx.enqueueChild = vi.fn(async () => {
        throw new Error('unresolved cleanup must not enqueue a replacement')
      })
      await executeArchiveMaintenance(ctx, {
        database: db(),
        config: { scanRoot: fixture.root },
        now: () => requestedAt
      })
      expect(ctx.enqueueChild).not.toHaveBeenCalled()
      expect(await db().archiveImport.findUniqueOrThrow({ where: { id: fixture.importId } })).toMatchObject({
        cleanupRequestedAt: fixture.now,
        generationToken: fixture.token
      })
      expect(
        await db().systemJob.count({
          where: { type: 'ARCHIVE_MAINTENANCE', payload: { path: ['archiveImportId'], equals: fixture.importId } }
        })
      ).toBe(1)
      expect((await inspectCleanup(fixture)).value).toEqual(before.value)
      const grant = await grantMaintenance(fixture, before)
      if (grant.status !== 'READY') throw new Error(`Grant rejected: ${grant.status}`)
      expect(await resumeMaintenance(fixture, grant.value.grantId)).toMatchObject({ status: 'READY' })
      const resumed = (await fixture.repository.claim(`${prefix}-resumed`, capabilities))!
      expect(resumed.id).toBe(fixture.jobId)
      await executeArchiveMaintenance(executionContext(fixture.repository, resumed), {
        database: db(),
        config: { scanRoot: fixture.root }
      })
      expect(await db().archiveImport.findUniqueOrThrow({ where: { id: fixture.importId } })).toMatchObject({
        cleanupRequestedAt: null,
        generationToken: null
      })
      const writes = await db().mediaContentPathWrite.findMany({
        where: { jobId: fixture.jobId },
        orderBy: { id: 'asc' }
      })
      expect(writes.map(({ id, writeToken }) => ({ id, writeToken }))).toEqual(
        fixture.oldClaims.map(({ id, writeToken }) => ({ id, writeToken }))
      )
      expect(writes.every((write) => write.status === 'COMPLETED')).toBe(true)
    }
  )
})

async function interruptedStagingCleanup(status: 'FAILED' | 'CANCELLED') {
  const root = await temporaryRoot(),
    now = new Date(),
    token = randomUUID()
  const importId = `${prefix}-recovery-import`,
    importJobId = `${prefix}-recovery-download`
  const stagingPath = `.archive-staging/${importId}--${token}`
  const finalPath = `sources/test/bucket/${prefix}/revisions/${importId}`
  await seedSystemJob(importJobId, 'ARCHIVE_IMPORT', { archiveImportId: importId }, now, 'COMPLETED')
  const source = (
    await db().$transaction((tx) =>
      captureArtworkDedupSources(tx, {
        identities: [{ kind: 'PROVIDER', providerKey: 'test', externalId: prefix }]
      })
    )
  )[0]!
  sourceIds.push(source.sourceId)
  await db().archiveImport.create({
    data: {
      id: importId,
      systemJobId: importJobId,
      providerKey: 'test',
      externalId: prefix,
      submittedUrl: 'https://example.test/cleanup',
      canonicalUrl: 'https://example.test/cleanup',
      locator: {},
      status: 'FAILED',
      phase: 'DOWNLOAD',
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'bucket',
      stagingPath,
      generationToken: token,
      cleanupRequestedAt: now
    }
  })
  await db().archiveStagingGeneration.create({
    data: { token, archiveImportId: importId, jobId: importJobId, path: stagingPath, drainedAt: now }
  })
  await db().archiveImportItem.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      id: `${importId}-item-${String(index).padStart(3, '0')}`,
      archiveImportId: importId,
      pageIndex: index,
      sourcePageUrl: 'https://example.test/',
      locator: {},
      expectedFilename: `file-${index}.jpg`
    }))
  })
  await writeFixture(root, `${stagingPath}/checkpoint`)
  await writeFixture(root, 'neighbor/checkpoint')
  const jobId = await seedSystemJob(
    `${prefix}-recovery-cleanup`,
    'ARCHIVE_MAINTENANCE',
    { action: 'CLEAN_STAGING', archiveImportId: importId },
    now
  )
  const repository = new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    leaseDurationMs: 60_000,
    transactionTimeoutMs: 20_000
  })
  const job = (await repository.claim(`${prefix}-cleanup-first`, capabilities))!
  expect(job.id).toBe(jobId)
  const original = executionContext(repository, job),
    crashed = { ...original }
  crashed.finalizeInTransaction = async () => {
    throw new Error('injected cleanup after files')
  }
  await expect(executeArchiveMaintenance(crashed, { database: db(), config: { scanRoot: root } })).rejects.toThrow(
    'injected cleanup'
  )
  // Actual executor return precedes pause/release; lease expiry is never used as exit evidence.
  await original.finalizeInTransaction(async (scope) => {
    if (status === 'FAILED') await scope.fail({ errorCode: 'INTERNAL_ERROR', error: 'Synthetic interrupted cleanup' })
    else await scope.cancel('Synthetic cancelled cleanup')
  })
  const oldClaims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
  expect(oldClaims).toHaveLength(2)
  expect(oldClaims.every((claim) => claim.status === 'ACTIVE')).toBe(true)
  return { root, now, token, importId, stagingPath, finalPath, jobId, repository, oldClaims, sourceId: source.sourceId }
}

async function inspectCleanup(fixture: { jobId: string; now: Date }) {
  const result = await db().$transaction((tx) =>
    inspectMediaContentRecovery(tx, {
      jobId: fixture.jobId,
      sessionId: `archive-cleanup:${fixture.jobId}`,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
  if (result.status !== 'READY') throw new Error(`Inspect rejected: ${result.status}`)
  return result
}

function grantMaintenance(fixture: { now: Date }, inspection: Awaited<ReturnType<typeof inspectCleanup>>) {
  return db().$transaction((tx) =>
    grantMediaContentRecovery(tx, {
      snapshot: inspection.value.snapshot,
      expectedDigest: inspection.value.digest,
      backupCheckpointRef: 'disposable-large-fixture-checkpoint',
      operator: 'fixture-operator',
      confirmAllWritersStopped: true,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
}

function resumeMaintenance(fixture: { now: Date }, grantId: string) {
  return db().$transaction((tx) =>
    resumeGrantedMediaContentRecovery(tx, {
      grantId,
      operator: 'fixture-operator',
      confirmAllWritersStopped: true,
      now: fixture.now,
      readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot
    })
  )
}

async function seedSystemJob(
  id: string,
  type: 'ARCHIVE_IMPORT' | 'ARCHIVE_MAINTENANCE',
  payload: Record<string, unknown>,
  now: Date,
  status: 'PENDING' | 'COMPLETED' = 'PENDING'
) {
  await db().systemJob.create({
    data: {
      id,
      type,
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status,
      triggerSource: type === 'ARCHIVE_MAINTENANCE' ? 'MANUAL' : 'SYSTEM',
      payload: payload as Prisma.InputJsonValue,
      queuePriority: 0,
      effectivePriority: 0,
      availableAt: now,
      maxAttempts: 3,
      ...(status === 'COMPLETED' ? { finishedAt: now, progress: 100 } : {})
    }
  })
  return id
}

function executionContext(repository: PostgresQueueRepository, job: ClaimedJob) {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  const context: ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob> = {
    job,
    payload: job.payload as ArchiveMaintenancePayload,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('archive maintenance does not enqueue child jobs')
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

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.artworkDedupSourceIdentity.deleteMany({ where: { id: { in: sourceIds } } })
  sourceIds.length = 0
  await prisma.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: prefix } })
  await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
  await prisma.mediaContentRecoveryGrant.deleteMany({ where: { jobId: { startsWith: prefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  // Test executors have returned before cleanup; remove only these synthetic roots' durable claims.
  for (const root of roots) {
    const binding = await resolveMediaContentRoots({
      sourceRoot: root,
      archiveRoot: root,
      expectedPixivRootIdentity: null
    })
    await prisma.mediaContentPathWrite.deleteMany({
      where: { directory: { rootIdentity: binding.source.rootIdentity } }
    })
    await prisma.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: binding.source.rootIdentity } })
  }
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-maintenance-pg-'))
  roots.push(root)
  return root
}

async function writeFixture(root: string, relativePath: string) {
  const target = path.join(root, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'fixture')
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
