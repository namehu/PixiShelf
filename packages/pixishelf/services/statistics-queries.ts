import { Prisma } from '@pixishelf/db'

// Both subqueries share one MVCC snapshot, including images without an artwork.
export const optimizedImageCountSql = Prisma.sql`
  SELECT (
    COALESCE((SELECT SUM("imageCount") FROM "Artwork"), 0)
    + (SELECT COUNT(*) FROM "Image" WHERE "artworkId" IS NULL)
  )::bigint AS count
`

export const exactImageCountSql = Prisma.sql`SELECT COUNT(*) AS count FROM "Image"`

export function toStatisticsCount(value: bigint): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid statistics count')
  return count
}
