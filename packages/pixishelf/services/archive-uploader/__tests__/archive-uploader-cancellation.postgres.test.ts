import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { cancelArchiveIntakeMany } from '../../archive-intake/archive-intake-service'
import { getArchiveUploaderCatalogCounts } from '../archive-uploader-catalog-state'
import { addArchiveUploaderScanItems, listArchiveUploaderScanItems } from '../archive-uploader-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-cancel-state-${randomUUID()}`
const sharedExternalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()

describePostgres('archived discovery cancellation PostgreSQL regression', () => {
  beforeEach(cleanupDatabase)
  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })

  it.each(
    (['snapshot', 'intake', 'import'] as const).flatMap((origin) =>
      (['update', 'archived', 'unarchived', 'inactive', 'deleted'] as const).map((artworkState) => ({
        origin,
        artworkState
      }))
    )
  )(
    'classifies $origin cancellation with $artworkState artwork consistently in lists and counts',
    async ({ origin, artworkState }) => {
      const seeded = await seedCatalog()
      const cancelledAt = new Date('2026-09-03T00:00:00Z')
      const canonicalUrl = `https://e-hentai.org/g/${sharedExternalId}/private-token/`
      if (artworkState !== 'unarchived') {
        const artwork = await db().artwork.create({
          data: {
            title: `${prefix}-cancel-state-artwork`,
            archiveLifecycleState: artworkState === 'inactive' ? 'TRASHED' : 'ACTIVE',
            deletedAt: artworkState === 'deleted' ? cancelledAt : null
          }
        })
        await db().artworkExternalRef.create({
          data: {
            artworkId: artwork.id,
            providerKey: 'e-hentai',
            externalId: sharedExternalId,
            canonicalUrl,
            locator: {},
            status: 'SUCCESS'
          }
        })
      }
      await db().archiveUploaderCatalogItem.update({
        where: { id: seeded.catalogItemId },
        data: {
          classification: artworkState === 'archived' ? 'ARCHIVED' : 'POSSIBLE_UPDATE',
          lastOutcome: origin === 'snapshot' ? 'CANCELLED' : 'SUBMITTED',
          lastOutcomeAt: new Date(cancelledAt.getTime() - 1),
          lastErrorCode: origin === 'snapshot' ? 'CANCELLED' : null,
          lastErrorMessage: origin === 'snapshot' ? '归档收件任务已取消' : null
        }
      })
      if (origin === 'intake') {
        await db().archiveIntakeSubmission.create({
          data: {
            id: `${prefix}-cancel-state-submission`,
            idempotencyKey: `${prefix}-cancel-state-submission`,
            requestHash: 'a'.repeat(64),
            requestedByUserId: `${prefix}-admin`,
            rawCount: 1,
            acceptedCount: 1,
            items: {
              create: {
                submittedUrl: canonicalUrl,
                normalizedUrlHash: 'b'.repeat(64),
                providerKey: 'e-hentai',
                externalId: sharedExternalId,
                status: 'CANCELLED',
                errorCode: 'CANCELLED',
                errorMessage: '归档收件任务已取消',
                finishedAt: cancelledAt,
                updatedAt: cancelledAt
              }
            }
          }
        })
      }
      if (origin === 'import') {
        const importId = `${prefix}-cancel-state-import`
        await db().archiveImport.create({
          data: {
            id: importId,
            systemJob: {
              create: { id: `${prefix}-cancel-state-job`, type: 'ARCHIVE_IMPORT', status: 'CANCELLED' }
            },
            providerKey: 'e-hentai',
            externalId: sharedExternalId,
            submittedUrl: canonicalUrl,
            canonicalUrl,
            locator: {},
            status: 'CANCELLED',
            normalizedMetadata: {},
            rawMetadata: {},
            metadataHash: 'a'.repeat(64),
            creatorBucket: 'test',
            stagingPath: importId,
            errorCode: 'CANCELLED',
            errorMessage: '归档下载已取消',
            finishedAt: cancelledAt,
            updatedAt: cancelledAt
          }
        })
      }

      const active = artworkState === 'update' || artworkState === 'archived'
      const workflowStage = active ? (artworkState === 'update' ? 'UPDATE_AVAILABLE' : 'ARCHIVED') : 'CANCELLED'
      const view = active ? (artworkState === 'update' ? 'ACTIONABLE' : 'ARCHIVED') : 'ATTENTION'
      const result = await listArchiveUploaderScanItems(
        { sourceId: seeded.sourceId, view, limit: 50 },
        { database: db() }
      )
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        workflowStage,
        workflowBucket: view,
        errorCode: active ? null : 'CANCELLED',
        ...(active ? { errorMessage: null, recoverable: false } : {})
      })
      const attention = await listArchiveUploaderScanItems(
        { sourceId: seeded.sourceId, view: 'ATTENTION', limit: 50 },
        { database: db() }
      )
      expect(attention.items).toHaveLength(active ? 0 : 1)
      const counts = await getArchiveUploaderCatalogCounts(db(), [seeded.sourceId])
      expect(counts.get(seeded.sourceId)).toMatchObject({
        actionable: artworkState === 'update' ? 1 : 0,
        archived: artworkState === 'archived' ? 1 : 0,
        attention: active ? 0 : 1,
        total: 1
      })
      if (artworkState === 'update' && origin !== 'snapshot') {
        const identity = { providerKey: 'e-hentai', externalId: sharedExternalId }
        const failure = { status: 'FAILED' as const, errorCode: 'REMOTE_ERROR', errorMessage: '实际更新失败' }
        if (origin === 'intake') await db().archiveIntakeItem.updateMany({ where: identity, data: failure })
        else await db().archiveImport.updateMany({ where: identity, data: failure })
        await expect(
          listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'ATTENTION', limit: 50 }, { database: db() })
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ workflowStage: 'FAILED', errorCode: 'REMOTE_ERROR' })]
        })
        if (origin === 'intake') {
          await db().archiveIntakeItem.updateMany({ where: identity, data: { status: 'QUEUED' } })
        } else {
          await db().archiveImport.updateMany({ where: identity, data: { status: 'PENDING' } })
        }
        await expect(
          listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'PROCESSING', limit: 50 }, { database: db() })
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ workflowStage: origin === 'intake' ? 'INBOX' : 'DOWNLOADING' })]
        })
      }
    }
  )

  it('allows a cancelled archived update to be submitted again before its intake history is cleaned', async () => {
    const seeded = await seedCatalog()
    const artwork = await db().artwork.create({ data: { title: `${prefix}-cancel-retry-artwork` } })
    await db().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'e-hentai',
        externalId: sharedExternalId,
        canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
        locator: {},
        status: 'SUCCESS'
      }
    })
    await db().archiveUploaderCatalogItem.update({
      where: { id: seeded.catalogItemId },
      data: { classification: 'POSSIBLE_UPDATE' }
    })
    const submit = () =>
      addArchiveUploaderScanItems(
        { sourceId: seeded.sourceId, itemIds: [seeded.catalogItemId], submissionAttemptId: randomUUID() },
        `${prefix}-admin`,
        { database: db(), uuid: prefixedUuidFactory(randomUUID()) }
      )
    const original = await submit()
    const intake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: original.id } })
    await cancelArchiveIntakeMany(
      { idempotencyKey: `${prefix}-cancel-retry`, itemIds: [intake.id] },
      `${prefix}-admin`,
      { database: db() }
    )
    await expect(submit()).resolves.toMatchObject({ acceptedCount: 1, rejectedCount: 0 })
    await expect(db().archiveIntakeItem.findUniqueOrThrow({ where: { id: intake.id } })).resolves.toMatchObject({
      status: 'CANCELLED'
    })
    await expect(
      listArchiveUploaderScanItems({ sourceId: seeded.sourceId, view: 'PROCESSING', limit: 50 }, { database: db() })
    ).resolves.toMatchObject({ items: [expect.objectContaining({ workflowStage: 'INBOX' })] })
    await expect(submit()).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })
})

async function seedCatalog() {
  const sourceId = `${prefix}-source`
  const catalogItemId = `${prefix}-catalog`
  await db().archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: prefix,
      normalizedIdentity: prefix,
      displayName: prefix
    }
  })
  await db().archiveUploaderCatalogItem.create({
    data: {
      id: catalogItemId,
      sourceId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/private-token/`,
      title: prefix,
      relationships: {},
      classification: 'NEW',
      comparisonKnown: true,
      firstSeenAt: new Date('2026-09-02T00:00:00Z'),
      lastSeenAt: new Date('2026-09-02T00:00:00Z')
    }
  })
  return { sourceId, catalogItemId }
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: `${prefix}-admin` } })
  await prisma.archiveBulkOperation.deleteMany({ where: { requestedByUserId: `${prefix}-admin` } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
}

function prefixedUuidFactory(suffix: string) {
  let sequence = 0
  return () => `${prefix}-${suffix}-${++sequence}`
}

function db() {
  if (!prisma) throw new Error('PostgreSQL test database is not configured')
  return prisma
}
