import { randomUUID } from 'node:crypto'
import {
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveUploaderIdentityLockKey
} from '@pixishelf/job-contracts'
import { Prisma, PrismaClient } from '@pixishelf/db'
import {
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type FencedExecutionTransaction
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeArchiveImport } from '../executor.js'
import { createArchiveUploaderComparisonSnapshot, hashArchiveUploaderDiscoveryMetadata } from '../providers/e-hentai.js'
import { executeArchiveUploaderScan } from '../uploader-scan-executor.js'
import type { ArchiveUploaderScanResult } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-uploader-scan-${randomUUID()}`
const externalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()
const canonicalUrl = `https://e-hentai.org/g/${externalId}/private-token/`
const previousMetadata = {
  gid: externalId,
  titles: { display: 'Existing gallery', aliases: [] },
  category: 'Manga',
  uploader: 'alice',
  thumbnailUrl: 'https://ehgt.org/old.jpg',
  postedAt: '2026-09-01T00:00:00.000Z',
  fileCount: 24,
  fileSize: 1024,
  rating: 3,
  expunged: false,
  tags: [],
  relationships: []
}
const changedMetadata = { ...previousMetadata, fileCount: 27, rating: 5, thumbnailUrl: 'https://ehgt.org/new.jpg' }

describePostgres('archive uploader scan catalog PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })

  it('keeps POSSIBLE_UPDATE durable when an active import is observed during a rescan', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z')
    const activeImport = await seedArchiveImport(now)
    const source = await seedSource('update')
    const artwork = await db().artwork.create({ data: { title: `${prefix}-artwork-update` } })
    const externalRef = await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-ref-update`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl,
        locator: { gid: externalId, token: 'private-token' },
        status: 'SUCCESS',
        lastSuccessAt: new Date('2026-09-02T00:00:00.000Z'),
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z')
      }
    })
    await db().artworkSourceSnapshot.create({
      data: {
        id: `${prefix}-snapshot-update`,
        externalRefId: externalRef.id,
        normalizedMetadata: previousMetadata,
        rawMetadata: previousMetadata,
        metadataHash: hashArchiveUploaderDiscoveryMetadata(previousMetadata)!,
        fetchedAt: new Date('2026-09-02T00:00:00.000Z')
      }
    })
    const catalog = await db().archiveUploaderCatalogItem.create({
      data: catalogData(source.id, `${prefix}-catalog-update`, now, 'POSSIBLE_UPDATE')
    })
    const run = await seedScanRun(source.id, 'update', now)

    await executeArchiveUploaderScan(scanContext(run.jobId, run.runId), {
      database: db(),
      providers: uploaderProviderRegistry(scanResult()),
      now: () => now
    })

    await expect(
      db().archiveUploaderScanItem.findFirstOrThrow({ where: { runId: run.runId }, select: { classification: true } })
    ).resolves.toEqual({ classification: 'ACTIVE' })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({
        where: { id: catalog.id },
        select: { classification: true, changeReasons: true, lastArchiveImportId: true }
      })
    ).resolves.toEqual({
      classification: 'POSSIBLE_UPDATE',
      changeReasons: [{ field: 'fileCount', message: '页数 24 → 27' }],
      lastArchiveImportId: activeImport.importId
    })
  })

  it('propagates an import cancellation to catalogs first discovered after the import started and retains it after cleanup', async () => {
    const now = new Date('2026-09-03T11:00:00.000Z')
    const activeImport = await seedArchiveImport(now)
    const firstSource = await seedSource('first')
    const secondSource = await seedSource('second')
    const firstCatalog = await db().archiveUploaderCatalogItem.create({
      data: catalogData(firstSource.id, `${prefix}-catalog-first`, now, 'NEW')
    })
    const secondCatalog = await db().archiveUploaderCatalogItem.create({
      data: catalogData(secondSource.id, `${prefix}-catalog-second`, now, 'NEW')
    })
    expect(firstCatalog.lastArchiveImportId).toBeNull()
    expect(secondCatalog.lastArchiveImportId).toBeNull()

    const controller = new AbortController()
    controller.abort({ reason: 'CANCEL_REQUESTED' })
    await executeArchiveImport(importContext(activeImport.jobId, activeImport.importId, controller.signal), {
      database: db(),
      config: { scanRoot: 'D:/unused-by-cancelled-test', mediaConcurrency: 1, maxMediaAttempts: 1 },
      providers: { get: vi.fn(), getForUrl: vi.fn() } as never,
      now: () => now,
      random: () => 0,
      sleep: vi.fn(async () => undefined)
    })

    const terminal = await db().archiveUploaderCatalogItem.findMany({
      where: { id: { in: [firstCatalog.id, secondCatalog.id] } },
      select: { lastArchiveImportId: true, lastOutcome: true, lastErrorCode: true }
    })
    expect(terminal).toHaveLength(2)
    expect(terminal.every((item) => item.lastArchiveImportId === activeImport.importId)).toBe(true)
    expect(terminal.every((item) => item.lastOutcome === 'CANCELLED')).toBe(true)
    expect(terminal.every((item) => item.lastErrorCode === 'CANCELLED')).toBe(true)

    await db().systemJob.delete({ where: { id: activeImport.jobId } })
    const retained = await db().archiveUploaderCatalogItem.findMany({
      where: { id: { in: [firstCatalog.id, secondCatalog.id] } },
      select: { lastArchiveImportId: true, lastOutcome: true, lastErrorCode: true }
    })
    expect(retained).toEqual(
      expect.arrayContaining([
        { lastArchiveImportId: null, lastOutcome: 'CANCELLED', lastErrorCode: 'CANCELLED' },
        { lastArchiveImportId: null, lastOutcome: 'CANCELLED', lastErrorCode: 'CANCELLED' }
      ])
    )
  })

  it('persists an Intake failure that happened before this source first discovered the gallery', async () => {
    const failedAt = new Date('2026-09-03T12:00:00.000Z')
    const submission = await db().archiveIntakeSubmission.create({
      data: {
        id: `${prefix}-prior-failed-submission`,
        idempotencyKey: `${prefix}-prior-failed`,
        requestHash: 'f'.repeat(64),
        rawCount: 1,
        acceptedCount: 1,
        createdAt: failedAt
      }
    })
    const intake = await db().archiveIntakeItem.create({
      data: {
        id: `${prefix}-prior-failed-intake`,
        submissionId: submission.id,
        submittedUrl: canonicalUrl,
        normalizedUrlHash: 'e'.repeat(64),
        status: 'FAILED',
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl,
        finishedAt: failedAt,
        errorCode: 'REMOTE_FAILED',
        errorMessage: 'failed before discovery',
        createdAt: failedAt,
        updatedAt: failedAt
      }
    })
    const source = await seedSource('prior-failed')
    const run = await seedScanRun(source.id, 'prior-failed', failedAt)

    await executeArchiveUploaderScan(scanContext(run.jobId, run.runId), {
      database: db(),
      providers: uploaderProviderRegistry(scanResult()),
      now: () => failedAt
    })

    const catalog = await db().archiveUploaderCatalogItem.findFirstOrThrow({
      where: { sourceId: source.id, providerKey: 'e-hentai', externalId }
    })
    expect(catalog).toMatchObject({
      classification: 'NEW',
      lastIntakeItemId: intake.id,
      lastOutcome: 'FAILED',
      lastErrorCode: 'REMOTE_FAILED'
    })
    await db().archiveIntakeSubmission.delete({ where: { id: submission.id } })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } })
    ).resolves.toMatchObject({ lastIntakeItemId: null, lastOutcome: 'FAILED', lastErrorCode: 'REMOTE_FAILED' })
  })

  it('waits for an interleaved Import terminal commit before first-discovery upsert', async () => {
    const terminalAt = new Date('2026-09-03T13:00:00.000Z')
    const activeImport = await seedArchiveImport(terminalAt)
    const source = await seedSource('interleaved')
    const run = await seedScanRun(source.id, 'interleaved', terminalAt)
    const terminalLocked = deferred()
    const releaseTerminal = deferred()
    const terminal = db().$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))::text AS "lock"',
        ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
        archiveUploaderIdentityLockKey('e-hentai', externalId)
      )
      await transaction.archiveImport.update({
        where: { id: activeImport.importId },
        data: {
          status: 'CANCELLED',
          finishedAt: terminalAt,
          errorCode: 'CANCELLED',
          errorMessage: 'cancelled while scan was finalizing'
        }
      })
      terminalLocked.resolve()
      await releaseTerminal.promise
    })
    await terminalLocked.promise
    const scan = executeArchiveUploaderScan(scanContext(run.jobId, run.runId), {
      database: db(),
      providers: uploaderProviderRegistry(scanResult()),
      now: () => terminalAt
    })
    await vi.waitFor(async () => {
      expect((await db().archiveUploaderScanRun.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe(
        'RUNNING'
      )
    })
    releaseTerminal.resolve()
    await Promise.all([terminal, scan])

    const catalog = await db().archiveUploaderCatalogItem.findFirstOrThrow({
      where: { sourceId: source.id, providerKey: 'e-hentai', externalId }
    })
    expect(catalog).toMatchObject({
      lastArchiveImportId: activeImport.importId,
      lastOutcome: 'CANCELLED',
      lastErrorCode: 'CANCELLED'
    })
    await db().systemJob.delete({ where: { id: activeImport.jobId } })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } })
    ).resolves.toMatchObject({ lastArchiveImportId: null, lastOutcome: 'CANCELLED', lastErrorCode: 'CANCELLED' })
  })

  it('inherits a retained terminal summary from another source after workflow cleanup', async () => {
    const failedAt = new Date('2026-09-03T14:00:00.000Z')
    const firstSource = await seedSource('retained-first')
    await db().archiveUploaderCatalogItem.create({
      data: {
        ...catalogData(firstSource.id, `${prefix}-catalog-retained-first`, failedAt, 'NEW'),
        lastOutcome: 'FAILED',
        lastOutcomeAt: failedAt,
        lastErrorCode: 'RETAINED_FAILURE',
        lastErrorMessage: 'workflow rows were already cleaned'
      }
    })
    const secondSource = await seedSource('retained-second')
    const run = await seedScanRun(secondSource.id, 'retained-second', failedAt)

    await executeArchiveUploaderScan(scanContext(run.jobId, run.runId), {
      database: db(),
      providers: uploaderProviderRegistry(scanResult()),
      now: () => failedAt
    })

    await expect(
      db().archiveUploaderCatalogItem.findFirstOrThrow({
        where: { sourceId: secondSource.id, providerKey: 'e-hentai', externalId }
      })
    ).resolves.toMatchObject({
      classification: 'NEW',
      lastOutcome: 'FAILED',
      lastOutcomeAt: failedAt,
      lastErrorCode: 'RETAINED_FAILURE'
    })
  })
})

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}

function scanResult(): ArchiveUploaderScanResult {
  return {
    items: [
      {
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl,
        title: 'Existing gallery',
        thumbnailUrl: changedMetadata.thumbnailUrl,
        uploaderName: 'alice',
        postedAt: new Date(changedMetadata.postedAt),
        metadataFingerprint: hashArchiveUploaderDiscoveryMetadata(changedMetadata)!,
        comparisonSnapshot: createArchiveUploaderComparisonSnapshot(changedMetadata)!,
        normalizedMetadata: changedMetadata,
        relationships: []
      }
    ],
    nextCursor: null,
    reachedStop: false
  }
}

function uploaderProviderRegistry(result: ArchiveUploaderScanResult) {
  return {
    getUploaderScanner: () => ({
      key: 'e-hentai',
      scanUploader: vi.fn(async () => result)
    })
  } as never
}

async function seedSource(suffix: string) {
  return db().archiveUploaderSource.create({
    data: {
      id: `${prefix}-source-${suffix}`,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: `${externalId}-${suffix}`,
      normalizedIdentity: `${externalId}-${suffix}`,
      displayName: `Uploader ${suffix}`
    }
  })
}

async function seedScanRun(sourceId: string, suffix: string, now: Date) {
  const runId = `${prefix}-run-${suffix}`
  const jobId = `${prefix}-scan-job-${suffix}`
  await db().systemJob.create({
    data: systemJobData(jobId, 'ARCHIVE_UPLOADER_SCAN', { scanRunId: runId }, now)
  })
  await db().archiveUploaderScanRun.create({
    data: { id: runId, sourceId, systemJobId: jobId, mode: 'LATEST', status: 'PENDING' }
  })
  return { runId, jobId }
}

async function seedArchiveImport(now: Date) {
  const importId = `${prefix}-import`
  const jobId = `${prefix}-import-job`
  await db().systemJob.create({
    data: systemJobData(jobId, 'ARCHIVE_IMPORT', { archiveImportId: importId }, now, 'BACKGROUND_WRITER')
  })
  await db().archiveImport.create({
    data: {
      id: importId,
      systemJobId: jobId,
      providerKey: 'e-hentai',
      externalId,
      submittedUrl: canonicalUrl,
      canonicalUrl,
      locator: { gid: externalId, token: 'private-token' },
      status: 'PENDING',
      normalizedMetadata: changedMetadata,
      rawMetadata: changedMetadata,
      metadataHash: hashArchiveUploaderDiscoveryMetadata(changedMetadata)!,
      creatorBucket: 'alice',
      stagingPath: `.archive-staging/${importId}`,
      createdAt: now,
      updatedAt: now
    }
  })
  return { importId, jobId }
}

function systemJobData(
  id: string,
  type: 'ARCHIVE_UPLOADER_SCAN' | 'ARCHIVE_IMPORT',
  payload: Prisma.InputJsonValue,
  now: Date,
  executionLane: 'ARCHIVE_RESOLVE' | 'BACKGROUND_WRITER' = 'ARCHIVE_RESOLVE'
) {
  return {
    id,
    type,
    executionLane,
    definitionVersion: 1,
    status: 'PENDING' as const,
    triggerSource: 'MANUAL' as const,
    payload,
    queuePriority: 20,
    effectivePriority: 20,
    availableAt: now,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now
  }
}

function catalogData(
  sourceId: string,
  id: string,
  now: Date,
  classification: 'NEW' | 'POSSIBLE_UPDATE'
) {
  return {
    id,
    sourceId,
    providerKey: 'e-hentai',
    externalId,
    canonicalUrl,
    title: 'Existing gallery',
    relationships: [],
    classification,
    comparisonKnown: true,
    comparisonSnapshot: jsonValue(createArchiveUploaderComparisonSnapshot(changedMetadata)!),
    comparisonFingerprint: hashArchiveUploaderDiscoveryMetadata(changedMetadata)!,
    firstSeenAt: now,
    lastSeenAt: now
  }
}

function jsonValue(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function scanContext(jobId: string, scanRunId: string) {
  return transactionContext(jobId, { scanRunId }, new AbortController().signal) as never
}

function importContext(jobId: string, archiveImportId: string, signal: AbortSignal) {
  return transactionContext(jobId, { archiveImportId, defaultTagIds: [] }, signal) as never
}

function transactionContext(jobId: string, payload: Record<string, unknown>, signal: AbortSignal) {
  const job = { id: jobId, attempt: 1, maxAttempts: 3 } as ClaimedJob
  const context: ExecutionContext<Record<string, unknown>, EnqueuedChildJob> = {
    job,
    payload,
    signal,
    progress: vi.fn(async () => undefined),
    enqueueChild: vi.fn(async () => {
      throw new Error('catalog integration test does not enqueue child jobs')
    }),
    mutateInTransaction: (operation) => db().$transaction((transaction) => operation(transaction as never)),
    finalizeInTransaction: async (operation) => {
      await db().$transaction(async (transaction) => {
        const scope = {
          transaction,
          executionStatus: 'RUNNING',
          controlStatus: 'CONTINUE',
          complete: vi.fn(async () => undefined),
          fail: vi.fn(async () => undefined),
          retry: vi.fn(async () => undefined),
          skip: vi.fn(async () => undefined),
          pause: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
          cancel: vi.fn(async () => undefined)
        } as unknown as FencedExecutionTransaction<Prisma.TransactionClient>
        await operation(scope as never)
      })
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return context
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveUploaderCatalogItem.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveUploaderScanRun.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
