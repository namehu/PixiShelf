import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient, type Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback isolated legacy Series schema')
const migrationUrl = new URL(
  '../../prisma/migrations/20260827090000_add_series_external_refs/migration.sql',
  import.meta.url
)

describePostgres('Series external identity historical migration', () => {
  it('runs its legacy claim inside an isolated old schema', async () => {
    const migrationSql = await readFile(migrationUrl, 'utf8')
    const claimStart = migrationSql.indexOf('-- The legacy Series row already records an explicit PIXIV provider identity.')
    const claimEnd = migrationSql.indexOf('CREATE UNIQUE INDEX "SeriesArtwork_sourceRefId_key"')
    const claimStatements = migrationSql
      .slice(claimStart, claimEnd)
      .split(/;\s*(?=WITH unique_pixiv_refs AS MATERIALIZED)/u)
      .map((statement) => statement.trim().replace(/;$/u, ''))
      .filter(Boolean)
    expect(claimStatements).toHaveLength(2)

    try {
      await database!.$transaction(
        async (transaction) => {
          const schema = `series_legacy_${randomUUID().replace(/-/gu, '')}`
          await transaction.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
          await transaction.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          await createLegacySchema(transaction)

          const claimable = await createSeries(transaction, '1001')
          const first = await createArtworkWithRefs(transaction, ['2001'])
          const second = await createArtworkWithRefs(transaction, ['2002'])
          await createMembership(transaction, claimable, first.artworkId, 7)
          await createMembership(transaction, claimable, second.artworkId, 8)

          const duplicateA = await createSeries(transaction, '1002')
          const duplicateB = await createSeries(transaction, '1002')
          await createMembership(transaction, duplicateA, (await createArtworkWithRefs(transaction, ['2011'])).artworkId, 1)
          await createMembership(transaction, duplicateB, (await createArtworkWithRefs(transaction, ['2012'])).artworkId, 1)

          const multiA = await createSeries(transaction, '1003')
          const multiB = await createSeries(transaction, '1004')
          const multiArtwork = await createArtworkWithRefs(transaction, ['2021'])
          await createMembership(transaction, multiA, multiArtwork.artworkId, 1)
          await createMembership(transaction, multiB, multiArtwork.artworkId, 1)

          const ambiguous = await createSeries(transaction, '1005')
          const ambiguousArtwork = await createArtworkWithRefs(transaction, ['2031', '2032'])
          await createMembership(transaction, ambiguous, ambiguousArtwork.artworkId, 1)

          for (const statement of claimStatements) await transaction.$executeRawUnsafe(statement)

          const claimedRefs = await transaction.$queryRawUnsafe<Array<{ seriesId: number; externalId: string }>>(
            `SELECT "seriesId", "externalId" FROM series_external_refs ORDER BY "seriesId"`
          )
          expect(claimedRefs).toEqual([{ seriesId: claimable, externalId: '1001' }])

          const memberships = await transaction.$queryRawUnsafe<
            Array<{ artworkId: number; provenance: string; sourceRefId: string | null; sortOrder: number }>
          >(
            `SELECT "artworkId", provenance, "sourceRefId", "sortOrder"
             FROM "SeriesArtwork" WHERE "seriesId" = $1 ORDER BY "sortOrder"`,
            claimable
          )
          expect(memberships).toEqual([
            { artworkId: first.artworkId, provenance: 'SOURCE', sourceRefId: first.refIds[0], sortOrder: 7 },
            { artworkId: second.artworkId, provenance: 'SOURCE', sourceRefId: second.refIds[0], sortOrder: 8 }
          ])
          throw rollback
        },
        { maxWait: 5_000, timeout: 20_000 }
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})

async function createLegacySchema(transaction: Prisma.TransactionClient) {
  const statements = [
    `CREATE TABLE "Series" (
      id serial PRIMARY KEY,
      title text NOT NULL,
      source text NOT NULL DEFAULT 'LOCAL',
      "externalId" text
    )`,
    `CREATE TABLE "Artwork" (id serial PRIMARY KEY, title text NOT NULL)`,
    `CREATE TABLE "SeriesArtwork" (
      "seriesId" integer NOT NULL,
      "artworkId" integer NOT NULL,
      "sortOrder" integer NOT NULL,
      provenance text NOT NULL DEFAULT 'LEGACY',
      "sourceRefId" text
    )`,
    `CREATE TABLE artwork_external_refs (
      id text PRIMARY KEY,
      "artworkId" integer NOT NULL,
      "providerKey" text NOT NULL,
      "externalId" text NOT NULL
    )`,
    `CREATE TABLE series_external_refs (
      id text PRIMARY KEY,
      "seriesId" integer NOT NULL,
      "providerKey" text NOT NULL,
      "externalId" text NOT NULL,
      "createdAt" timestamp NOT NULL,
      "updatedAt" timestamp NOT NULL
    )`
  ]
  for (const statement of statements) await transaction.$executeRawUnsafe(statement)
}

async function createSeries(transaction: Prisma.TransactionClient, externalId: string) {
  const rows = await transaction.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO "Series" (title, source, "externalId") VALUES ($1, 'PIXIV', $2) RETURNING id`,
    `Series ${externalId}`,
    externalId
  )
  return rows[0]!.id
}

async function createArtworkWithRefs(transaction: Prisma.TransactionClient, externalIds: string[]) {
  const rows = await transaction.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO "Artwork" (title) VALUES ($1) RETURNING id`,
    `Artwork ${externalIds.join('-')}`
  )
  const artworkId = rows[0]!.id
  const refIds = []
  for (const externalId of externalIds) {
    const refId = randomUUID()
    await transaction.$executeRawUnsafe(
      `INSERT INTO artwork_external_refs (id, "artworkId", "providerKey", "externalId")
       VALUES ($1, $2, 'pixiv', $3)`,
      refId,
      artworkId,
      externalId
    )
    refIds.push(refId)
  }
  return { artworkId, refIds }
}

function createMembership(
  transaction: Prisma.TransactionClient,
  seriesId: number,
  artworkId: number,
  sortOrder: number
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "SeriesArtwork" ("seriesId", "artworkId", "sortOrder") VALUES ($1, $2, $3)`,
    seriesId,
    artworkId,
    sortOrder
  )
}
