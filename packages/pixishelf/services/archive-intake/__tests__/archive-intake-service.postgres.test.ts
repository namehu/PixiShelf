import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, Prisma } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ArchiveError } from '@/services/archive/errors'
import {
  cancelArchiveIntakeMany,
  createArchiveIntakeSubmission,
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
    await database.systemJob.deleteMany({
      where: { OR: [{ requestedByUserId }, ...(itemJobIds.length ? [{ id: { in: itemJobIds } }] : [])] }
    })
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
        finishedAt: new Date()
      }
    })
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
      resolveStorageRoot: async () => '/tmp/pixishelf-stage2-archive'
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
        database,
        resolveStorageRoot: async () => {
          throw new Error('storage setting temporarily unavailable')
        }
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
      now: () => new Date('2026-08-19T00:00:00.000Z'),
      resolveStorageRoot: async () => {
        throw new Error('storage setting temporarily unavailable')
      }
    })
    expect(replay).toEqual(result)
  })

  it('reuses an active import without consulting unavailable storage configuration', async () => {
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
        now: () => now,
        resolveStorageRoot: async () => {
          throw new Error('storage setting temporarily unavailable')
        }
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

  it('persists reusable targets when storage configuration blocks only new imports', async () => {
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
        now: () => now,
        resolveStorageRoot: async () => {
          throw new Error('storage setting temporarily unavailable')
        }
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
          result: 'CONFLICT',
          code: 'STORAGE_ROOT_UNAVAILABLE'
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
        { database, now: () => now, resolveStorageRoot: async () => '/tmp/pixishelf-stage2-archive' }
      ),
      enqueueArchiveIntakeMany(
        {
          idempotencyKey: `${suitePrefix}-quality-race-display`,
          items: [{ itemId: submission.items[0]!.id, quality: 'DISPLAY' }]
        },
        requestedByUserId,
        { database, now: () => now, resolveStorageRoot: async () => '/tmp/pixishelf-stage2-archive' }
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
