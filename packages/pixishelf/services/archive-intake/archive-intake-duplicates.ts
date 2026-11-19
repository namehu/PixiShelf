import { Prisma } from '@pixishelf/db'
import { hashSubmittedUrl } from './archive-intake-url'

interface GalleryIdentity {
  providerKey: string
  externalId: string
}

export const ACTIVE_INTAKE_STATUSES = ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] as const

// A gallery and one of its page URLs have the same provider identity before remote resolution.
// Check only previously committed items so aliases submitted together keep their individual receipts.
export async function findActiveIntakeDuplicates(
  tx: Prisma.TransactionClient,
  identities: ReadonlyMap<string, GalleryIdentity>,
  excludeItemId?: string
) {
  const duplicates = new Map<string, { id: string; creatorSourceName: string | null }>()
  if (!identities.size) return duplicates
  const requested = [...identities].map(
    ([url, identity]) => Prisma.sql`(
    ${url}::text, ${hashSubmittedUrl(url)}::text, ${identity.providerKey}::text, ${identity.externalId}::text
  )`
  )
  const rows = await tx.$queryRaw<Array<{ url: string; id: string; creatorSourceName: string | null }>>(Prisma.sql`
    WITH requested(url, hash, provider, gid) AS (VALUES ${Prisma.join(requested)}),
    active AS (
      SELECT id FROM archive_intake_items WHERE status IN (
        ${Prisma.join(ACTIVE_INTAKE_STATUSES.map((status) => Prisma.sql`${status}::"ArchiveIntakeStatus"`))}
      )
      UNION ALL
      SELECT i.id FROM archive_imports a JOIN archive_intake_items i ON i."archiveImportId" = a.id
      WHERE i.status = 'ENQUEUED' AND a.status IN ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING')
    )
    SELECT DISTINCT ON (q.url) q.url, i.id, i."creatorSourceName"
    FROM active JOIN archive_intake_items i ON i.id = active.id
    JOIN requested q ON (q.hash = i."normalizedUrlHash" AND q.url = i."submittedUrl") OR (
      q.provider = COALESCE(i."providerKey", i."dedupSourceSnapshot" #>> '{sources,0,identity,providerKey}') AND
      q.gid = COALESCE(i."externalId", i."dedupSourceSnapshot" #>> '{sources,0,identity,externalId}')
    )
    ${excludeItemId ? Prisma.sql`WHERE i.id <> ${excludeItemId}` : Prisma.empty}
    ORDER BY q.url, i."queueOrder"
  `)
  for (const row of rows) duplicates.set(row.url, { id: row.id, creatorSourceName: row.creatorSourceName })
  return duplicates
}
