import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ArchiveMaintenancePayload, WorkerCapability } from '@pixishelf/job-contracts'
import { Prisma, PrismaClient } from '@pixishelf/db'
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
import { executeArchiveMaintenance } from '../maintenance-executor.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-maintenance-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]
const roots: string[] = []

describePostgres('archive maintenance PostgreSQL integration', () => {
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

  it('fenced cleanup removes deterministic files and clears durable checkpoints', async () => {
    const root = await temporaryRoot()
    const now = new Date('2026-08-18T10:00:00.000Z')
    const importJobId = `${prefix}-import-job`
    const importId = `${prefix}-import`
    await seedSystemJob(importJobId, 'ARCHIVE_IMPORT', { archiveImportId: importId }, now, 'COMPLETED')
    await db().archiveImport.create({
      data: {
        id: importId,
        systemJobId: importJobId,
        providerKey: 'test',
        externalId: 'cleanup',
        submittedUrl: 'https://example.test/cleanup',
        canonicalUrl: 'https://example.test/cleanup',
        locator: {},
        status: 'FAILED',
        normalizedMetadata: {},
        rawMetadata: {},
        metadataHash: 'a'.repeat(64),
        creatorBucket: 'bucket',
        stagingPath: `.archive-staging/${importId}`,
        cleanupRequestedAt: now
      }
    })
    await writeFixture(root, `.archive-staging/${importId}/checkpoint`)
    await writeFixture(root, `sources/test/bucket/cleanup/revisions/${importId}/checkpoint`)
    const maintenanceJobId = await seedSystemJob(
      `${prefix}-cleanup-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'CLEAN_STAGING', archiveImportId: importId },
      now
    )

    await runClaimedMaintenance(maintenanceJobId, root, now)

    await expect(db().archiveImport.findUniqueOrThrow({ where: { id: importId } })).resolves.toMatchObject({
      cleanupRequestedAt: null,
      completedItems: 0,
      failedItems: 0
    })
    await expect(db().systemJob.findUniqueOrThrow({ where: { id: maintenanceJobId } })).resolves.toMatchObject({
      status: 'COMPLETED'
    })
    await expect(readFile(path.join(root, `.archive-staging/${importId}/checkpoint`))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('fenced trash and restore preserve lifecycle/path invariants on real rows', async () => {
    const root = await temporaryRoot()
    const now = new Date('2026-08-18T11:00:00.000Z')
    const artwork = await db().artwork.create({
      data: {
        title: prefix,
        createdVia: 'URL_ARCHIVE',
        source: 'URL_ARCHIVE',
        archiveLifecycleState: 'TRASHING',
        deletedAt: now
      }
    })
    const externalRef = await db().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'test-maintenance',
        externalId: prefix,
        canonicalUrl: 'https://example.test/archive',
        locator: {}
      }
    })
    const archivePath = `sources/test/bucket/${prefix}/revisions/rev-1`
    const trashPath = `.trash/archive/${artwork.id}/rev-1`
    await db().archiveRevision.create({
      data: {
        id: `${prefix}-revision`,
        artworkId: artwork.id,
        externalRefId: externalRef.id,
        archivePath,
        manifestPath: `${archivePath}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'b'.repeat(64),
        isCurrent: true,
        trashPath,
        trashedAt: now,
        purgeAfter: new Date(now.getTime() + 60_000)
      }
    })
    await writeFixture(root, `${archivePath}/media/file.jpg`)
    const trashJobId = await seedSystemJob(
      `${prefix}-trash-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'TRASH_ARCHIVE', artworkId: artwork.id },
      now
    )

    await runClaimedMaintenance(trashJobId, root, now)
    await expect(db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).resolves.toMatchObject({
      archiveLifecycleState: 'TRASHED',
      deletedAt: now
    })
    await expect(readFile(path.join(root, trashPath, 'media/file.jpg'), 'utf8')).resolves.toBe('fixture')

    const restoreAt = new Date(now.getTime() + 1_000)
    await db().artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'RESTORING' } })
    const restoreJobId = await seedSystemJob(
      `${prefix}-restore-job`,
      'ARCHIVE_MAINTENANCE',
      { action: 'RESTORE_ARCHIVE', artworkId: artwork.id },
      restoreAt
    )
    await runClaimedMaintenance(restoreJobId, root, restoreAt)

    await expect(db().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).resolves.toMatchObject({
      archiveLifecycleState: 'ACTIVE',
      deletedAt: null
    })
    await expect(
      db().archiveRevision.findUniqueOrThrow({ where: { id: `${prefix}-revision` } })
    ).resolves.toMatchObject({
      trashPath: null,
      trashedAt: null,
      purgeAfter: null
    })
    await expect(readFile(path.join(root, archivePath, 'media/file.jpg'), 'utf8')).resolves.toBe('fixture')
  })
})

async function runClaimedMaintenance(jobId: string, root: string, now: Date) {
  const repository = new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    leaseDurationMs: 60_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 20_000
  })
  const claimed = await repository.claim(`${prefix}-worker`, capabilities)
  expect(claimed?.id).toBe(jobId)
  await executeArchiveMaintenance(executionContext(repository, claimed!), {
    database: db(),
    config: { scanRoot: root },
    now: () => now
  })
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
  await prisma.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: prefix } })
  await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
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
