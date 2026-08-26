import { readFile } from 'node:fs/promises'
import { PrismaClient, type Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback Pixiv artwork migration fixture')
const migrationUrl = new URL(
  '../../prisma/migrations/20260826143000_add_pixiv_artwork_online_sync/migration.sql',
  import.meta.url
)

describePostgres('Pixiv artwork online synchronization migration data correction', () => {
  it('clears only exact snapshot-backed overrides and is safe to repeat', async () => {
    const migrationSql = await readFile(migrationUrl, 'utf8')
    const correctionSql = migrationSql.slice(migrationSql.indexOf('WITH unique_pixiv_refs AS MATERIALIZED'))
    const correctionStatements = correctionSql
      .split(/;\s*(?=WITH unique_pixiv_refs AS MATERIALIZED)/)
      .map((statement) => statement.trim().replace(/;$/, ''))
      .filter(Boolean)
    expect(correctionStatements).toHaveLength(2)

    try {
      await database!.$transaction(
        async (transaction) => {
          const suffix = `${Date.now()}${Math.floor(Math.random() * 100_000)
            .toString()
            .padStart(5, '0')}`
          const exact = await createArtwork(transaction, 'Source title', 'Source description')
          const mismatch = await createArtwork(transaction, 'Manual title', 'Manual description')
          const noEvidence = await createArtwork(transaction, 'No evidence title', 'No evidence description')
          const ambiguous = await createArtwork(transaction, 'Ambiguous title', 'Ambiguous description')

          const exactRef = await createRef(transaction, exact.id, `${suffix}1`)
          const mismatchRef = await createRef(transaction, mismatch.id, `${suffix}2`)
          await createRef(transaction, noEvidence.id, `${suffix}3`)
          const ambiguousRef = await createRef(transaction, ambiguous.id, `${suffix}4`)
          await createRef(transaction, ambiguous.id, `${suffix}5`)

          await createSnapshot(transaction, exactRef.id, 'a'.repeat(64), {
            title: 'Source title',
            description: 'Source description'
          })
          await createSnapshot(
            transaction,
            mismatchRef.id,
            'b'.repeat(64),
            {
              title: 'Manual title',
              description: 'Manual description'
            },
            new Date('2026-08-25T00:00:00.000Z')
          )
          await createSnapshot(
            transaction,
            mismatchRef.id,
            'c'.repeat(64),
            {
              title: 'New source title',
              description: 'New source description'
            },
            new Date('2026-08-26T00:00:00.000Z')
          )
          await createSnapshot(transaction, ambiguousRef.id, 'd'.repeat(64), {
            title: 'Ambiguous title',
            description: 'Ambiguous description'
          })

          for (let run = 0; run < 2; run += 1) {
            for (const statement of correctionStatements) await transaction.$executeRawUnsafe(statement)
          }

          const records = await transaction.artwork.findMany({
            where: { id: { in: [exact.id, mismatch.id, noEvidence.id, ambiguous.id] } },
            select: { id: true, titleOverridden: true, descriptionOverridden: true }
          })
          const byId = new Map(records.map((record) => [record.id, record]))
          expect(byId.get(exact.id)).toMatchObject({ titleOverridden: false, descriptionOverridden: false })
          expect(byId.get(mismatch.id)).toMatchObject({ titleOverridden: true, descriptionOverridden: true })
          expect(byId.get(noEvidence.id)).toMatchObject({ titleOverridden: true, descriptionOverridden: true })
          expect(byId.get(ambiguous.id)).toMatchObject({ titleOverridden: true, descriptionOverridden: true })
          throw rollback
        },
        { maxWait: 5_000, timeout: 20_000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})

async function createArtwork(transaction: Prisma.TransactionClient, title: string, description: string) {
  return transaction.artwork.create({
    data: { title, description, titleOverridden: true, descriptionOverridden: true }
  })
}

async function createRef(transaction: Prisma.TransactionClient, artworkId: number, externalId: string) {
  return transaction.artworkExternalRef.create({
    data: {
      artworkId,
      providerKey: 'pixiv',
      externalId,
      canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
      locator: { artworkId: externalId }
    }
  })
}

async function createSnapshot(
  transaction: Prisma.TransactionClient,
  externalRefId: string,
  metadataHash: string,
  normalizedMetadata: Prisma.InputJsonValue,
  fetchedAt = new Date('2026-08-26T00:00:00.000Z')
) {
  await transaction.artworkSourceSnapshot.create({
    data: { externalRefId, metadataHash, normalizedMetadata, rawMetadata: normalizedMetadata, fetchedAt }
  })
}
