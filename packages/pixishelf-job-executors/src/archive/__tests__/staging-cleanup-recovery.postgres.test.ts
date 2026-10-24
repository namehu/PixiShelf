import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
import { readExecutorMediaRecoveryDomainSnapshot } from '../../scan/media-content-recovery.ts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase,
  type QueueSqlExecutor,
  type FencedExecutionTransaction
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import { executeArchiveMaintenance } from '../maintenance-executor.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-cleanup-recovery-${randomUUID()}`
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

  it.each(['before-files', 'after-files', 'inside-finalizer'] as const)(
    'CLEAN_STAGING resumes original declarations after %s failure',
    async (failure) => {
      const fixture = await interruptedStagingCleanup(failure)
      const { root, stagingPath, importId, token, jobId, repository, oldClaims } = fixture
      if (failure === 'before-files') {
        expect(await readFile(path.join(root, stagingPath, 'checkpoint'), 'utf8')).toBe('fixture')
      } else {
        await expect(readFile(path.join(root, stagingPath, 'checkpoint'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(await db().archiveImport.findUniqueOrThrow({ where: { id: importId } })).toMatchObject({
        cleanupRequestedAt: fixture.now,
        generationToken: token
      })
      expect(await db().archiveStagingGeneration.findUniqueOrThrow({ where: { token } })).toMatchObject({
        cleanedAt: null
      })
      const inspection = await inspectCleanup(fixture)
      const granted = await grantMaintenance(fixture, inspection)
      if (granted.status !== 'READY') throw new Error(`Grant rejected: ${granted.status}`)
      expect(await resumeMaintenance(fixture, granted.value.grantId)).toMatchObject({ status: 'READY' })
      const second = (await repository.claim(`${prefix}-cleanup-resume`, capabilities))!
      expect(second.id).toBe(jobId)
      await executeArchiveMaintenance(executionContext(repository, second), {
        database: db(),
        config: { scanRoot: root },
        now: () => fixture.now
      })
      const claims = await db().mediaContentPathWrite.findMany({ where: { jobId }, orderBy: { id: 'asc' } })
      expect(claims.map(({ id, writeToken, directoryId }) => ({ id, writeToken, directoryId }))).toEqual(
        oldClaims.map(({ id, writeToken, directoryId }) => ({ id, writeToken, directoryId }))
      )
      expect(
        claims.every(
          (claim, index) =>
            claim.status === 'COMPLETED' && claim.declarationVersion === oldClaims[index]!.declarationVersion + 2n
        )
      ).toBe(true)
      expect(await db().systemJobEvent.count({ where: { jobId, type: 'archive.cleanup.checkpoint' } })).toBe(1)
      expect(await db().archiveImport.findUniqueOrThrow({ where: { id: importId } })).toMatchObject({
        cleanupRequestedAt: null,
        generationToken: null
      })
      expect(await db().archiveStagingGeneration.findUniqueOrThrow({ where: { token } })).toMatchObject({
        cleanedAt: fixture.now
      })
      expect(await readFile(path.join(root, 'neighbor/checkpoint'), 'utf8')).toBe('fixture')
    }
  )

  it.each([
    'generation',
    'generation-path',
    'item-101',
    'source-generation',
    'source-hold',
    'replaced-path',
    'occupied-final',
    'missing-checkpoint',
    'duplicate-checkpoint'
  ] as const)('CLEAN_STAGING recovery rejects %s drift without replacing the original checkpoint', async (drift) => {
    const fixture = await interruptedStagingCleanup('before-files')
    const inspection = await inspectCleanup(fixture)
    const checkpoint = await db().systemJobEvent.findFirstOrThrow({
      where: { jobId: fixture.jobId, type: 'archive.cleanup.checkpoint' }
    })
    if (drift === 'missing-checkpoint') await db().systemJobEvent.delete({ where: { id: checkpoint.id } })
    if (drift === 'duplicate-checkpoint') {
      await db().systemJobEvent.create({
        data: { jobId: fixture.jobId, type: checkpoint.type, attempt: checkpoint.attempt, data: checkpoint.data! }
      })
    }
    if (drift === 'generation') {
      await db().archiveImport.update({ where: { id: fixture.importId }, data: { generationToken: randomUUID() } })
    }
    if (drift === 'generation-path') {
      await db().archiveStagingGeneration.update({
        where: { token: fixture.token },
        data: { path: fixture.stagingPath + '-different' }
      })
    }
    if (drift === 'item-101') {
      await db().archiveImportItem.update({ where: { id: `${fixture.importId}-item-100` }, data: { attempts: 1 } })
    }
    if (drift === 'source-generation') {
      await db().artworkDedupSourceIdentity.update({
        where: { id: fixture.sourceId },
        data: { generation: { increment: 1 } }
      })
    }
    if (drift === 'source-hold') {
      await db().artworkDedupSourceIdentity.update({
        where: { id: fixture.sourceId },
        data: { status: 'HOLD', ownerOperationId: prefix }
      })
    }
    if (drift === 'replaced-path') {
      await rename(path.join(fixture.root, fixture.stagingPath), path.join(fixture.root, fixture.stagingPath + '-old'))
      await writeFixture(fixture.root, fixture.stagingPath + '/replacement')
    }
    if (drift === 'occupied-final') await writeFixture(fixture.root, fixture.finalPath + '/replacement')
    await expect(grantMaintenance(fixture, inspection)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await db().mediaContentRecoveryGrant.count({ where: { jobId: fixture.jobId } })).toBe(0)
    expect(
      await db().mediaContentPathWrite.findMany({ where: { jobId: fixture.jobId }, orderBy: { id: 'asc' } })
    ).toEqual(fixture.oldClaims)
    if (drift !== 'missing-checkpoint') {
      expect(await db().systemJobEvent.findUniqueOrThrow({ where: { id: checkpoint.id } })).toEqual(checkpoint)
    }
    if (drift === 'source-hold') {
      expect(
        await db().artworkDedupSourceIdentity.findUniqueOrThrow({ where: { id: fixture.sourceId } })
      ).toMatchObject({ status: 'HOLD', ownerOperationId: prefix })
    }
  })

  it('CLEAN_STAGING rechecks the original checkpoint at resume and consume', async () => {
    const fixture = await interruptedStagingCleanup('after-files')
    const inspection = await inspectCleanup(fixture)
    const granted = await grantMaintenance(fixture, inspection)
    if (granted.status !== 'READY') throw new Error(`Grant rejected: ${granted.status}`)
    await db().archiveImport.update({
      where: { id: fixture.importId },
      data: { cleanupRequestedAt: new Date(fixture.now.getTime() + 1) }
    })
    await expect(resumeMaintenance(fixture, granted.value.grantId)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await db().archiveImport.update({ where: { id: fixture.importId }, data: { cleanupRequestedAt: fixture.now } })
    expect(await resumeMaintenance(fixture, granted.value.grantId)).toMatchObject({ status: 'READY' })
    const second = (await fixture.repository.claim(`${prefix}-cleanup-drift`, capabilities))!
    await writeFixture(fixture.root, `${fixture.stagingPath}/replacement`)
    await executeArchiveMaintenance(executionContext(fixture.repository, second), {
      database: db(),
      config: { scanRoot: fixture.root }
    })
    expect(await db().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({ status: 'PAUSED' })
    expect(
      await db().mediaContentRecoveryGrant.findUniqueOrThrow({ where: { id: granted.value.grantId } })
    ).toMatchObject({ status: 'ACTIVE' })
    expect(
      await db().mediaContentPathWrite.findMany({ where: { jobId: fixture.jobId }, orderBy: { id: 'asc' } })
    ).toEqual(fixture.oldClaims)
    expect(await readFile(path.join(fixture.root, fixture.stagingPath, 'replacement'), 'utf8')).toBe('fixture')
  })
})

async function interruptedStagingCleanup(failure: 'before-files' | 'after-files' | 'inside-finalizer') {
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
  if (failure === 'before-files') {
    crashed.mutateInTransaction = async (operation) => {
      const result = await original.mutateInTransaction(operation)
      if (await db().systemJobEvent.count({ where: { jobId, type: 'archive.cleanup.checkpoint' } })) {
        throw new Error('injected cleanup before files')
      }
      return result
    }
  } else if (failure === 'after-files') {
    crashed.finalizeInTransaction = async () => {
      throw new Error('injected cleanup after files')
    }
  } else {
    crashed.finalizeInTransaction = <TTransaction extends QueueSqlExecutor>(
      operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
    ) =>
      original.finalizeInTransaction<TTransaction>(async (scope) => {
        await operation(scope)
        throw new Error('injected cleanup DB rollback')
      })
  }
  await expect(executeArchiveMaintenance(crashed, { database: db(), config: { scanRoot: root } })).rejects.toThrow(
    'injected cleanup'
  )
  // Actual executor return precedes pause/release; lease expiry is never used as exit evidence.
  await original.finalizeInTransaction(async (scope) => {
    await scope.pause({ reason: 'ACTION_REQUIRED', message: 'Synthetic interrupted cleanup' })
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
