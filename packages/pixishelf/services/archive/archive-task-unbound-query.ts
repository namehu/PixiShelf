import { Prisma, type PrismaClient } from '@pixishelf/db'
import type { z } from 'zod'
import type { archiveTaskListSchema } from './archive-task-service'

// Filter before LIMIT; filtering a hydrated page can hide later unbound tasks.
export async function unboundArchiveTaskIds(
  database: PrismaClient,
  input: z.output<typeof archiveTaskListSchema>,
  cursor: { createdAt: Date; id: string } | null
) {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`
    NOT EXISTS (SELECT 1 FROM discovery_pending_creators p
      WHERE p."providerKey" = t."providerKey" AND p."externalId" = t."externalId")
    AND NOT EXISTS (SELECT 1 FROM artwork_external_refs r
      JOIN "Artwork" a ON a.id = r."artworkId"
      JOIN effective_artwork_creators e ON e."artworkId" = a.id
      WHERE r."providerKey" = t."providerKey" AND r."externalId" = t."externalId"
        AND a."deletedAt" IS NULL AND a."archiveLifecycleState" = 'ACTIVE')
  `
  ]
  if (input.statuses?.length) clauses.push(Prisma.sql`t.status::text IN (${Prisma.join(input.statuses)})`)
  if (input.providerKey) clauses.push(Prisma.sql`t."providerKey" = ${input.providerKey}`)
  if (input.kind || input.submissionId) {
    clauses.push(Prisma.sql`EXISTS (
    SELECT 1 FROM archive_intake_items i WHERE i."archiveImportId" = t.id
    ${input.kind ? Prisma.sql`AND i."resolutionKind"::text = ${input.kind}` : Prisma.empty}
    ${input.submissionId ? Prisma.sql`AND i."submissionId" = ${input.submissionId}` : Prisma.empty}
  )`)
  }
  if (input.search) {
    const pattern = `%${input.search}%`
    clauses.push(Prisma.sql`(t."submittedUrl" ILIKE ${pattern} OR t."canonicalUrl" ILIKE ${pattern}
      OR t."externalId" ILIKE ${pattern} OR t."normalizedMetadata" #>> '{titles,display}' LIKE ${pattern})`)
  }
  if (cursor) {
    clauses.push(Prisma.sql`(t."createdAt" < ${cursor.createdAt}
    OR (t."createdAt" = ${cursor.createdAt} AND t.id < ${cursor.id}))`)
  }
  const rows = await database.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t.id FROM archive_imports t WHERE ${Prisma.join(clauses, ' AND ')}
    ORDER BY t."createdAt" DESC, t.id DESC LIMIT ${input.limit + 1}
  `)
  return rows.map((row) => row.id)
}
