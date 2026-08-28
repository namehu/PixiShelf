import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ArchiveError } from '@/services/archive/errors'
import { archiveModule } from '@/services/archive/archive-module'
import {
  cancelArchiveIntakeMany,
  createArchiveIntakeSubmission,
  replaceArchiveIntakeItem,
  retryArchiveIntakeMany
} from '../archive-intake-service'
import { enqueueArchiveIntakeMany } from '../archive-intake-enqueue-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `archive-intake-stage2-${randomUUID()}`
const requestedByUserId = `${suitePrefix}-admin`
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
const validateUrl = (value: string) => {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'e-hentai.org') throw new Error('unsupported')
}

describePostgres('archive intake PostgreSQL transactions', () => {
  beforeAll(async () => database.$connect())

  afterEach(async () => {
    const submissions = await database.archiveIntakeSubmission.findMany({
      where: { requestedByUserId },
      select: { id: true, items: { select: { currentSystemJobId: true, archiveImportId: true } } }
    })
    const itemJobIds = submissions.flatMap((submission) =>
      submission.items.flatMap((item) => (item.currentSystemJobId ? [item.currentSystemJobId] : []))
    )
    const archiveImportIds = submissions.flatMap((submission) =>
      submission.items.flatMap((item) => (item.archiveImportId ? [item.archiveImportId] : []))
    )
    await database.archiveBulkOperation.deleteMany({ where: { requestedByUserId } })
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId } })
    if (archiveImportIds.length > 0) {
      await database.archiveImport.deleteMany({ where: { id: { in: archiveImportIds } } })
    }
    await database.artwork.deleteMany({ where: { title: { startsWith: suitePrefix } } })
    await database.systemJob.deleteMany({
      where: { OR: [{ requestedByUserId }, ...(itemJobIds.length ? [{ id: { in: itemJobIds } }] : [])] }
    })
    vi.unstubAllEnvs()
  })

  afterAll(async () => disconnectDatabase(database))

  it('keeps the 1000 active cap atomic across concurrent submissions and retries', async () => {
    const seededSubmissionId = `${suitePrefix}-capacity-seed`
    await database.archiveIntakeSubmission.create({
      data: {
        id: seededSubmissionId,
        idempotencyKey: seededSubmissionId,
        requestHash: '1'.repeat(64),
        requestedByUserId,
        rawCount: 999,
        acceptedCount: 999,
        items: {
          createMany: {
            data: Array.from({ length: 999 }, (_, index) => ({
              submittedUrl: `https://e-hentai.org/g/capacity-${index}/token/`,
              normalizedUrlHash: index.toString(16).padStart(64, '0'),
              status: 'QUEUED' as const
            }))
          }
        }
      }
    })

    const [first, second] = await Promise.all([
      createArchiveIntakeSubmission(
        { idempotencyKey: `${suitePrefix}-capacity-a`, urls: ['https://e-hentai.org/g/capacity-a/token/'] },
        requestedByUserId,
        { database, validateUrl }
      ),
      createArchiveIntakeSubmission(
        { idempotencyKey: `${suitePrefix}-capacity-b`, urls: ['https://e-hentai.org/g/capacity-b/token/'] },
        requestedByUserId,
        { database, validateUrl }
      )
    ])
    expect(first.acceptedCount + second.acceptedCount).toBe(1)
    expect(first.rejectedCount + second.rejectedCount).toBe(1)
    await expect(
      database.archiveIntakeItem.count({
        where: { status: { in: ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] } }
      })
    ).resolves.toBe(1_000)

    const failedItem = await database.archiveIntakeItem.create({
      data: {
        submissionId: seededSubmissionId,
        submittedUrl: 'https://e-hentai.org/g/retry-at-capacity/token/',
        normalizedUrlHash: 'f'.repeat(64),
        status: 'FAILED',
        finishedAt: new Date(),
        retryable: true
      }
    })
    const replacementAtCapacity = await replaceArchiveIntakeItem(
      {
        idempotencyKey: `${suitePrefix}-replace-at-capacity`,
        itemId: failedItem.id,
        url: 'https://e-hentai.org/g/replace-at-capacity/corrected-token/'
      },
      requestedByUserId,
      { database, validateUrl }
    )
    expect(replacementAtCapacity).toMatchObject({
      rawCount: 1,
      acceptedCount: 0,
      duplicateCount: 0,
      rejectedCount: 1
    })
    expect(replacementAtCapacity.items).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        supersedesItemId: failedItem.id,
        errorCode: 'CAPACITY_EXCEEDED',
        retryable: true,
        currentSystemJobId: null
      })
    ])
    await expect(
      database.systemJob.count({
        where: { payload: { path: ['intakeItemId'], equals: replacementAtCapacity.items[0]!.id } }
      })
    ).resolves.toBe(0)

    const retry = await retryArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-retry-capacity`, itemIds: [failedItem.id] },
      requestedByUserId,
      { database }
    )
    expect(retry?.items).toEqual([
      expect.objectContaining({ targetId: failedItem.id, result: 'SKIPPED', code: 'CAPACITY_EXCEEDED' })
    ])
    await expect(
      database.systemJob.count({ where: { payload: { path: ['intakeItemId'], equals: failedItem.id } } })
    ).resolves.toBe(0)

    const expiredReady = await database.archiveIntakeItem.findFirstOrThrow({
      where: { submissionId: seededSubmissionId, status: 'QUEUED' }
    })
    await database.archiveIntakeItem.update({
      where: { id: expiredReady.id },
      data: { status: 'READY', expiresAt: new Date('2026-08-17T00:00:00.000Z') }
    })
    const staleRetry = await retryArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-retry-stale-at-capacity`, itemIds: [expiredReady.id] },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T00:00:00.000Z') }
    )
    expect(staleRetry?.items).toEqual([expect.objectContaining({ targetId: expiredReady.id, result: 'APPLIED' })])
    await expect(
      database.archiveIntakeItem.count({
        where: { status: { in: ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] } }
      })
    ).resolves.toBe(1_000)
  })

  it('creates one submission and resolver job for concurrent semantic replay', async () => {
    const input = {
      idempotencyKey: `${suitePrefix}-same-create`,
      urls: ['https://e-hentai.org/g/123/token/']
    }
    const [first, second] = await Promise.all([
      createArchiveIntakeSubmission(input, requestedByUserId, { database, validateUrl }),
      createArchiveIntakeSubmission(input, requestedByUserId, { database, validateUrl })
    ])
    expect(first).toEqual(second)
    await expect(
      database.archiveIntakeSubmission.count({ where: { idempotencyKey: input.idempotencyKey } })
    ).resolves.toBe(1)
    await expect(
      database.systemJob.count({ where: { requestedByUserId, type: 'ARCHIVE_RESOLVE_ITEM' } })
    ).resolves.toBe(1)

    await expect(
      createArchiveIntakeSubmission({ ...input, urls: ['not-a-url'] }, requestedByUserId, { database, validateUrl })
    ).rejects.toBeInstanceOf(ArchiveError)
  })

  it('replaces a failed item immutably and replays one lineage item and resolver job under concurrency', async () => {
    const timestamp = new Date('2026-08-18T04:00:00.000Z')
    const source = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-replace-source`,
        idempotencyKey: `${suitePrefix}-replace-source`,
        requestHash: '8'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            submittedUrl: 'https://e-hentai.org/g/replace-source/old-token/',
            normalizedUrlHash: '9'.repeat(64),
            status: 'FAILED',
            errorCode: 'REMOTE_NOT_FOUND',
            errorMessage: 'old permanent failure',
            errorStage: 'SOURCE_PAGE',
            retryable: false,
            finishedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        }
      },
      include: { items: true }
    })
    const original = source.items[0]!
    const originalBefore = await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: original.id } })
    const input = {
      idempotencyKey: `${suitePrefix}-replace-operation`,
      itemId: original.id,
      url: 'https://e-hentai.org/g/replace-source/new-token/'
    }

    const [first, replay] = await Promise.all([
      replaceArchiveIntakeItem(input, requestedByUserId, { database, validateUrl, now: () => timestamp }),
      replaceArchiveIntakeItem(input, requestedByUserId, { database, validateUrl, now: () => timestamp })
    ])
    expect(replay).toEqual(first)
    expect(first).toMatchObject({ rawCount: 1, acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 })
    expect(first.items).toEqual([
      expect.objectContaining({
        status: 'QUEUED',
        supersedesItemId: original.id,
        currentSystemJobId: expect.any(String)
      })
    ])
    await expect(database.archiveIntakeItem.findUniqueOrThrow({ where: { id: original.id } })).resolves.toEqual(
      originalBefore
    )
    await expect(
      database.archiveIntakeSubmission.count({ where: { idempotencyKey: input.idempotencyKey } })
    ).resolves.toBe(1)
    await expect(database.archiveIntakeItem.count({ where: { supersedesItemId: original.id } })).resolves.toBe(1)
    const replacement = await database.archiveIntakeItem.findFirstOrThrow({ where: { supersedesItemId: original.id } })
    await expect(
      database.systemJob.findUniqueOrThrow({ where: { id: replacement.currentSystemJobId! } })
    ).resolves.toMatchObject({
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      triggerSource: 'RETRY',
      status: 'PENDING',
      payload: { intakeItemId: replacement.id }
    })

    await expect(
      replaceArchiveIntakeItem(
        { ...input, url: 'https://e-hentai.org/g/replace-source/changed-again/' },
        requestedByUserId,
        { database, validateUrl }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(
      replaceArchiveIntakeItem(
        {
          idempotencyKey: `${suitePrefix}-replace-original-url`,
          itemId: original.id,
          url: original.submittedUrl
        },
        requestedByUserId,
        { database, validateUrl }
      )
    ).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('records an active replacement URL as a terminal duplicate while preserving supersession lineage', async () => {
    const active = await createArchiveIntakeSubmission(
      {
        idempotencyKey: `${suitePrefix}-replace-duplicate-active`,
        urls: ['https://e-hentai.org/g/replace-duplicate/active-token/']
      },
      requestedByUserId,
      { database, validateUrl }
    )
    const failedSubmission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-replace-duplicate-source`,
        idempotencyKey: `${suitePrefix}-replace-duplicate-source`,
        requestHash: 'a'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            submittedUrl: 'https://e-hentai.org/g/replace-duplicate/broken-token/',
            normalizedUrlHash: 'b'.repeat(64),
            status: 'FAILED',
            retryable: false,
            finishedAt: new Date()
          }
        }
      },
      include: { items: true }
    })
    const original = failedSubmission.items[0]!
    const result = await replaceArchiveIntakeItem(
      {
        idempotencyKey: `${suitePrefix}-replace-duplicate-operation`,
        itemId: original.id,
        url: 'https://e-hentai.org/g/replace-duplicate/active-token/'
      },
      requestedByUserId,
      { database, validateUrl }
    )
    expect(result).toMatchObject({ acceptedCount: 0, duplicateCount: 1, rejectedCount: 0 })
    expect(result.items).toEqual([
      expect.objectContaining({
        status: 'DUPLICATE',
        supersedesItemId: original.id,
        duplicateOfItemId: active.items[0]!.id,
        currentSystemJobId: null
      })
    ])
    await expect(database.archiveIntakeItem.findUniqueOrThrow({ where: { id: original.id } })).resolves.toMatchObject({
      status: 'FAILED',
      submittedUrl: original.submittedUrl,
      supersedesItemId: null
    })
  })

  it('skips permanent failed retries while cancelled items remain retryable', async () => {
    const permanentSubmission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-permanent-retry-source`,
        idempotencyKey: `${suitePrefix}-permanent-retry-source`,
        requestHash: 'c'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: {
          create: {
            submittedUrl: 'https://e-hentai.org/g/permanent-retry/token/',
            normalizedUrlHash: 'd'.repeat(64),
            status: 'FAILED',
            retryable: false,
            finishedAt: new Date()
          }
        }
      },
      include: { items: true }
    })
    const permanent = permanentSubmission.items[0]!
    const permanentResult = await retryArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-permanent-retry-operation`, itemIds: [permanent.id] },
      requestedByUserId,
      { database }
    )
    expect(permanentResult?.items).toEqual([
      expect.objectContaining({ targetId: permanent.id, result: 'SKIPPED', code: 'PERMANENT_FAILURE' })
    ])
    await expect(
      database.systemJob.count({ where: { payload: { path: ['intakeItemId'], equals: permanent.id } } })
    ).resolves.toBe(0)
    await expect(database.archiveIntakeItem.findUniqueOrThrow({ where: { id: permanent.id } })).resolves.toMatchObject({
      status: 'FAILED',
      retryable: false
    })

    const cancellable = await createArchiveIntakeSubmission(
      {
        idempotencyKey: `${suitePrefix}-cancelled-retry-source`,
        urls: ['https://e-hentai.org/g/cancelled-retry/token/']
      },
      requestedByUserId,
      { database, validateUrl }
    )
    const cancelledItemId = cancellable.items[0]!.id
    await cancelArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-cancelled-retry-cancel`, itemIds: [cancelledItemId] },
      requestedByUserId,
      { database }
    )
    const cancelledRetry = await retryArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-cancelled-retry-operation`, itemIds: [cancelledItemId] },
      requestedByUserId,
      { database }
    )
    expect(cancelledRetry?.items).toEqual([expect.objectContaining({ targetId: cancelledItemId, result: 'APPLIED' })])
  })

  it('rejects retry when the resolved provider identity is already active', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const submission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-retry-identity-submission`,
        idempotencyKey: `${suitePrefix}-retry-identity-submission`,
        requestHash: '6'.repeat(64),
        requestedByUserId,
        rawCount: 2,
        acceptedCount: 2,
        items: {
          create: [
            readyItemData('retry-identity', now),
            {
              submittedUrl: 'https://e-hentai.org/g/retry-identity/another-token/',
              normalizedUrlHash: '7'.repeat(64),
              status: 'FAILED',
              providerKey: 'test-provider',
              externalId: 'retry-identity',
              finishedAt: now,
              retryable: true
            }
          ]
        }
      },
      include: { items: { orderBy: { queueOrder: 'asc' } } }
    })
    const failedItem = submission.items.find((item) => item.status === 'FAILED')!
    const result = await retryArchiveIntakeMany(
      {
        idempotencyKey: `${suitePrefix}-retry-identity-operation`,
        itemIds: [failedItem.id]
      },
      requestedByUserId,
      { database, now: () => now }
    )
    expect(result?.items).toEqual([
      expect.objectContaining({
        targetId: failedItem.id,
        result: 'CONFLICT',
        code: 'ACTIVE_DUPLICATE',
        relatedId: submission.items.find((item) => item.status === 'READY')!.id
      })
    ])
    await expect(
      database.systemJob.count({ where: { payload: { path: ['intakeItemId'], equals: failedItem.id } } })
    ).resolves.toBe(0)
  })

  it('classifies invalid and exact duplicate strings without changing token semantics', async () => {
    const url = 'https://e-hentai.org/g/duplicate/private-token/?b=2&a=1'
    const first = await createArchiveIntakeSubmission(
      { idempotencyKey: `${suitePrefix}-duplicates-a`, urls: [url, url, 'invalid'] },
      requestedByUserId,
      { database, validateUrl }
    )
    expect(first).toMatchObject({ rawCount: 3, acceptedCount: 1, duplicateCount: 1, invalidCount: 1, rejectedCount: 0 })

    const second = await createArchiveIntakeSubmission(
      { idempotencyKey: `${suitePrefix}-duplicates-b`, urls: [url] },
      requestedByUserId,
      { database, validateUrl }
    )
    expect(second).toMatchObject({ rawCount: 1, acceptedCount: 0, duplicateCount: 1, invalidCount: 0 })
    expect(second.items).toEqual([
      expect.objectContaining({
        status: 'DUPLICATE',
        resolutionKind: null,
        submittedUrl: 'https://e-hentai.org/g/…'
      })
    ])
    expect(JSON.stringify(second)).not.toContain('private-token')
  })

  it('persists partial bulk results and keeps completedAt stable on replay', async () => {
    const created = await createArchiveIntakeSubmission(
      {
        idempotencyKey: `${suitePrefix}-cancel-source`,
        urls: ['https://e-hentai.org/g/cancel/token/']
      },
      requestedByUserId,
      { database, validateUrl }
    )
    const itemId = created.items[0]!.id
    const input = { idempotencyKey: `${suitePrefix}-cancel-bulk`, itemIds: [itemId, `${suitePrefix}-missing`] }
    const [first, concurrent] = await Promise.all([
      cancelArchiveIntakeMany(input, requestedByUserId, {
        database,
        now: () => new Date('2026-08-18T01:00:00.000Z')
      }),
      cancelArchiveIntakeMany(input, requestedByUserId, {
        database,
        now: () => new Date('2026-08-18T02:00:00.000Z')
      })
    ])
    expect(first?.id).toBe(concurrent?.id)
    expect(first?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: itemId, result: expect.stringMatching(/APPLIED|REUSED/) }),
        expect.objectContaining({ targetId: `${suitePrefix}-missing`, result: 'SKIPPED' })
      ])
    )
    const completedAt = (await database.archiveBulkOperation.findUniqueOrThrow({ where: { id: first!.id } }))
      .completedAt
    await cancelArchiveIntakeMany(input, requestedByUserId, {
      database,
      now: () => new Date('2026-08-19T00:00:00.000Z')
    })
    await expect(database.archiveBulkOperation.findUniqueOrThrow({ where: { id: first!.id } })).resolves.toMatchObject({
      completedAt
    })
    await expect(
      database.archiveBulkOperation.count({ where: { idempotencyKey: input.idempotencyKey } })
    ).resolves.toBe(1)
    await expect(database.archiveBulkOperationItem.count({ where: { operationId: first!.id } })).resolves.toBe(2)
    const jobId = created.items[0]!.currentSystemJobId!
    const cancelEvents = await database.systemJobEvent.findMany({
      where: { jobId, type: { in: ['job.cancel_requested', 'job.cancelled'] } },
      orderBy: { id: 'asc' },
      select: { type: true }
    })
    expect(cancelEvents).toEqual([{ type: 'job.cancel_requested' }, { type: 'job.cancelled' }])
  })

  it('keeps a running resolver cancellation at requested without a terminal event', async () => {
    const created = await createArchiveIntakeSubmission(
      {
        idempotencyKey: `${suitePrefix}-running-cancel-source`,
        urls: ['https://e-hentai.org/g/running-cancel/token/']
      },
      requestedByUserId,
      { database, validateUrl }
    )
    const item = created.items[0]!
    const timestamp = new Date('2026-08-18T03:00:00.000Z')
    await database.systemJob.update({
      where: { id: item.currentSystemJobId! },
      data: { status: 'RUNNING', startedAt: timestamp }
    })
    await database.archiveIntakeItem.update({
      where: { id: item.id },
      data: { status: 'RESOLVING', startedAt: timestamp }
    })

    const operation = await cancelArchiveIntakeMany(
      { idempotencyKey: `${suitePrefix}-running-cancel`, itemIds: [item.id] },
      requestedByUserId,
      { database, now: () => new Date('2026-08-18T03:01:00.000Z') }
    )
    expect(operation?.items).toEqual([expect.objectContaining({ targetId: item.id, result: 'APPLIED' })])
    await expect(
      database.systemJob.findUniqueOrThrow({ where: { id: item.currentSystemJobId! } })
    ).resolves.toMatchObject({ status: 'CANCELLING' })
    await expect(database.archiveIntakeItem.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({
      status: 'RESOLVING',
      cancelRequestedAt: new Date('2026-08-18T03:01:00.000Z')
    })
    const cancelEvents = await database.systemJobEvent.findMany({
      where: { jobId: item.currentSystemJobId!, type: { in: ['job.cancel_requested', 'job.cancelled'] } },
      select: { type: true }
    })
    expect(cancelEvents).toEqual([{ type: 'job.cancel_requested' }])
  })

  it('reuses an active identity and creates an independent task for the other ready item', async () => {
    const submissionId = `${suitePrefix}-enqueue-source`
    const now = new Date('2026-08-18T00:00:00.000Z')
    const activeJobId = `${suitePrefix}-active-job`
    const activeImportId = `${suitePrefix}-active-import`
    await database.systemJob.create({
      data: {
        id: activeJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId,
        payload: { archiveImportId: activeImportId }
      }
    })
    await database.archiveImport.create({
      data: archiveImportData(activeImportId, activeJobId, 'active-identity')
    })
    const readyItems = await database.archiveIntakeSubmission.create({
      data: {
        id: submissionId,
        idempotencyKey: submissionId,
        requestHash: '2'.repeat(64),
        requestedByUserId,
        rawCount: 2,
        acceptedCount: 2,
        items: {
          create: [readyItemData('active-identity', now), readyItemData('new-identity', now)]
        }
      },
      include: { items: { orderBy: { queueOrder: 'asc' } } }
    })
    await database.archiveIntakeItem.update({
      where: { id: readyItems.items[1]!.id },
      data: { resolutionKind: 'UNCHANGED' }
    })
    const enqueueInput = {
      idempotencyKey: `${suitePrefix}-enqueue-bulk`,
      items: readyItems.items.map((item) => ({
        itemId: item.id,
        quality: 'ORIGINAL' as const
      }))
    }
    const result = await enqueueArchiveIntakeMany(enqueueInput, requestedByUserId, {
      database,
      now: () => now,
      systemSettings: {
        replace_default_tag_ids: [],
        local_import_default_tag_ids: [],
        archive_default_tag_ids: [9, 2, 9]
      }
    })
    expect(result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: readyItems.items[0]!.id, result: 'REUSED', relatedId: activeImportId }),
        expect.objectContaining({ targetId: readyItems.items[1]!.id, result: 'CREATED' })
      ])
    )
    await expect(
      database.archiveImport.count({ where: { providerKey: 'test-provider', status: 'PENDING' } })
    ).resolves.toBe(2)
    await expect(
      database.archiveImportItem.count({ where: { archiveImport: { externalId: 'new-identity' } } })
    ).resolves.toBe(1)
    const createdImport = await database.archiveImport.findFirstOrThrow({
      where: { providerKey: 'test-provider', externalId: 'new-identity' },
      include: { systemJob: true }
    })
    expect(createdImport.systemJob).toMatchObject({
      definitionVersion: 2,
      payload: { archiveImportId: createdImport.id, defaultTagIds: [2, 9] }
    })
    await expect(
      database.archiveIntakeItem.findUniqueOrThrow({ where: { id: readyItems.items[0]!.id } })
    ).resolves.toMatchObject({
      selectedQuality: 'ORIGINAL',
      archiveImportId: activeImportId,
      activeArchiveImportId: activeImportId
    })

    const changedQualityRequest = await enqueueArchiveIntakeMany(
      {
        idempotencyKey: `${suitePrefix}-enqueue-reused-new-quality`,
        items: [{ itemId: readyItems.items[0]!.id, quality: 'DISPLAY' }]
      },
      requestedByUserId,
      {
        database
      }
    )
    expect(changedQualityRequest?.items).toEqual([
      expect.objectContaining({
        result: 'REUSED',
        relatedId: activeImportId,
        code: 'QUALITY_ALREADY_FIXED'
      })
    ])
    await expect(
      database.archiveIntakeItem.findUniqueOrThrow({ where: { id: readyItems.items[0]!.id } })
    ).resolves.toMatchObject({ selectedQuality: 'ORIGINAL' })

    const replay = await enqueueArchiveIntakeMany(enqueueInput, requestedByUserId, {
      database,
      now: () => new Date('2026-08-19T00:00:00.000Z')
    })
    expect(replay).toEqual(result)
  })

  it('reuses an active import without consulting Web storage configuration', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const activeJobId = `${suitePrefix}-reuse-only-job`
    const activeImportId = `${suitePrefix}-reuse-only-import`
    await database.systemJob.create({
      data: {
        id: activeJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId,
        payload: { archiveImportId: activeImportId }
      }
    })
    await database.archiveImport.create({ data: archiveImportData(activeImportId, activeJobId, 'reuse-only') })
    const submission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-reuse-only-submission`,
        idempotencyKey: `${suitePrefix}-reuse-only-submission`,
        requestHash: '3'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: { create: readyItemData('reuse-only', now) }
      },
      include: { items: true }
    })
    const result = await enqueueArchiveIntakeMany(
      {
        idempotencyKey: `${suitePrefix}-reuse-only-operation`,
        items: [{ itemId: submission.items[0]!.id, quality: 'DISPLAY' }]
      },
      requestedByUserId,
      {
        database,
        now: () => now
      }
    )
    expect(result?.items).toEqual([expect.objectContaining({ result: 'REUSED', relatedId: activeImportId })])
    await expect(
      database.archiveIntakeItem.findUniqueOrThrow({ where: { id: submission.items[0]!.id } })
    ).resolves.toMatchObject({
      status: 'ENQUEUED',
      selectedQuality: 'ORIGINAL',
      archiveImportId: activeImportId,
      activeArchiveImportId: activeImportId
    })
  })

  it('creates relative staging paths without consulting Web storage configuration', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const activeJobId = `${suitePrefix}-partial-storage-job`
    const activeImportId = `${suitePrefix}-partial-storage-import`
    await database.systemJob.create({
      data: {
        id: activeJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId,
        payload: { archiveImportId: activeImportId }
      }
    })
    await database.archiveImport.create({
      data: archiveImportData(activeImportId, activeJobId, 'partial-storage-reuse')
    })
    const submission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-partial-storage-submission`,
        idempotencyKey: `${suitePrefix}-partial-storage-submission`,
        requestHash: '5'.repeat(64),
        requestedByUserId,
        rawCount: 2,
        acceptedCount: 2,
        items: {
          create: [readyItemData('partial-storage-reuse', now), readyItemData('partial-storage-create', now)]
        }
      },
      include: { items: { orderBy: { queueOrder: 'asc' } } }
    })
    const result = await enqueueArchiveIntakeMany(
      {
        idempotencyKey: `${suitePrefix}-partial-storage-operation`,
        items: submission.items.map((item) => ({ itemId: item.id, quality: 'ORIGINAL' as const }))
      },
      requestedByUserId,
      {
        database,
        now: () => now
      }
    )
    expect(result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: submission.items[0]!.id,
          result: 'REUSED',
          relatedId: activeImportId
        }),
        expect.objectContaining({
          targetId: submission.items[1]!.id,
          result: 'CREATED'
        })
      ])
    )
  })

  it('serializes concurrent commands for one target without changing the winning import quality', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z')
    const submission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-quality-race-submission`,
        idempotencyKey: `${suitePrefix}-quality-race-submission`,
        requestHash: '4'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: { create: readyItemData('quality-race', now) }
      },
      include: { items: { orderBy: { queueOrder: 'asc' } } }
    })
    const [originalRequest, displayRequest] = await Promise.all([
      enqueueArchiveIntakeMany(
        {
          idempotencyKey: `${suitePrefix}-quality-race-original`,
          items: [{ itemId: submission.items[0]!.id, quality: 'ORIGINAL' }]
        },
        requestedByUserId,
        { database, now: () => now }
      ),
      enqueueArchiveIntakeMany(
        {
          idempotencyKey: `${suitePrefix}-quality-race-display`,
          items: [{ itemId: submission.items[0]!.id, quality: 'DISPLAY' }]
        },
        requestedByUserId,
        { database, now: () => now }
      )
    ])
    expect([originalRequest?.items[0]?.result, displayRequest?.items[0]?.result].sort()).toEqual(['CREATED', 'REUSED'])
    const archiveImport = await database.archiveImport.findFirstOrThrow({
      where: { providerKey: 'test-provider', externalId: 'quality-race' }
    })
    await expect(
      database.archiveIntakeItem.findUniqueOrThrow({ where: { id: submission.items[0]!.id } })
    ).resolves.toMatchObject({
      status: 'ENQUEUED',
      selectedQuality: archiveImport.selectedQuality,
      archiveImportId: archiveImport.id,
      activeArchiveImportId: archiveImport.id
    })
  })

  it('serializes intake enqueue against trash intent under the shared publish lock', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const now = new Date('2026-08-18T06:00:00.000Z')
    const externalId = `enqueue-trash-race-${randomUUID()}`
    const originalJobId = `${suitePrefix}-enqueue-trash-original-job`
    const originalImportId = `${suitePrefix}-enqueue-trash-original-import`
    const triggerName = `archive_enqueue_delay_${randomUUID().replaceAll('-', '')}`
    const functionName = `${triggerName}_fn`
    const artwork = await database.artwork.create({
      data: {
        title: `${suitePrefix}-enqueue-trash-artwork`,
        createdVia: 'URL_ARCHIVE',
        source: 'URL_ARCHIVE',
        archiveLifecycleState: 'ACTIVE'
      }
    })
    const externalRef = await database.artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'test-provider',
        externalId,
        canonicalUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
        locator: {}
      }
    })
    await database.systemJob.create({
      data: {
        id: originalJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'COMPLETED',
        triggerSource: 'MANUAL',
        requestedByUserId,
        payload: { archiveImportId: originalImportId },
        progress: 100,
        finishedAt: now
      }
    })
    await database.archiveImport.create({
      data: {
        ...archiveImportData(originalImportId, originalJobId, externalId),
        status: 'COMPLETED',
        externalRefId: externalRef.id,
        publishedArtworkId: artwork.id,
        finishedAt: now
      }
    })
    await database.archiveRevision.create({
      data: {
        id: `${suitePrefix}-enqueue-trash-revision`,
        artworkId: artwork.id,
        externalRefId: externalRef.id,
        archiveImportId: originalImportId,
        archivePath: `sources/test-provider/test-creator/${externalId}/revisions/${originalImportId}`,
        manifestPath: `sources/test-provider/test-creator/${externalId}/revisions/${originalImportId}/manifest.json`,
        mediaSnapshot: [],
        metadataHash: 'a'.repeat(64),
        isCurrent: true
      }
    })
    const submission = await database.archiveIntakeSubmission.create({
      data: {
        id: `${suitePrefix}-enqueue-trash-submission`,
        idempotencyKey: `${suitePrefix}-enqueue-trash-submission`,
        requestHash: 'e'.repeat(64),
        requestedByUserId,
        rawCount: 1,
        acceptedCount: 1,
        items: { create: readyItemData(externalId, now) }
      },
      include: { items: true }
    })

    await database.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."externalId" = '${externalId}' AND NEW."id" <> '${originalImportId}' THEN
          PERFORM pg_sleep(1);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "archive_imports"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `)

    try {
      const enqueuePromise = enqueueArchiveIntakeMany(
        {
          idempotencyKey: `${suitePrefix}-enqueue-trash-operation`,
          items: [{ itemId: submission.items[0]!.id, quality: 'ORIGINAL' }]
        },
        requestedByUserId,
        {
          database,
          now: () => now
        }
      )
      await vi.waitFor(
        async () => {
          const rows = await database.$queryRaw<Array<{ sleeping: boolean }>>(Prisma.sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity WHERE wait_event = 'PgSleep'
            ) AS "sleeping"
          `)
          expect(rows[0]?.sleeping).toBe(true)
        },
        { timeout: 5_000, interval: 20 }
      )
      const trashPromise = archiveModule.requestAction(originalImportId, 'DELETE_ARCHIVE', {
        requestedByUserId
      })
      const [enqueueResult, trashResult] = await Promise.allSettled([enqueuePromise, trashPromise])

      expect(enqueueResult).toMatchObject({
        status: 'fulfilled',
        value: { items: [expect.objectContaining({ result: 'CREATED' })] }
      })
      expect(trashResult).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'STATE_CONFLICT' })
      })
      await expect(database.artwork.findUniqueOrThrow({ where: { id: artwork.id } })).resolves.toMatchObject({
        archiveLifecycleState: 'ACTIVE',
        deletedAt: null
      })
      await expect(
        database.archiveImport.count({
          where: {
            providerKey: 'test-provider',
            externalId,
            status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
          }
        })
      ).resolves.toBe(1)
      await expect(
        database.systemJob.count({
          where: {
            requestedByUserId,
            type: 'ARCHIVE_MAINTENANCE',
            payload: { path: ['artworkId'], equals: artwork.id }
          }
        })
      ).resolves.toBe(0)
    } finally {
      await database.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "archive_imports"`)
      await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }
  })
})

function readyItemData(externalId: string, now: Date): Prisma.ArchiveIntakeItemCreateWithoutSubmissionInput {
  const resolved = resolvedArchive(externalId)
  return {
    submittedUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
    normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    status: 'READY',
    providerKey: resolved.providerKey,
    externalId,
    canonicalUrl: resolved.canonicalUrl,
    resolvedTitle: resolved.title,
    pageCount: 1,
    resolvedSnapshot: JSON.parse(JSON.stringify(resolved)) as Prisma.InputJsonValue,
    metadataHash: 'a'.repeat(64),
    resolutionKind: 'NEW',
    resolvedAt: now,
    expiresAt: new Date(now.getTime() + 60_000)
  }
}

function resolvedArchive(externalId: string) {
  return {
    providerKey: 'test-provider',
    externalId,
    canonicalUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
    locator: { token: 'private-token' },
    title: `Gallery ${externalId}`,
    titleAliases: [],
    description: null,
    category: null,
    uploader: null,
    thumbnailUrl: null,
    postedAt: null,
    tags: [],
    relationships: [],
    media: [
      {
        index: 0,
        sourcePageUrl: `https://e-hentai.org/s/private-page/${externalId}-1`,
        locator: { token: 'private-page' },
        expectedFilename: '0001'
      }
    ],
    normalizedMetadata: { titles: { display: `Gallery ${externalId}` } },
    rawMetadata: { token: 'private-token' },
    warnings: [],
    creatorBucket: 'test-creator'
  }
}

function archiveImportData(
  importId: string,
  jobId: string,
  externalId: string
): Prisma.ArchiveImportUncheckedCreateInput {
  const resolved = resolvedArchive(externalId)
  return {
    id: importId,
    systemJobId: jobId,
    providerKey: resolved.providerKey,
    externalId,
    submittedUrl: resolved.canonicalUrl,
    canonicalUrl: resolved.canonicalUrl,
    locator: resolved.locator,
    requestedQuality: 'ORIGINAL',
    selectedQuality: 'ORIGINAL',
    normalizedMetadata: resolved.normalizedMetadata,
    rawMetadata: resolved.rawMetadata,
    metadataHash: 'a'.repeat(64),
    creatorBucket: resolved.creatorBucket,
    stagingPath: `.archive-staging/${importId}`,
    totalItems: 1
  }
}
