import { ARCHIVE_INTAKE_PUBLISH_LOCK_ID, enqueueArchiveIntakeItemInTransaction } from '../intake-enqueue.ts'
import { createHash, randomUUID } from 'node:crypto'
import type { WorkerCapability } from '@pixishelf/job-contracts'
import { Prisma, PrismaClient } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeArchiveResolveItem } from '../resolver-executor.js'
import { GovernedArchiveProviderRegistry, PostgresArchiveProviderGovernor } from '../provider-governor.js'
import { DefaultArchiveMediaProviderRegistry } from '../provider-registry.js'
import type { ArchiveProvider, ResolvedArchive } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const testPrefix = `archive-resolver-${randomUUID()}`
const capabilities: WorkerCapability[] = [
  { jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }
]
const resolved: ResolvedArchive = {
  providerKey: 'test',
  externalId: 'gallery-1',
  canonicalUrl: 'https://example.test/g/gallery-1',
  locator: { id: 'gallery-1' },
  title: 'Resolved title',
  titleAliases: [],
  description: null,
  category: null,
  uploader: null,
  thumbnailUrl: null,
  postedAt: null,
  tags: [],
  relationships: [],
  media: [{ index: 0, sourcePageUrl: 'https://example.test/page/1', locator: {}, expectedFilename: '0001' }],
  normalizedMetadata: { title: 'Resolved title' },
  rawMetadata: { id: 'gallery-1' },
  warnings: [],
  creatorBucket: '_unknown'
}

describePostgres('archive resolver PostgreSQL integration', () => {
  beforeEach(async () => {
    await db().archiveUploaderCatalogItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveUploaderSource.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().artwork.deleteMany({ where: { title: { startsWith: testPrefix } } })
    await db().archiveImport.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
    await db().systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await db().archiveResolveQueueControl.update({
      where: { id: 'archive-resolve' },
      data: { paused: false, pausedAt: null, pausedBy: null }
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveUploaderCatalogItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveIntakeItem.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.artwork.deleteMany({ where: { title: { startsWith: testPrefix } } })
    await prisma.archiveImport.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
    await prisma.systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
    await prisma.$disconnect()
  })

  it('atomically commits READY intake state with COMPLETED job settlement', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    const catalogId = await seedCatalogItem(itemId, clock.now())
    const repository = createRepository(clock)
    const claimed = await repository.claim('archive-resolver-success', capabilities)
    expect(claimed?.id).toBe(jobId)

    await executeArchiveResolveItem(executionContext(repository, claimed!), {
      database: db(),
      uuid: () => `${testPrefix}-${randomUUID()}`,
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now()
    })

    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, resolutionKind: true, resolvedTitle: true }
      })
    ).toEqual({ status: 'READY', resolutionKind: 'NEW', resolvedTitle: 'Resolved title' })
    expect(
      await db().systemJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, result: true } })
    ).toMatchObject({ status: 'COMPLETED', result: { intakeItemId: itemId, resolutionKind: 'NEW' } })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({
        where: { id: catalogId },
        select: { lastOutcome: true, lastOutcomeAt: true, lastErrorCode: true }
      })
    ).resolves.toEqual({ lastOutcome: 'SUBMITTED', lastOutcomeAt: clock.now(), lastErrorCode: null })
  })

  it('atomically marks a different submitted URL with the same resolved identity as DUPLICATE', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const existingSubmissionId = `${testPrefix}-existing-submission-${randomUUID()}`
    const existingItemId = `${testPrefix}-existing-item-${randomUUID()}`
    await db().archiveIntakeSubmission.create({
      data: {
        id: existingSubmissionId,
        idempotencyKey: existingSubmissionId,
        requestHash: '0'.repeat(64),
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            id: existingItemId,
            submittedUrl: 'https://example.test/alternate/gallery-1',
            normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '1'),
            status: 'READY',
            providerKey: resolved.providerKey,
            externalId: resolved.externalId,
            canonicalUrl: resolved.canonicalUrl,
            resolvedTitle: resolved.title,
            pageCount: resolved.media.length,
            resolvedSnapshot: JSON.parse(JSON.stringify(resolved)) as Prisma.InputJsonValue,
            metadataHash: 'a'.repeat(64),
            resolutionKind: 'NEW',
            resolvedAt: clock.now(),
            expiresAt: new Date(clock.now().getTime() + 60_000),
            finishedAt: clock.now(),
            createdAt: clock.now(),
            updatedAt: clock.now()
          }
        }
      }
    })
    const { jobId, itemId } = await seedResolverItem(clock.now())
    const repository = createRepository(clock)
    const claimed = (await repository.claim('archive-resolver-duplicate', capabilities))!

    await executeArchiveResolveItem(executionContext(repository, claimed), {
      database: db(),
      uuid: () => `${testPrefix}-${randomUUID()}`,
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now()
    })

    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, resolutionKind: true, duplicateOfItemId: true }
      })
    ).toEqual({
      status: 'DUPLICATE',
      resolutionKind: 'DUPLICATE_IDENTITY',
      duplicateOfItemId: existingItemId
    })
    expect((await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('COMPLETED')
  })

  it('rolls back stale resolver finalization after lease recovery moves the intake item to RETRY_WAIT', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock, 1_000)
    const claimed = (await repository.claim('archive-resolver-stale', capabilities))!
    let finishResolve: ((value: ResolvedArchive) => void) | undefined
    const resolving = new Promise<ResolvedArchive>((resolve) => {
      finishResolve = resolve
    })
    const execution = executeArchiveResolveItem(executionContext(repository, claimed), {
      database: db(),
      uuid: () => `${testPrefix}-${randomUUID()}`,
      providers: providerRegistry(vi.fn(() => resolving)),
      now: () => clock.now()
    })
    await vi.waitFor(async () => {
      expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('RESOLVING')
    })

    clock.advance(1_001)
    await expect(repository.recoverExpiredExecution('ARCHIVE_RESOLVE')).resolves.toMatchObject({
      jobId,
      status: 'RETRY_WAIT'
    })
    finishResolve?.(resolved)

    await expect(execution).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      await db().archiveIntakeItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { status: true, errorCode: true }
      })
    ).toEqual({ status: 'RETRY_WAIT', errorCode: 'WORKER_LEASE_EXPIRED' })
  })
  it('commits AUTO NEW intake, download job, event and catalog link together; reexecution creates nothing', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({
      where: { id: itemId },
      data: { downloadMode: 'AUTO', selectedQuality: 'DISPLAY' }
    })
    const catalogId = await seedCatalogItem(itemId, clock.now())
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-new', capabilities))!
    const context = executionContext(repository, claim)
    const dependencies = {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now(),
      uuid: () => testPrefix + '-' + randomUUID()
    }
    await executeArchiveResolveItem(context, dependencies)
    const item = await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(item).toMatchObject({
      status: 'ENQUEUED',
      resolutionKind: 'NEW',
      downloadMode: 'AUTO',
      selectedQuality: 'DISPLAY'
    })
    const download = await db().archiveImport.findUniqueOrThrow({
      where: { id: item.archiveImportId! },
      include: { systemJob: true, items: true }
    })
    expect(download).toMatchObject({
      selectedQuality: 'DISPLAY',
      requestedQuality: 'DISPLAY',
      canonicalUrl: resolved.canonicalUrl,
      systemJob: { type: 'ARCHIVE_IMPORT', executionLane: 'BACKGROUND_WRITER', status: 'PENDING' }
    })
    expect(download.items).toHaveLength(1)
    expect(await db().systemJobEvent.count({ where: { jobId: download.systemJobId!, type: 'job.queued' } })).toBe(1)
    expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' })
    expect(await db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalogId } })).toMatchObject({
      lastArchiveImportId: download.id
    })
    await expect(executeArchiveResolveItem(context, dependencies)).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(1)
  })

  it('resolves and automatically enqueues exactly once while the same provider download capacity is full', async () => {
    const clock = new MutableQueueClock(new Date('2026-09-09T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-during-download', capabilities))!
    const context = executionContext(repository, claim)
    const providerKey = `auto-${randomUUID()}`
    await db().archiveProviderThrottle.create({ data: { providerKey, nextRequestAt: clock.now() } })
    const governor = new PostgresArchiveProviderGovernor(db(), {
      now: () => clock.now(),
      sleep: async (milliseconds) => {
        clock.advance(milliseconds)
      },
      maxConcurrentDownloads: 1
    })
    const resolveRequest = vi.fn(async () => ({ ...resolved, providerKey }))
    const testProvider: ArchiveProvider = {
      key: providerKey,
      requestGovernance: 'PER_REQUEST',
      accepts: () => true,
      resolve: async (_url, providerContext) => providerContext!.runResolveRequest!(resolveRequest),
      openMedia: vi.fn()
    }
    const providers = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([testProvider]),
      governor
    )
    const downloadPermit = await governor.acquire(providerKey, 'DOWNLOAD', context.signal)
    try {
      const dependencies = {
        database: db(),
        providers,
        now: () => clock.now(),
        uuid: () => `${testPrefix}-${randomUUID()}`
      }
      await executeArchiveResolveItem(context, dependencies)
      expect(resolveRequest).toHaveBeenCalledOnce()
      const item = await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })
      expect(item).toMatchObject({ status: 'ENQUEUED', resolutionKind: 'NEW', errorCode: null })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
        status: 'COMPLETED',
        attempt: 1
      })
      const download = await db().archiveImport.findUniqueOrThrow({
        where: { id: item.archiveImportId! },
        include: { systemJob: true }
      })
      expect(download.systemJob).toMatchObject({
        type: 'ARCHIVE_IMPORT',
        status: 'PENDING',
        executionLane: 'BACKGROUND_WRITER'
      })
      expect(await db().archiveProviderRequestLease.count({ where: { providerKey, requestClass: 'DOWNLOAD' } })).toBe(1)
      await expect(executeArchiveResolveItem(context, dependencies)).rejects.toBeInstanceOf(JobExecutionFenceError)
      expect(await db().archiveImport.count({ where: { providerKey } })).toBe(1)
      expect(await db().systemJobEvent.count({ where: { jobId: download.systemJobId!, type: 'job.queued' } })).toBe(1)
    } finally {
      await governor.release(downloadPermit)
      await db().archiveProviderThrottle.delete({ where: { providerKey } })
    }
  })

  it.each(['UPDATE', 'UNCHANGED'] as const)('AUTO %s never creates a new download', async (classification) => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    await seedPublishedArchive(classification === 'UNCHANGED')
    const { itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-existing', capabilities))!
    await executeArchiveResolveItem(executionContext(repository, claim), {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now(),
      uuid: () => testPrefix + '-' + randomUUID()
    })
    expect(await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: classification === 'UPDATE' ? 'READY' : 'SKIPPED',
      resolutionKind: classification,
      archiveImportId: null
    })
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(1)
  })

  it('AUTO ACTIVE_TASK reuses the existing quality even when default tag settings are invalid', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const active = await seedArchiveImport('DISPLAY', 'PENDING')
    const { itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({
      where: { id: itemId },
      data: { downloadMode: 'AUTO', selectedQuality: 'ORIGINAL' }
    })
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-active', capabilities))!
    await executeArchiveResolveItem(withDefaultTagSetting(executionContext(repository, claim), 'invalid-json'), {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now(),
      uuid: () => testPrefix + '-' + randomUUID()
    })
    expect(await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: 'ENQUEUED',
      resolutionKind: 'ACTIVE_TASK',
      archiveImportId: active.id,
      selectedQuality: 'DISPLAY'
    })
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(1)
  })

  it('serializes an AUTO handoff racing a manual enqueue into one download with the winning quality', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const manual = await seedResolverItem(clock.now())
    await db().systemJob.update({ where: { id: manual.jobId }, data: { status: 'COMPLETED' } })
    await db().archiveIntakeItem.update({
      where: { id: manual.itemId },
      data: {
        status: 'READY',
        providerKey: resolved.providerKey,
        externalId: resolved.externalId,
        canonicalUrl: resolved.canonicalUrl,
        resolvedSnapshot: JSON.parse(JSON.stringify(resolved)),
        metadataHash: 'a'.repeat(64),
        expiresAt: new Date(clock.now().getTime() + 60_000)
      }
    })
    const automatic = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: automatic.itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-manual-race', capabilities))!
    let unlock!: () => void
    const released = new Promise<void>((resolve) => {
      unlock = resolve
    })
    let locked = false
    const manualEnqueue = db().$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_INTAKE_PUBLISH_LOCK_ID)
      locked = true
      await released
      return enqueueArchiveIntakeItemInTransaction(transaction, manual.itemId, {
        quality: 'DISPLAY',
        requestedByUserId: null,
        timestamp: clock.now(),
        uuid: () => testPrefix + '-' + randomUUID(),
        defaultTagIds: []
      })
    })
    await vi.waitFor(() => expect(locked).toBe(true))
    const resolve = vi.fn(async () => resolved)
    const autoEnqueue = executeArchiveResolveItem(executionContext(repository, claim), {
      database: db(),
      providers: providerRegistry(resolve),
      now: () => clock.now(),
      uuid: () => testPrefix + '-' + randomUUID()
    })
    await vi.waitFor(() => expect(resolve).toHaveBeenCalled())
    unlock()
    await Promise.all([manualEnqueue, autoEnqueue])
    const intakes = await db().archiveIntakeItem.findMany({ where: { id: { in: [manual.itemId, automatic.itemId] } } })
    expect(intakes).toHaveLength(2)
    expect(intakes.every((item) => item.status === 'ENQUEUED' && item.selectedQuality === 'DISPLAY')).toBe(true)
    expect(new Set(intakes.map((item) => item.archiveImportId)).size).toBe(1)
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(1)
  })

  it.each([
    ['duplicates', '[5,2,5,"2"]', [2, 5]],
    ['more than 100 duplicate IDs', JSON.stringify(Array.from({ length: 101 }, () => 2)), [2]],
    ['invalid JSON', 'invalid-json', null],
    ['101 unique IDs', JSON.stringify(Array.from({ length: 101 }, (_, index) => index + 1)), null],
    ['zero ID', '[0]', null],
    ['negative ID', '[-1]', null],
    ['fractional ID', '[1.5]', null]
  ] as const)(
    'freezes normalized AUTO default tags or reports invalid settings: %s',
    async (_label, configured, expected) => {
      const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
      const { itemId } = await seedResolverItem(clock.now())
      await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
      const catalogId = await seedCatalogItem(itemId, clock.now())
      const repository = createRepository(clock)
      const claim = (await repository.claim('auto-default-tags', capabilities))!
      const context = withDefaultTagSetting(executionContext(repository, claim), configured)
      await executeArchiveResolveItem(context, {
        database: db(),
        providers: providerRegistry(vi.fn(async () => resolved)),
        now: () => clock.now(),
        uuid: () => testPrefix + '-' + randomUUID()
      })
      const item = await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })
      expect(await db().systemJob.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ status: 'COMPLETED' })
      if (!expected) {
        expect(item).toMatchObject({
          status: 'FAILED',
          errorCode: 'INVALID_DEFAULT_TAGS',
          retryable: true,
          archiveImportId: null
        })
        expect(await db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalogId } })).toMatchObject({
          lastOutcome: 'FAILED',
          lastErrorCode: 'INVALID_DEFAULT_TAGS',
          lastOutcomeAt: clock.now()
        })
        expect(
          await db().archiveImport.count({
            where: { providerKey: resolved.providerKey, externalId: resolved.externalId }
          })
        ).toBe(0)
      } else {
        expect(item.status).toBe('ENQUEUED')
        const archive = await db().archiveImport.findUniqueOrThrow({
          where: { id: item.archiveImportId! },
          include: { systemJob: true }
        })
        expect(archive.systemJob.payload).toEqual({ archiveImportId: archive.id, defaultTagIds: expected })
      }
    }
  )

  it('a cancellation committed during AUTO remote resolution creates zero downloads', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { jobId, itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock)
    const claim = (await repository.claim('auto-cancel', capabilities))!
    await executeArchiveResolveItem(executionContext(repository, claim), {
      database: db(),
      now: () => clock.now(),
      providers: providerRegistry(
        vi.fn(async () => {
          await db().$transaction(async (tx) => {
            await tx.systemJob.update({
              where: { id: jobId },
              data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
            })
            await tx.archiveIntakeItem.update({ where: { id: itemId }, data: { cancelRequestedAt: clock.now() } })
          })
          return resolved
        })
      )
    })
    expect(await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: 'CANCELLED',
      archiveImportId: null
    })
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(0)
  })

  it('rolls back the entire AUTO handoff if job settlement fails, then lease recovery retries exactly once', async () => {
    const clock = new MutableQueueClock(new Date('2026-08-18T10:00:00.000Z'))
    const { itemId } = await seedResolverItem(clock.now())
    await db().archiveIntakeItem.update({ where: { id: itemId }, data: { downloadMode: 'AUTO' } })
    const repository = createRepository(clock, 10_000)
    const claim = (await repository.claim('auto-rollback', capabilities))!
    const context = executionContext(repository, claim)
    const finalize = context.finalizeInTransaction
    context.finalizeInTransaction = (operation) =>
      finalize<Parameters<typeof operation>[0]['transaction']>(async (scope) => {
        await operation({
          ...scope,
          complete: async () => {
            throw new Error('simulated settlement failure')
          }
        })
      })
    const dependencies = {
      database: db(),
      providers: providerRegistry(vi.fn(async () => resolved)),
      now: () => clock.now(),
      uuid: () => testPrefix + '-' + randomUUID()
    }
    await expect(executeArchiveResolveItem(context, dependencies)).rejects.toThrow('simulated settlement failure')
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(0)
    expect(await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: 'RESOLVING',
      archiveImportId: null
    })
    clock.advance(10_001)
    await repository.recoverExpiredExecution('ARCHIVE_RESOLVE')
    clock.advance(60_000)
    const reclaimed = (await repository.claim('auto-recovered', capabilities))!
    await executeArchiveResolveItem(executionContext(repository, reclaimed), dependencies)
    expect(
      await db().archiveImport.count({ where: { providerKey: resolved.providerKey, externalId: resolved.externalId } })
    ).toBe(1)
  })
})

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}

function createRepository(clock: MutableQueueClock, leaseDurationMs = 60_000) {
  return new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock,
    leaseDurationMs,
    transactionMaxWaitMs: Math.min(15_000, Math.max(100, Math.floor(leaseDurationMs / 4))),
    transactionTimeoutMs: Math.min(20_000, leaseDurationMs - 1)
  })
}

async function seedResolverItem(now: Date) {
  const jobId = `${testPrefix}-job-${randomUUID()}`
  const itemId = `${testPrefix}-item-${randomUUID()}`
  const submissionId = `${testPrefix}-submission-${randomUUID()}`
  await db().systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: 1,
      status: 'PENDING',
      triggerSource: 'SYSTEM',
      payload: { intakeItemId: itemId },
      queuePriority: 100,
      effectivePriority: 100,
      availableAt: now,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now
    }
  })
  await db().archiveIntakeSubmission.create({
    data: {
      id: submissionId,
      idempotencyKey: submissionId,
      requestHash: '0'.repeat(64),
      rawCount: 1,
      acceptedCount: 1,
      items: {
        create: {
          id: itemId,
          submittedUrl: 'https://example.test/g/gallery-1',
          normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          currentSystemJobId: jobId,
          createdAt: now,
          updatedAt: now
        }
      }
    }
  })
  return { jobId, itemId }
}

async function seedCatalogItem(intakeItemId: string, timestamp: Date) {
  const sourceId = `${testPrefix}-source-${randomUUID()}`
  const catalogId = `${testPrefix}-catalog-${randomUUID()}`
  await db().archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: resolved.providerKey,
      identityKind: 'UID',
      identityValue: randomUUID(),
      normalizedIdentity: randomUUID(),
      displayName: 'Resolver lifecycle source'
    }
  })
  await db().archiveUploaderCatalogItem.create({
    data: {
      id: catalogId,
      sourceId,
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      canonicalUrl: resolved.canonicalUrl,
      title: resolved.title,
      relationships: [],
      classification: 'NEW',
      comparisonKnown: true,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      lastIntakeItemId: intakeItemId,
      lastOutcome: 'SUBMITTED',
      lastOutcomeAt: timestamp
    }
  })
  return catalogId
}

function executionContext(repository: PostgresQueueRepository, job: ClaimedJob) {
  const fence = {
    jobId: job.id,
    workerId: job.workerId,
    executionToken: job.executionToken,
    attempt: job.attempt
  }
  const context: ExecutionContext<{ intakeItemId: string }, EnqueuedChildJob> = {
    job,
    payload: { intakeItemId: String((job.payload as { intakeItemId: string }).intakeItemId) },
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('resolver integration test does not enqueue child jobs')
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

function providerRegistry(resolve: ArchiveProvider['resolve']) {
  const provider: ArchiveProvider = {
    key: 'test',
    requestGovernance: 'PER_REQUEST',
    accepts: () => true,
    resolve,
    openMedia: vi.fn()
  }
  return { get: () => provider, getForUrl: () => provider }
}

function withDefaultTagSetting(context: ReturnType<typeof executionContext>, configured: string) {
  const finalize = context.finalizeInTransaction
  context.finalizeInTransaction = (operation) =>
    finalize<Parameters<typeof operation>[0]['transaction']>(async (scope) => {
      // Restore the setting before commit so other test readers never observe the override.
      const transaction = scope.transaction as unknown as Prisma.TransactionClient
      const previous = await transaction.setting.findUnique({ where: { key: 'archive_default_tag_ids' } })
      await transaction.setting.upsert({
        where: { key: 'archive_default_tag_ids' },
        create: { key: 'archive_default_tag_ids', type: 'json', value: configured },
        update: { type: 'json', value: configured }
      })
      await operation(scope)
      if (previous)
        await transaction.setting.update({
          where: { key: previous.key },
          data: { type: previous.type, value: previous.value }
        })
      else await transaction.setting.delete({ where: { key: 'archive_default_tag_ids' } })
    })
  return context
}

async function seedArchiveImport(quality: 'ORIGINAL' | 'DISPLAY', status: 'PENDING' | 'COMPLETED') {
  return db().archiveImport.create({
    data: {
      id: testPrefix + '-import-' + randomUUID(),
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      submittedUrl: resolved.canonicalUrl,
      canonicalUrl: resolved.canonicalUrl,
      locator: {},
      requestedQuality: quality,
      selectedQuality: quality,
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: '_unknown',
      stagingPath: '.archive-staging/test',
      status,
      systemJob: {
        create: {
          id: testPrefix + '-download-' + randomUUID(),
          type: 'ARCHIVE_IMPORT',
          executionLane: 'BACKGROUND_WRITER',
          definitionVersion: 2,
          status,
          triggerSource: 'MANUAL',
          payload: {}
        }
      }
    }
  })
}

async function seedPublishedArchive(unchanged: boolean) {
  const archive = await seedArchiveImport('ORIGINAL', 'COMPLETED')
  const artwork = await db().artwork.create({
    data: { title: testPrefix + '-published', source: 'URL_ARCHIVE', createdVia: 'URL_ARCHIVE' }
  })
  const reference = await db().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      canonicalUrl: resolved.canonicalUrl,
      locator: {}
    }
  })
  await db().archiveRevision.create({
    data: {
      artworkId: artwork.id,
      externalRefId: reference.id,
      archiveImportId: archive.id,
      archivePath: 'test/archive',
      manifestPath: 'test/archive/manifest.json',
      mediaSnapshot: [],
      metadataHash: unchanged
        ? createHash('sha256').update(JSON.stringify(resolved.normalizedMetadata)).digest('hex')
        : 'a'.repeat(64),
      isCurrent: true
    }
  })
}
