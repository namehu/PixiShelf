import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import {
  createArchiveUploaderComparisonSnapshot,
  executeArchiveUploaderScan,
  hashArchiveUploaderDiscoveryMetadata
} from '@pixishelf/job-executors'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { cancelArchiveIntakeMany, createArchiveIntakeSubmission } from '../../archive-intake/archive-intake-service'
import { archiveModule } from '../../archive/archive-module'
import {
  addArchiveUploaderScanItems,
  ignoreArchiveUploaderScanItems,
  listArchiveUploaderIgnoredItems,
  listArchiveUploaderScanItems,
  restoreArchiveUploaderIgnoredItems
} from '../archive-uploader-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-uploader-ignore-${randomUUID()}`
const sharedExternalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()
const secondExternalId = (BigInt(sharedExternalId) + 1n).toString()

describePostgres('archive uploader ignored gallery PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })

  it('applies an ignored Provider/GID globally and restores it without changing scan history', async () => {
    const first = await seedCompletedScan('first', '1001')
    const second = await seedCompletedScan('second', '1002')

    const ignored = await ignoreArchiveUploaderScanItems(
      { sourceId: first.sourceId, itemIds: [first.catalogItemId] },
      'admin-1',
      { database: db() }
    )
    expect(ignored).toMatchObject({ ignoredCount: 1, createdCount: 1, reusedCount: 0 })

    await expect(
      ignoreArchiveUploaderScanItems({ sourceId: second.sourceId, itemIds: [second.catalogItemId] }, 'admin-1', {
        database: db()
      })
    ).resolves.toMatchObject({ ignoredCount: 1, createdCount: 0, reusedCount: 1 })

    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, limit: 50 }, { database: db() })
    ).resolves.toMatchObject({ items: [] })
    const ignoredFeed = await listArchiveUploaderIgnoredItems({ limit: 50 }, { database: db() })
    expect(ignoredFeed.items).toContainEqual(
      expect.objectContaining({ externalId: sharedExternalId, sourceDisplayName: 'Uploader first' })
    )

    await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: ignored.ignoredItemIds }, { database: db() })
    const restoredFeed = await listArchiveUploaderScanItems(
      { sourceId: second.sourceId, limit: 50 },
      { database: db() }
    )
    expect(restoredFeed.items).toHaveLength(1)
    expect(restoredFeed.items[0]).toMatchObject({
      externalId: sharedExternalId,
      thumbnailUrl: 'https://ehgt.org/thumb.jpg'
    })
    await expect(
      db().archiveUploaderScanItem.count({ where: { id: { in: [first.scanItemId, second.scanItemId] } } })
    ).resolves.toBe(2)
  })

  it('serializes ignore before intake so a stale add attempt cannot enqueue the same gallery', async () => {
    const ignoreScan = await seedCompletedScan('ignore-wins-first', '2001')
    const addScan = await seedCompletedScan('ignore-wins-second', '2002')
    const ignoreLocked = deferred()
    const releaseIgnore = deferred()
    const addReachedLock = deferred()
    const ignorePromise = ignoreArchiveUploaderScanItems(
      { sourceId: ignoreScan.sourceId, itemIds: [ignoreScan.catalogItemId] },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({
          after: async () => {
            ignoreLocked.resolve()
            await releaseIgnore.promise
          }
        })
      }
    )
    await ignoreLocked.promise
    const addPromise = addArchiveUploaderScanItems(
      {
        sourceId: addScan.sourceId,
        itemIds: [addScan.catalogItemId],
        submissionAttemptId: randomUUID()
      },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({ before: async () => addReachedLock.resolve() }),
        uuid: prefixedUuidFactory('ignore-wins')
      }
    )
    await addReachedLock.promise
    releaseIgnore.resolve()

    const [ignoreResult, addResult] = await Promise.allSettled([ignorePromise, addPromise])
    expect(ignoreResult.status).toBe('fulfilled')
    expect(addResult).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
    await expect(
      db().archiveUploaderIgnoredItem.count({ where: { providerKey: 'e-hentai', externalId: sharedExternalId } })
    ).resolves.toBe(1)
    await expect(db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-admin` } })).resolves.toBe(
      0
    )
  })

  it('serializes intake before ignore so an enqueued gallery cannot become globally ignored', async () => {
    const addScan = await seedCompletedScan('intake-wins-first', '3001')
    const ignoreScan = await seedCompletedScan('intake-wins-second', '3002')
    const addLocked = deferred()
    const releaseAdd = deferred()
    const ignoreReachedLock = deferred()
    const addPromise = addArchiveUploaderScanItems(
      {
        sourceId: addScan.sourceId,
        itemIds: [addScan.catalogItemId],
        submissionAttemptId: randomUUID()
      },
      `${prefix}-admin`,
      {
        database: databaseWithFirstLockHooks({
          after: async () => {
            addLocked.resolve()
            await releaseAdd.promise
          }
        }),
        uuid: prefixedUuidFactory('intake-wins')
      }
    )
    await addLocked.promise
    const ignorePromise = ignoreArchiveUploaderScanItems(
      { sourceId: ignoreScan.sourceId, itemIds: [ignoreScan.catalogItemId] },
      `${prefix}-admin`,
      { database: databaseWithFirstLockHooks({ before: async () => ignoreReachedLock.resolve() }) }
    )
    await ignoreReachedLock.promise
    releaseAdd.resolve()

    const [addResult, ignoreResult] = await Promise.allSettled([addPromise, ignorePromise])
    expect(addResult).toMatchObject({ status: 'fulfilled', value: { acceptedCount: 1 } })
    expect(ignoreResult).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } })
    await expect(
      db().archiveUploaderIgnoredItem.count({ where: { providerKey: 'e-hentai', externalId: sharedExternalId } })
    ).resolves.toBe(0)
    const linkedCatalogItems = await db().archiveUploaderCatalogItem.findMany({
      where: { id: { in: [addScan.catalogItemId, ignoreScan.catalogItemId] } },
      select: { lastIntakeItemId: true, lastOutcome: true }
    })
    expect(linkedCatalogItems).toHaveLength(2)
    expect(linkedCatalogItems[0]?.lastIntakeItemId).toEqual(expect.any(String))
    expect(new Set(linkedCatalogItems.map((item) => item.lastIntakeItemId)).size).toBe(1)
    expect(linkedCatalogItems.every((item) => item.lastOutcome === 'SUBMITTED')).toBe(true)
  })

  it('returns the original server submission when the same successful request is replayed', async () => {
    const seeded = await seedCompletedScan('server-replay', '3004')
    const submissionAttemptId = randomUUID()
    const first = await addArchiveUploaderScanItems(
      { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId },
      `${prefix}-replay-admin`,
      { database: db(), uuid: prefixedUuidFactory('replay-first') }
    )
    const intakeCount = await db().archiveIntakeItem.count({ where: { submissionId: first.id } })

    const replayed = await addArchiveUploaderScanItems(
      { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId },
      `${prefix}-replay-admin`,
      { database: db(), uuid: prefixedUuidFactory('replay-second') }
    )

    expect(replayed).toEqual(first)
    await expect(
      db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-replay-admin` } })
    ).resolves.toBe(1)
    await expect(db().archiveIntakeItem.count({ where: { submissionId: first.id } })).resolves.toBe(intakeCount)

    const originalIntake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: first.id } })
    const archivedAt = new Date('2026-09-04T00:00:00.000Z')
    const artwork = await db().artwork.create({ data: { title: `${prefix}-replay-artwork` } })
    await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-replay-ref`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        locator: { gid: sharedExternalId, token: 'private-token' },
        status: 'SUCCESS',
        lastSuccessAt: archivedAt
      }
    })
    await db().$transaction([
      db().archiveIntakeItem.update({
        where: { id: originalIntake.id },
        data: { status: 'ENQUEUED', finishedAt: archivedAt }
      }),
      db().archiveUploaderCatalogItem.update({
        where: { id: seeded.catalogItemId },
        data: {
          classification: 'POSSIBLE_UPDATE',
          changeReasons: [{ field: 'fileCount', message: '页数 24 → 27' }],
          lastOutcome: 'ARCHIVED',
          lastOutcomeAt: archivedAt
        }
      })
    ])

    const updateSubmission = await addArchiveUploaderScanItems(
      { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
      `${prefix}-replay-admin`,
      { database: db(), uuid: prefixedUuidFactory('replay-update') }
    )
    expect(updateSubmission).toMatchObject({ acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 })
    expect(updateSubmission.id).not.toBe(first.id)
    await expect(
      db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-replay-admin` } })
    ).resolves.toBe(2)
  })

  it('ignores an old terminal intake superseded by a newer archive when submitting an update', async () => {
    const seeded = await seedCompletedScan('superseded-terminal', '3005')
    const canonicalUrl = `https://e-hentai.org/g/${sharedExternalId}/private-token/`
    const failedAt = new Date('2026-09-01T00:00:00.000Z')
    const archivedAt = new Date('2026-09-02T00:00:00.000Z')
    const oldSubmission = await db().archiveIntakeSubmission.create({
      data: {
        id: `${prefix}-old-terminal-submission`,
        idempotencyKey: `${prefix}-old-terminal`,
        requestHash: 'c'.repeat(64),
        requestedByUserId: `${prefix}-old-terminal-admin`,
        rawCount: 1,
        acceptedCount: 1,
        createdAt: failedAt
      }
    })
    const oldIntake = await db().archiveIntakeItem.create({
      data: {
        id: `${prefix}-old-terminal-intake`,
        submissionId: oldSubmission.id,
        submittedUrl: canonicalUrl,
        normalizedUrlHash: 'd'.repeat(64),
        status: 'FAILED',
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl,
        finishedAt: failedAt,
        errorCode: 'OLD_FAILURE',
        errorMessage: 'superseded failure',
        createdAt: failedAt,
        updatedAt: failedAt
      }
    })
    const artwork = await db().artwork.create({ data: { title: `${prefix}-superseded-artwork` } })
    await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-superseded-ref`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl,
        locator: { gid: sharedExternalId, token: 'private-token' },
        status: 'SUCCESS',
        lastSuccessAt: archivedAt
      }
    })
    await db().archiveUploaderCatalogItem.update({
      where: { id: seeded.catalogItemId },
      data: {
        classification: 'POSSIBLE_UPDATE',
        changeReasons: [{ field: 'title', message: '标题变化' }],
        lastIntakeItemId: oldIntake.id,
        lastOutcome: 'ARCHIVED',
        lastOutcomeAt: archivedAt
      }
    })

    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ACTIONABLE', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: seeded.catalogItemId, workflowStage: 'UPDATE_AVAILABLE' })]
    })
    await expect(
      addArchiveUploaderScanItems(
        { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
        `${prefix}-superseded-retry-admin`,
        { database: db(), uuid: prefixedUuidFactory('superseded-retry') }
      )
    ).resolves.toMatchObject({ acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 })
  })

  it('records a duplicate created after the actionable check as an attention state', async () => {
    const seeded = await seedCompletedScan('duplicate-race', '3003')
    const canonicalUrl = `https://e-hentai.org/g/${sharedExternalId}/private-token/`
    let competingSubmissionId: string | null = null
    const submission = await addArchiveUploaderScanItems(
      { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
      `${prefix}-duplicate-uploader`,
      {
        database: databaseWithAfterIgnoredCheckHook(async () => {
          const competing = await createArchiveIntakeSubmission(
            { idempotencyKey: `${prefix}-duplicate-competing`, urls: [canonicalUrl] },
            `${prefix}-duplicate-competing`,
            { database: db(), uuid: prefixedUuidFactory('duplicate-competing') }
          )
          competingSubmissionId = competing.id
        }),
        uuid: prefixedUuidFactory('duplicate-uploader')
      }
    )

    expect(submission).toMatchObject({ acceptedCount: 0, duplicateCount: 1 })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: seeded.catalogItemId } })
    ).resolves.toMatchObject({ lastOutcome: 'DUPLICATE', lastErrorCode: 'ACTIVE_DUPLICATE' })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: seeded.catalogItemId, workflowStage: 'DUPLICATE' })]
    })
    expect(competingSubmissionId).toEqual(expect.any(String))

    const authoritativeIntake = await db().archiveIntakeItem.findFirstOrThrow({
      where: { submissionId: competingSubmissionId! }
    })
    const progressedAt = new Date('2026-09-04T00:00:00.000Z')
    await db().$transaction([
      db().archiveIntakeItem.update({
        where: { id: authoritativeIntake.id },
        data: {
          status: 'READY',
          providerKey: 'e-hentai',
          externalId: sharedExternalId,
          canonicalUrl,
          updatedAt: progressedAt
        }
      }),
      db().archiveUploaderCatalogItem.updateMany({
        where: { providerKey: 'e-hentai', externalId: sharedExternalId },
        data: {
          lastIntakeItemId: authoritativeIntake.id,
          lastOutcome: 'SUBMITTED',
          lastOutcomeAt: progressedAt,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      })
    ])
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'PROCESSING', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: seeded.catalogItemId,
          workflowStage: 'READY',
          intakeItemId: authoritativeIntake.id
        })
      ]
    })
  })

  it('rolls back an entire intake batch when any selected Provider/GID is ignored', async () => {
    const scan = await seedCompletedScan('batch', '2003')
    const secondItemId = `${prefix}-catalog-batch-second`
    await db().archiveUploaderCatalogItem.create({
      data: {
        id: secondItemId,
        sourceId: scan.sourceId,
        providerKey: 'e-hentai',
        externalId: secondExternalId,
        canonicalUrl: `https://e-hentai.org/g/${secondExternalId}/private-token/`,
        title: 'Ignored batch gallery',
        relationships: {},
        classification: 'NEW',
        firstSeenAt: new Date('2026-09-02T00:00:00.000Z'),
        lastSeenAt: new Date('2026-09-02T00:00:00.000Z')
      }
    })
    await db().archiveUploaderIgnoredItem.create({
      data: {
        id: `${prefix}-ignored-batch`,
        providerKey: 'e-hentai',
        externalId: secondExternalId,
        sourceId: scan.sourceId,
        sourceDisplayName: 'Uploader batch',
        title: 'Ignored batch gallery'
      }
    })

    await expect(
      addArchiveUploaderScanItems(
        {
          sourceId: scan.sourceId,
          itemIds: [scan.catalogItemId, secondItemId],
          submissionAttemptId: randomUUID()
        },
        `${prefix}-batch-admin`,
        { database: db(), uuid: prefixedUuidFactory('batch') }
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(
      db().archiveIntakeSubmission.count({ where: { requestedByUserId: `${prefix}-batch-admin` } })
    ).resolves.toBe(0)
    await expect(
      db().archiveUploaderCatalogItem.count({
        where: { id: { in: [scan.catalogItemId, secondItemId] }, lastIntakeItemId: { not: null } }
      })
    ).resolves.toBe(0)
  })

  it('filters durable catalog rows by their current inbox, archive, and attention state', async () => {
    const seeded = await seedCompletedScan('live-state', '4001')
    const actionableExternalId = (BigInt(sharedExternalId) + 10n).toString()
    const archivedExternalId = (BigInt(sharedExternalId) + 11n).toString()
    const failedExternalId = (BigInt(sharedExternalId) + 12n).toString()
    const actionableId = `${prefix}-catalog-actionable`
    const archivedId = `${prefix}-catalog-archived`
    const failedId = `${prefix}-catalog-failed`
    const seenAt = new Date('2026-09-02T00:02:00.000Z')

    await db().archiveUploaderCatalogItem.createMany({
      data: [
        {
          id: actionableId,
          sourceId: seeded.sourceId,
          providerKey: 'e-hentai',
          externalId: actionableExternalId,
          canonicalUrl: `https://e-hentai.org/g/${actionableExternalId}/private-token/`,
          title: 'Actionable gallery',
          relationships: {},
          classification: 'NEW',
          comparisonKnown: true,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt
        },
        {
          id: archivedId,
          sourceId: seeded.sourceId,
          providerKey: 'e-hentai',
          externalId: archivedExternalId,
          canonicalUrl: `https://e-hentai.org/g/${archivedExternalId}/private-token/`,
          title: 'Archived gallery',
          relationships: {},
          classification: 'ARCHIVED',
          comparisonKnown: false,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          lastOutcome: 'ARCHIVED',
          lastOutcomeAt: seenAt
        },
        {
          id: failedId,
          sourceId: seeded.sourceId,
          providerKey: 'e-hentai',
          externalId: failedExternalId,
          canonicalUrl: `https://e-hentai.org/g/${failedExternalId}/private-token/`,
          title: 'Failed gallery',
          relationships: {},
          classification: 'NEW',
          comparisonKnown: true,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          lastOutcome: 'FAILED',
          lastOutcomeAt: seenAt,
          lastErrorCode: 'DOWNLOAD_FAILED',
          lastErrorMessage: 'provider token must remain hidden'
        }
      ]
    })

    const artwork = await db().artwork.create({ data: { title: `${prefix}-archived-artwork` } })
    await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-external-ref`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: archivedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${archivedExternalId}/private-token/`,
        locator: { gid: archivedExternalId, token: 'private-token' },
        status: 'SUCCESS'
      }
    })

    await addArchiveUploaderScanItems(
      {
        sourceId: seeded.sourceId,
        itemIds: [seeded.catalogItemId],
        submissionAttemptId: randomUUID()
      },
      `${prefix}-state-admin`,
      { database: db(), uuid: prefixedUuidFactory('state') }
    )

    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ACTIONABLE', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: actionableId, workflowStage: 'NEW', actionable: true })]
    })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'PROCESSING', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: seeded.catalogItemId, workflowStage: 'INBOX', actionable: false })]
    })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ARCHIVED', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: archivedId,
          workflowStage: 'ARCHIVED',
          artworkId: artwork.id,
          comparisonKnown: false
        })
      ]
    })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: failedId,
          workflowStage: 'FAILED',
          errorCode: 'DOWNLOAD_FAILED',
          errorMessage: 'provider token must remain hidden'
        })
      ]
    })
  })

  it('propagates terminal intake state across sources and retains it after intake cleanup', async () => {
    const first = await seedCompletedScan('terminal-first', '5001')
    const second = await seedCompletedScan('terminal-second', '5002')
    const archivedAt = new Date('2026-09-02T00:01:30.000Z')
    const artwork = await db().artwork.create({ data: { title: `${prefix}-terminal-artwork` } })
    await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-terminal-ref`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        locator: { gid: sharedExternalId, token: 'private-token' },
        status: 'SUCCESS'
      }
    })
    await db().archiveUploaderCatalogItem.updateMany({
      where: { id: { in: [first.catalogItemId, second.catalogItemId] } },
      data: {
        classification: 'POSSIBLE_UPDATE',
        changeReasons: [{ field: 'fileCount', message: '页数 24 → 27' }],
        lastOutcome: 'ARCHIVED',
        lastOutcomeAt: archivedAt
      }
    })
    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, view: 'ACTIONABLE', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: second.catalogItemId, workflowStage: 'UPDATE_AVAILABLE' })]
    })

    const submission = await addArchiveUploaderScanItems(
      { sourceId: first.sourceId, itemIds: [first.catalogItemId], submissionAttemptId: randomUUID() },
      `${prefix}-terminal-admin`,
      { database: db(), uuid: prefixedUuidFactory('terminal') }
    )
    const catalogItems = await db().archiveUploaderCatalogItem.findMany({
      where: { id: { in: [first.catalogItemId, second.catalogItemId] } },
      select: { lastIntakeItemId: true, lastOutcome: true }
    })
    const intakeItemId = catalogItems[0]?.lastIntakeItemId
    expect(intakeItemId).toEqual(expect.any(String))
    expect(catalogItems).toHaveLength(2)
    expect(catalogItems.every((item) => item.lastIntakeItemId === intakeItemId)).toBe(true)
    expect(catalogItems.every((item) => item.lastOutcome === 'SUBMITTED')).toBe(true)

    await cancelArchiveIntakeMany(
      { idempotencyKey: `${prefix}-terminal-cancel`, itemIds: [intakeItemId!] },
      `${prefix}-terminal-admin`,
      { database: db() }
    )
    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: second.catalogItemId, workflowStage: 'CANCELLED' })]
    })

    const historicalAt = new Date('2026-09-01T00:00:00.000Z')
    const historicalSubmission = await db().archiveIntakeSubmission.create({
      data: {
        id: `${prefix}-historical-terminal-submission`,
        idempotencyKey: `${prefix}-historical-terminal`,
        requestHash: 'e'.repeat(64),
        requestedByUserId: `${prefix}-historical-terminal-admin`,
        rawCount: 1,
        acceptedCount: 1,
        createdAt: historicalAt
      }
    })
    await db().archiveIntakeItem.create({
      data: {
        id: `${prefix}-historical-terminal-intake`,
        submissionId: historicalSubmission.id,
        submittedUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        normalizedUrlHash: 'f'.repeat(64),
        status: 'FAILED',
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        finishedAt: historicalAt,
        errorCode: 'OLD_FAILURE',
        errorMessage: 'older retained failure',
        createdAt: historicalAt,
        updatedAt: historicalAt
      }
    })

    await db().archiveIntakeSubmission.delete({ where: { id: submission.id } })
    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: second.catalogItemId,
          workflowStage: 'CANCELLED',
          intakeItemId: null,
          recoverable: true
        })
      ]
    })

    const retried = await addArchiveUploaderScanItems(
      { sourceId: second.sourceId, itemIds: [second.catalogItemId], submissionAttemptId: randomUUID() },
      `${prefix}-terminal-retry-admin`,
      { database: db(), uuid: prefixedUuidFactory('terminal-retry') }
    )
    expect(retried).toMatchObject({ acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 })
    await expect(
      listArchiveUploaderScanItems({ sourceId: second.sourceId, view: 'PROCESSING', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: second.catalogItemId, workflowStage: 'INBOX' })]
    })
  })

  it('keeps an update actionable after an active rescan, cancellation, and intake cleanup', async () => {
    const seeded = await seedCompletedScan('active-rescan', '5003')
    const oldMetadata = uploaderMetadata(24)
    const changedMetadata = uploaderMetadata(27)
    const archivedAt = new Date('2026-09-02T00:02:00.000Z')
    const artwork = await db().artwork.create({ data: { title: `${prefix}-active-rescan-artwork` } })
    const externalRef = await db().artworkExternalRef.create({
      data: {
        id: `${prefix}-active-rescan-ref`,
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        locator: { gid: sharedExternalId, token: 'private-token' },
        status: 'SUCCESS'
      }
    })
    await db().artworkSourceSnapshot.create({
      data: {
        id: `${prefix}-active-rescan-snapshot`,
        externalRefId: externalRef.id,
        normalizedMetadata: oldMetadata,
        rawMetadata: oldMetadata,
        metadataHash: hashArchiveUploaderDiscoveryMetadata(oldMetadata)!,
        fetchedAt: archivedAt
      }
    })
    await db().archiveUploaderCatalogItem.update({
      where: { id: seeded.catalogItemId },
      data: { classification: 'POSSIBLE_UPDATE', lastOutcome: 'ARCHIVED', lastOutcomeAt: archivedAt }
    })
    const submission = await addArchiveUploaderScanItems(
      { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
      `${prefix}-active-rescan-admin`,
      { database: db(), uuid: prefixedUuidFactory('active-rescan') }
    )
    const intake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: submission.id } })

    const rescanRunId = `${prefix}-active-rescan-run`
    const rescanJobId = `${prefix}-active-rescan-job`
    const scannedAt = new Date('2026-09-03T00:00:00.000Z')
    await db().systemJob.create({
      data: scanJobData(rescanJobId, rescanRunId, scannedAt)
    })
    await db().archiveUploaderScanRun.create({
      data: {
        id: rescanRunId,
        sourceId: seeded.sourceId,
        systemJobId: rescanJobId,
        mode: 'LATEST',
        status: 'PENDING'
      }
    })
    await executeArchiveUploaderScan(scanContext(rescanJobId, rescanRunId), {
      database: db(),
      providers: uploaderProviderRegistry(changedMetadata),
      now: () => scannedAt
    })

    await expect(
      db().archiveUploaderScanItem.findFirstOrThrow({
        where: { runId: rescanRunId },
        select: { classification: true }
      })
    ).resolves.toEqual({ classification: 'ACTIVE' })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({
        where: { id: seeded.catalogItemId },
        select: { classification: true, lastIntakeItemId: true }
      })
    ).resolves.toEqual({ classification: 'POSSIBLE_UPDATE', lastIntakeItemId: intake.id })

    await cancelArchiveIntakeMany(
      { idempotencyKey: `${prefix}-active-rescan-cancel`, itemIds: [intake.id] },
      `${prefix}-active-rescan-admin`,
      { database: db() }
    )
    await db().archiveIntakeSubmission.delete({ where: { id: submission.id } })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: seeded.catalogItemId, workflowStage: 'CANCELLED', recoverable: true })]
    })
    await expect(
      addArchiveUploaderScanItems(
        { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
        `${prefix}-active-rescan-admin`,
        { database: db(), uuid: prefixedUuidFactory('active-rescan-retry') }
      )
    ).resolves.toMatchObject({ acceptedCount: 1, duplicateCount: 0, rejectedCount: 0 })
  })

  it('serializes a real ArchiveModule cancellation after scan observation and retains it after cleanup', async () => {
    const timestamp = new Date('2026-09-03T15:00:00.000Z')
    const source = await seedCompletedScan('module-cancel-race', '5004')
    await db().archiveUploaderCatalogItem.delete({ where: { id: source.catalogItemId } })
    const importId = `${prefix}-module-cancel-import`
    const importJobId = `${prefix}-module-cancel-import-job`
    await db().systemJob.create({
      data: {
        id: importJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 2,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        payload: { archiveImportId: importId, defaultTagIds: [] },
        queuePriority: 20,
        effectivePriority: 20,
        availableAt: timestamp,
        maxAttempts: 3,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    })
    await db().archiveImport.create({
      data: {
        id: importId,
        systemJobId: importJobId,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        submittedUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        locator: { gid: sharedExternalId, token: 'private-token' },
        status: 'PENDING',
        normalizedMetadata: uploaderMetadata(24),
        rawMetadata: uploaderMetadata(24),
        metadataHash: hashArchiveUploaderDiscoveryMetadata(uploaderMetadata(24))!,
        creatorBucket: 'uploader',
        stagingPath: `.archive-staging/${importId}`,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    })
    const rescanRunId = `${prefix}-module-cancel-run`
    const rescanJobId = `${prefix}-module-cancel-scan-job`
    await db().systemJob.create({ data: scanJobData(rescanJobId, rescanRunId, timestamp) })
    await db().archiveUploaderScanRun.create({
      data: {
        id: rescanRunId,
        sourceId: source.sourceId,
        systemJobId: rescanJobId,
        mode: 'LATEST',
        status: 'PENDING'
      }
    })
    const importObserved = deferred()
    const releaseScan = deferred()
    const scan = executeArchiveUploaderScan(
      scanContext(rescanJobId, rescanRunId, async () => {
        importObserved.resolve()
        await releaseScan.promise
      }),
      {
        database: db(),
        providers: uploaderProviderRegistry(uploaderMetadata(24)),
        now: () => timestamp
      }
    )
    await importObserved.promise
    const cancellation = archiveModule.requestAction(importId, 'CANCEL', {
      requestedByUserId: `${prefix}-module-cancel-admin`
    })
    releaseScan.resolve()
    await Promise.all([scan, cancellation])

    const catalog = await db().archiveUploaderCatalogItem.findFirstOrThrow({
      where: { sourceId: source.sourceId, providerKey: 'e-hentai', externalId: sharedExternalId }
    })
    expect(catalog).toMatchObject({
      lastArchiveImportId: importId,
      lastOutcome: 'CANCELLED',
      lastErrorCode: 'CANCELLED'
    })
    await db().systemJob.delete({ where: { id: importJobId } })
    await expect(
      db().archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } })
    ).resolves.toMatchObject({ lastArchiveImportId: null, lastOutcome: 'CANCELLED', lastErrorCode: 'CANCELLED' })
  })
})

function uploaderMetadata(fileCount: number) {
  return {
    gid: sharedExternalId,
    titles: { display: 'Shared gallery', aliases: [] },
    category: 'Manga',
    uploader: 'Uploader active-rescan',
    thumbnailUrl: 'https://ehgt.org/thumb.jpg',
    postedAt: '2026-09-01T00:00:00.000Z',
    fileCount,
    fileSize: 1024,
    rating: 4,
    expunged: false,
    tags: [],
    relationships: []
  }
}

function scanJobData(id: string, scanRunId: string, now: Date) {
  return {
    id,
    type: 'ARCHIVE_UPLOADER_SCAN' as const,
    executionLane: 'ARCHIVE_RESOLVE' as const,
    definitionVersion: 1,
    status: 'PENDING' as const,
    triggerSource: 'MANUAL' as const,
    payload: { scanRunId },
    queuePriority: 20,
    effectivePriority: 20,
    availableAt: now,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now
  }
}

function uploaderProviderRegistry(metadata: ReturnType<typeof uploaderMetadata>) {
  return {
    getUploaderScanner: () => ({
      key: 'e-hentai',
      scanUploader: vi.fn(async () => ({
        items: [
          {
            providerKey: 'e-hentai',
            externalId: sharedExternalId,
            canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
            title: 'Shared gallery',
            thumbnailUrl: metadata.thumbnailUrl,
            uploaderName: metadata.uploader,
            postedAt: new Date(metadata.postedAt),
            metadataFingerprint: hashArchiveUploaderDiscoveryMetadata(metadata)!,
            comparisonSnapshot: createArchiveUploaderComparisonSnapshot(metadata)!,
            normalizedMetadata: metadata,
            relationships: []
          }
        ],
        nextCursor: null,
        reachedStop: false
      }))
    })
  } as never
}

function scanContext(jobId: string, scanRunId: string, afterArchiveImportRead?: () => Promise<void>) {
  return {
    job: { id: jobId, attempt: 1, maxAttempts: 3 },
    payload: { scanRunId },
    signal: new AbortController().signal,
    progress: vi.fn(async () => undefined),
    enqueueChild: vi.fn(),
    mutateInTransaction: (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      db().$transaction(operation),
    finalizeInTransaction: async (
      operation: (scope: {
        transaction: Prisma.TransactionClient
        executionStatus: 'RUNNING'
        controlStatus: 'CONTINUE'
        complete: ReturnType<typeof vi.fn>
      }) => Promise<void>
    ) => {
      await db().$transaction((transaction) =>
        operation({
          transaction: afterArchiveImportRead ? transactionWithArchiveImportHook(transaction, afterArchiveImportRead) : transaction,
          executionStatus: 'RUNNING',
          controlStatus: 'CONTINUE',
          complete: vi.fn(async () => undefined)
        })
      )
      return { kind: 'transactionally-finalized' as const }
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as never
}

function transactionWithArchiveImportHook(
  transaction: Prisma.TransactionClient,
  hook: () => Promise<void>
): Prisma.TransactionClient {
  let invoked = false
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== 'archiveImport') return Reflect.get(target, property, receiver)
      return new Proxy(target.archiveImport, {
        get(delegate, delegateProperty, delegateReceiver) {
          if (delegateProperty !== 'findMany') return Reflect.get(delegate, delegateProperty, delegateReceiver)
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(delegate.findMany, delegate, args)
            if (!invoked) {
              invoked = true
              await hook()
            }
            return result
          }
        }
      })
    }
  })
}

async function seedCompletedScan(suffix: string, uploaderUid: string) {
  const sourceId = `${prefix}-source-${suffix}`
  const runId = `${prefix}-run-${suffix}`
  const jobId = `${prefix}-job-${suffix}`
  const scanItemId = `${prefix}-scan-item-${suffix}`
  const catalogItemId = `${prefix}-catalog-item-${suffix}`
  await db().archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: uploaderUid,
      normalizedIdentity: uploaderUid,
      displayName: `Uploader ${suffix}`
    }
  })
  await db().systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: 1,
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      payload: { scanRunId: runId },
      queuePriority: 20,
      effectivePriority: 20,
      availableAt: new Date('2026-09-02T00:00:00.000Z'),
      finishedAt: new Date('2026-09-02T00:01:00.000Z'),
      progress: 100
    }
  })
  await db().archiveUploaderScanRun.create({
    data: {
      id: runId,
      sourceId,
      systemJobId: jobId,
      mode: 'LATEST',
      status: 'COMPLETED',
      itemCount: 1,
      newCount: 1,
      finishedAt: new Date('2026-09-02T00:01:00.000Z')
    }
  })
  await db().archiveUploaderScanItem.create({
    data: {
      id: scanItemId,
      runId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      metadataFingerprint: 'a'.repeat(64),
      relationships: {},
      classification: 'NEW'
    }
  })
  await db().archiveUploaderCatalogItem.create({
    data: {
      id: catalogItemId,
      sourceId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      relationships: {},
      classification: 'NEW',
      comparisonKnown: true,
      comparisonFingerprint: 'a'.repeat(64),
      firstSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastScanRunId: runId
    }
  })
  return { sourceId, runId, jobId, scanItemId, catalogItemId }
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveUploaderIgnoredItem.deleteMany({
    where: {
      OR: [
        { id: { startsWith: prefix } },
        { sourceId: { startsWith: prefix } },
        { ignoredByUserId: { startsWith: prefix } },
        {
          providerKey: 'e-hentai',
          externalId: '9001',
          title: 'Shared gallery',
          sourceDisplayName: { startsWith: 'Uploader ' },
          ignoredByUserId: 'admin-1'
        }
      ]
    }
  })
  await prisma.archiveUploaderScanRun.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeSubmission.deleteMany({
    where: { OR: [{ id: { startsWith: prefix } }, { requestedByUserId: { startsWith: prefix } }] }
  })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
}

function databaseWithFirstLockHooks(hooks: { before?: () => Promise<void>; after?: () => Promise<void> }) {
  const database = db()
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async (transaction) => {
          let lockCount = 0
          const hookedTransaction = new Proxy(transaction, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              if (transactionProperty !== '$queryRaw') {
                return Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
              }
              return async (...args: unknown[]) => {
                if (lockCount === 0) await hooks.before?.()
                const result = await Reflect.apply(transactionTarget.$queryRaw, transactionTarget, args)
                if (lockCount === 0) await hooks.after?.()
                lockCount += 1
                return result
              }
            }
          })
          return operation(hookedTransaction)
        })
    }
  })
}

function databaseWithAfterIgnoredCheckHook(hook: () => Promise<void>) {
  const database = db()
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async (transaction) => {
          let invoked = false
          const hookedTransaction = new Proxy(transaction, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              if (transactionProperty !== 'archiveUploaderIgnoredItem') {
                return Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
              }
              const delegate = transactionTarget.archiveUploaderIgnoredItem
              return new Proxy(delegate, {
                get(delegateTarget, delegateProperty, delegateReceiver) {
                  if (delegateProperty !== 'findFirst') {
                    return Reflect.get(delegateTarget, delegateProperty, delegateReceiver)
                  }
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(delegateTarget.findFirst, delegateTarget, args)
                    if (!invoked) {
                      invoked = true
                      await hook()
                    }
                    return result
                  }
                }
              })
            }
          })
          return operation(hookedTransaction)
        })
    }
  })
}

function prefixedUuidFactory(suffix: string) {
  let sequence = 0
  return () => `${prefix}-${suffix}-${++sequence}`
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
