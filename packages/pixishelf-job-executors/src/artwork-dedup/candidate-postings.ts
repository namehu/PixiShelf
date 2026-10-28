import { Prisma } from '@pixishelf/db'
import { VISUAL_LIMITS } from './visual-matching.ts'

type Posting = { imageId: number; multiplicity: number }

/** The caller holds the run fence. Scalar key seeks avoid a new run's stale
 * statistics turning key IN (...) into a filter over its entire posting range. */
export async function readCandidatePostings(tx: Prisma.TransactionClient, runId: string, inputKeys: readonly string[]): Promise<Posting[]> {
  const keys = [...new Set(inputKeys)]
  // Four views, ten regions and four bands is the existing feature bound.
  if (keys.length > 160) throw new RangeError('Visual posting key budget')
  if (!keys.length) return []
  const cap = VISUAL_LIMITS.queryPostings + 1
  // Both limits matter: the inner one prevents flattening of the key seek;
  // the outer one stops consumption across all keys. No outer sort may force
  // every bucket to materialize. At cap, positive multiplicity guarantees a
  // budget failure; below cap all postings are present and candidates are
  // independently sorted numerically before any checkpoint is persisted.
  return tx.$queryRaw<Posting[]>(Prisma.sql`
    SELECT posting."imageId",posting.multiplicity
    FROM (VALUES ${Prisma.join(keys.map(key => Prisma.sql`(${key}::text)`))}) AS requested(key)
    CROSS JOIN LATERAL (
      SELECT p."imageId",p.multiplicity FROM "ArtworkDedupVisualPosting" p
      WHERE p."runId"=${runId} AND p.key=requested.key
      ORDER BY p."imageId" LIMIT ${cap}
    ) posting LIMIT ${cap}`)
}
