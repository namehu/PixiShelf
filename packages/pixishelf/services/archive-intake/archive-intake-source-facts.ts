import { Prisma } from '@pixishelf/db'
import { archiveSourceSizeBytes } from '@/services/archive/archive-source-metadata'

export interface IntakeSourceFacts {
  sourceSizeBytes: number | null
  pageCount: number | null
}

/** Project only the needed JSON scalars; inbox lists must not load an entire resolved media plan. */
export async function readIntakeSourceFacts(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>,
  ids: readonly string[]
) {
  if (ids.length === 0) return new Map<string, IntakeSourceFacts>()
  const rows = await database.$queryRaw<
    Array<{ id: string; resolvedFileSize: unknown; catalogFileSize: unknown; catalogFileCount: unknown }>
  >(Prisma.sql`
    SELECT intake."id", intake."resolvedSnapshot"->'normalizedMetadata'->'fileSize' AS "resolvedFileSize",
      catalog."comparisonSnapshot"->'fileSize' AS "catalogFileSize",
      catalog."comparisonSnapshot"->'fileCount' AS "catalogFileCount"
    FROM archive_intake_items intake
    LEFT JOIN LATERAL (
      SELECT catalog."comparisonSnapshot" FROM archive_uploader_catalog_items catalog
      WHERE catalog."lastIntakeItemId" = intake."id"
      ORDER BY catalog."lastSeenAt" DESC, catalog."id" DESC LIMIT 1
    ) catalog ON true
    WHERE intake."id" IN (${Prisma.join([...ids])})
  `)
  return new Map(
    rows.map((row) => [
      row.id,
      {
        sourceSizeBytes:
          archiveSourceSizeBytes({ fileSize: row.resolvedFileSize }) ??
          archiveSourceSizeBytes({ fileSize: row.catalogFileSize }),
        pageCount:
          typeof row.catalogFileCount === 'number' &&
          Number.isSafeInteger(row.catalogFileCount) &&
          row.catalogFileCount > 0
            ? row.catalogFileCount
            : null
      }
    ])
  )
}
