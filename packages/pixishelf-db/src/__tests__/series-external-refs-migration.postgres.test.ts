import { readFile } from 'node:fs/promises'
import { PrismaClient, type Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback Series external identity migration fixture')
const migrationUrl = new URL(
  '../../prisma/migrations/20260827090000_add_series_external_refs/migration.sql',
  import.meta.url
)

describePostgres('Series external identity migration data claim', () => {
  it('claims explicit unique PIXIV identities without ArtworkRawMetadata and preserves ambiguous rows', async () => {
    const migrationSql = await readFile(migrationUrl, 'utf8')
    const claimStart = migrationSql.indexOf('-- The legacy Series row already records an explicit PIXIV provider identity.')
    const claimEnd = migrationSql.indexOf('CREATE UNIQUE INDEX "SeriesArtwork_sourceRefId_key"')
    const claimStatements = migrationSql
      .slice(claimStart, claimEnd)
      .split(/;\s*(?=WITH unique_pixiv_refs AS MATERIALIZED)/)
      .map((statement) => statement.trim().replace(/;$/, ''))
      .filter(Boolean)
    expect(claimStart).toBeGreaterThanOrEqual(0)
    expect(claimEnd).toBeGreaterThan(claimStart)
    expect(claimStatements).toHaveLength(2)

    try {
      await database!.$transaction(
        async (transaction) => {
          const suffix = `${Date.now()}${Math.floor(Math.random() * 100_000)
            .toString()
            .padStart(5, '0')}`

          const claimable = await createLegacySeries(transaction, `${suffix}01`, 'Claimable')
          const firstArtwork = await createArtworkWithRef(transaction, `${suffix}11`)
          const secondArtwork = await createArtworkWithRef(transaction, `${suffix}12`)
          await createMembership(transaction, claimable.id, firstArtwork.artworkId, 7)
          await createMembership(transaction, claimable.id, secondArtwork.artworkId, 8)

          const duplicateExternalId = `${suffix}02`
          const duplicateA = await createLegacySeries(transaction, duplicateExternalId, 'Duplicate A')
          const duplicateB = await createLegacySeries(transaction, duplicateExternalId, 'Duplicate B', 'pixiv')
          const duplicateArtworkA = await createArtworkWithRef(transaction, `${suffix}21`)
          const duplicateArtworkB = await createArtworkWithRef(transaction, `${suffix}22`)
          await createMembership(transaction, duplicateA.id, duplicateArtworkA.artworkId, 1)
          await createMembership(transaction, duplicateB.id, duplicateArtworkB.artworkId, 1)

          const multiSeriesA = await createLegacySeries(transaction, `${suffix}03`, 'Multi A')
          const multiSeriesB = await createLegacySeries(transaction, `${suffix}04`, 'Multi B')
          const multiSeriesArtwork = await createArtworkWithRef(transaction, `${suffix}31`)
          await createMembership(transaction, multiSeriesA.id, multiSeriesArtwork.artworkId, 1)
          await createMembership(transaction, multiSeriesB.id, multiSeriesArtwork.artworkId, 1)

          const ambiguousRefSeries = await createLegacySeries(transaction, `${suffix}05`, 'Ambiguous refs')
          const ambiguousArtwork = await transaction.artwork.create({ data: { title: 'Ambiguous refs artwork' } })
          await createRef(transaction, ambiguousArtwork.id, `${suffix}41`)
          await createRef(transaction, ambiguousArtwork.id, `${suffix}42`)
          await createMembership(transaction, ambiguousRefSeries.id, ambiguousArtwork.id, 1)

          for (const statement of claimStatements) await transaction.$executeRawUnsafe(statement)

          const claimedRef = await transaction.seriesExternalRef.findUnique({
            where: { providerKey_externalId: { providerKey: 'pixiv', externalId: claimable.externalId! } }
          })
          expect(claimedRef).toMatchObject({ seriesId: claimable.id, providerKey: 'pixiv' })

          const claimedMemberships = await transaction.seriesArtwork.findMany({
            where: { seriesId: claimable.id },
            orderBy: { sortOrder: 'asc' }
          })
          expect(claimedMemberships).toEqual([
            expect.objectContaining({
              artworkId: firstArtwork.artworkId,
              provenance: 'SOURCE',
              sourceRefId: firstArtwork.refId,
              sourceOrder: null,
              sortOrder: 7
            }),
            expect.objectContaining({
              artworkId: secondArtwork.artworkId,
              provenance: 'SOURCE',
              sourceRefId: secondArtwork.refId,
              sourceOrder: null,
              sortOrder: 8
            })
          ])

          const ambiguousSeriesIds = [duplicateA.id, duplicateB.id, multiSeriesA.id, multiSeriesB.id, ambiguousRefSeries.id]
          await expect(
            transaction.seriesExternalRef.count({ where: { seriesId: { in: ambiguousSeriesIds } } })
          ).resolves.toBe(0)
          await expect(
            transaction.seriesArtwork.count({
              where: { seriesId: { in: ambiguousSeriesIds }, provenance: { not: 'LEGACY' } }
            })
          ).resolves.toBe(0)

          const fixtureArtworkIds = [
            firstArtwork.artworkId,
            secondArtwork.artworkId,
            duplicateArtworkA.artworkId,
            duplicateArtworkB.artworkId,
            multiSeriesArtwork.artworkId,
            ambiguousArtwork.id
          ]
          await expect(
            transaction.artworkRawMetadata.count({ where: { artworkId: { in: fixtureArtworkIds } } })
          ).resolves.toBe(0)
          throw rollback
        },
        { maxWait: 5_000, timeout: 20_000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})

function createLegacySeries(
  transaction: Prisma.TransactionClient,
  externalId: string,
  title: string,
  source = 'PIXIV'
) {
  return transaction.series.create({ data: { title, source, externalId } })
}

async function createArtworkWithRef(transaction: Prisma.TransactionClient, externalId: string) {
  const artwork = await transaction.artwork.create({ data: { title: `Artwork ${externalId}` } })
  const ref = await createRef(transaction, artwork.id, externalId)
  return { artworkId: artwork.id, refId: ref.id }
}

function createRef(transaction: Prisma.TransactionClient, artworkId: number, externalId: string) {
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

function createMembership(
  transaction: Prisma.TransactionClient,
  seriesId: number,
  artworkId: number,
  sortOrder: number
) {
  return transaction.seriesArtwork.create({
    data: { seriesId, artworkId, sortOrder, provenance: 'LEGACY' }
  })
}
