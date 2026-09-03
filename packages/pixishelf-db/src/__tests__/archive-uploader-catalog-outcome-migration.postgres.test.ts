import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback archive uploader outcome migration fixture')
const migrationUrl = new URL(
  '../../prisma/migrations/20260903124500_order_archive_uploader_catalog_outcomes/migration.sql',
  import.meta.url
)
const activeNormalizationMigrationUrl = new URL(
  '../../prisma/migrations/20260903133000_normalize_archive_uploader_catalog_active/migration.sql',
  import.meta.url
)

describePostgres('archive uploader catalog outcome migration', () => {
  it('keeps a newer intake failure after an older archive and intake cleanup', async () => {
    const migrationSql = await readFile(migrationUrl, 'utf8')
    const suffix = randomUUID()
    const externalId = suffix.replaceAll('-', '').slice(0, 16)
    const canonicalUrl = `https://e-hentai.org/g/${externalId}/private-token/`
    const archivedAt = new Date('2026-09-01T00:00:00.000Z')
    const failedAt = new Date('2026-09-02T00:00:00.000Z')

    try {
      await database!.$transaction(
        async (transaction) => {
          const source = await transaction.archiveUploaderSource.create({
            data: {
              id: `migration-source-${suffix}`,
              providerKey: 'e-hentai',
              identityKind: 'UID',
              identityValue: externalId,
              normalizedIdentity: externalId,
              displayName: `Migration ${suffix}`
            }
          })
          const artwork = await transaction.artwork.create({ data: { title: `Migration artwork ${suffix}` } })
          await transaction.artworkExternalRef.create({
            data: {
              id: `migration-ref-${suffix}`,
              artworkId: artwork.id,
              providerKey: 'e-hentai',
              externalId,
              canonicalUrl,
              locator: { gid: externalId, token: 'private-token' },
              status: 'SUCCESS',
              lastSuccessAt: archivedAt,
              createdAt: archivedAt,
              updatedAt: archivedAt
            }
          })
          const submission = await transaction.archiveIntakeSubmission.create({
            data: {
              id: `migration-submission-${suffix}`,
              idempotencyKey: `migration-${suffix}`,
              requestHash: 'a'.repeat(64),
              rawCount: 1,
              acceptedCount: 1,
              createdAt: failedAt
            }
          })
          const intake = await transaction.archiveIntakeItem.create({
            data: {
              id: `migration-intake-${suffix}`,
              submissionId: submission.id,
              submittedUrl: canonicalUrl,
              normalizedUrlHash: 'b'.repeat(64),
              status: 'FAILED',
              providerKey: 'e-hentai',
              externalId,
              canonicalUrl,
              finishedAt: failedAt,
              errorCode: 'REMOTE_FAILED',
              errorMessage: 'newer failure',
              createdAt: failedAt,
              updatedAt: failedAt
            }
          })
          const catalog = await transaction.archiveUploaderCatalogItem.create({
            data: {
              id: `migration-catalog-${suffix}`,
              sourceId: source.id,
              providerKey: 'e-hentai',
              externalId,
              canonicalUrl,
              title: `Migration gallery ${suffix}`,
              relationships: {},
              classification: 'ARCHIVED',
              firstSeenAt: archivedAt,
              lastSeenAt: failedAt,
              lastIntakeItemId: intake.id,
              lastOutcome: 'ARCHIVED',
              lastOutcomeAt: archivedAt
            }
          })

          await transaction.$executeRawUnsafe(migrationSql)
          await expect(
            transaction.archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } })
          ).resolves.toMatchObject({
            lastOutcome: 'FAILED',
            lastOutcomeAt: failedAt,
            lastErrorCode: 'REMOTE_FAILED',
            lastErrorMessage: 'newer failure'
          })

          await transaction.archiveIntakeSubmission.delete({ where: { id: submission.id } })
          await expect(
            transaction.archiveUploaderCatalogItem.findUniqueOrThrow({ where: { id: catalog.id } })
          ).resolves.toMatchObject({ lastIntakeItemId: null, lastOutcome: 'FAILED', lastOutcomeAt: failedAt })
          throw rollback
        },
        { maxWait: 5_000, timeout: 20_000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })

  it('normalizes historical ACTIVE catalog rows into durable recommendations', async () => {
    const migrationSql = await readFile(activeNormalizationMigrationUrl, 'utf8')
    const suffix = randomUUID()
    const exactExternalId = suffix.replaceAll('-', '').slice(0, 16)
    const replacementExternalId = `${exactExternalId}-replacement`
    const newExternalId = `${exactExternalId}-new`

    try {
      await database!.$transaction(
        async (transaction) => {
          const source = await transaction.archiveUploaderSource.create({
            data: {
              id: `active-migration-source-${suffix}`,
              providerKey: 'e-hentai',
              identityKind: 'UID',
              identityValue: exactExternalId,
              normalizedIdentity: exactExternalId,
              displayName: `Active migration ${suffix}`
            }
          })
          const artwork = await transaction.artwork.create({ data: { title: `Active migration artwork ${suffix}` } })
          await transaction.artworkExternalRef.create({
            data: {
              id: `active-migration-ref-${suffix}`,
              artworkId: artwork.id,
              providerKey: 'e-hentai',
              externalId: exactExternalId,
              canonicalUrl: `https://e-hentai.org/g/${exactExternalId}/private-token/`,
              locator: { gid: exactExternalId, token: 'private-token' },
              status: 'SUCCESS'
            }
          })
          await transaction.archiveUploaderCatalogItem.createMany({
            data: [
              activeCatalogData(source.id, `active-migration-exact-${suffix}`, exactExternalId, []),
              activeCatalogData(source.id, `active-migration-replacement-${suffix}`, replacementExternalId, [
                {
                  direction: 'OUTBOUND',
                  providerKey: 'e-hentai',
                  externalId: exactExternalId
                }
              ]),
              activeCatalogData(source.id, `active-migration-new-${suffix}`, newExternalId, [])
            ]
          })

          await transaction.$executeRawUnsafe(migrationSql)
          const catalogs = await transaction.archiveUploaderCatalogItem.findMany({
            where: { sourceId: source.id },
            orderBy: { externalId: 'asc' },
            select: { externalId: true, classification: true, comparisonKnown: true, changeReasons: true }
          })
          expect(catalogs).toEqual(
            expect.arrayContaining([
              {
                externalId: exactExternalId,
                classification: 'ARCHIVED',
                comparisonKnown: false,
                changeReasons: []
              },
              {
                externalId: replacementExternalId,
                classification: 'REPLACEMENT',
                comparisonKnown: true,
                changeReasons: []
              },
              { externalId: newExternalId, classification: 'NEW', comparisonKnown: true, changeReasons: [] }
            ])
          )
          throw rollback
        },
        { maxWait: 5_000, timeout: 20_000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})

function activeCatalogData(sourceId: string, id: string, externalId: string, relationships: object[]) {
  const timestamp = new Date('2026-09-03T00:00:00.000Z')
  return {
    id,
    sourceId,
    providerKey: 'e-hentai',
    externalId,
    canonicalUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
    title: `Active migration gallery ${externalId}`,
    relationships,
    classification: 'ACTIVE' as const,
    comparisonKnown: true,
    changeReasons: [{ field: 'title', message: 'stale transient reason' }],
    firstSeenAt: timestamp,
    lastSeenAt: timestamp
  }
}
