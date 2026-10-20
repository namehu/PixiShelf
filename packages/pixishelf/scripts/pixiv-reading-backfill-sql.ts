import { groupLogicalMedia } from '@pixishelf/job-contracts'
import { z } from 'zod'

export interface ReadingBackfillSnapshot {
  id: number
  mediaRevision: number
  images: Array<{ id: number; path: string; mediaType: string; sortOrder: number }>
  summary: Record<string, unknown> | null
  readMedia: Array<Record<string, unknown>>
}

export const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`

const jsonColumn = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => typeof value === 'string' ? JSON.parse(value) : value, schema)

const snapshotSchema = z.object({
  id: z.number().int().positive(),
  mediaRevision: z.number().int().positive(),
  images: jsonColumn(z.array(z.object({
    id: z.number().int().positive(),
    path: z.string(),
    mediaType: z.string(),
    sortOrder: z.number().int()
  }))),
  summary: jsonColumn(z.record(z.string(), z.unknown()).nullable()),
  readMedia: jsonColumn(z.array(z.record(z.string(), z.unknown())))
})

// DBX CLI returns PostgreSQL jsonb cells as strings; Prisma returns decoded values.
export function decodeReadingSnapshots(rows: unknown): ReadingBackfillSnapshot[] {
  return z.array(snapshotSchema).parse(rows)
}

export function snapshotQuery(userId: string, afterId: number, throughId: number, limit = 25) {
  if (![afterId, throughId, limit].every(Number.isSafeInteger) || limit < 1 || limit > 100) throw new Error('Invalid bounds')
  return `SELECT a.id, a."mediaRevision",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'path', i.path, 'mediaType', i."mediaType", 'sortOrder', i."sortOrder") ORDER BY i."sortOrder", i.id)
      FROM "Image" i WHERE i."artworkId" = a.id), '[]'::jsonb) AS images,
    (SELECT to_jsonb(s) FROM artwork_reading_summaries s WHERE s."artworkId" = a.id AND s."userId" = ${sqlLiteral(userId)}) AS summary,
    COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."mediaId") FROM artwork_read_media r WHERE r."artworkId" = a.id AND r."userId" = ${sqlLiteral(userId)}), '[]'::jsonb) AS "readMedia"
    FROM "Artwork" a
    WHERE a.id > ${afterId} AND a.id <= ${throughId} AND a."createdVia" = 'PIXIV_SCAN'
      AND a."deletedAt" IS NULL AND a."archiveLifecycleState" = 'ACTIVE'
    ORDER BY a.id LIMIT ${limit}`
}

/** Execute all statements in ONE transaction; the second statement sees post-lock state. */
export function backfillStatements(userId: string, snapshots: ReadingBackfillSnapshot[]): string[] {
  if (!userId || snapshots.length < 1 || snapshots.length > 100) throw new Error('Invalid batch')
  if (snapshots.some(({ id }) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid artwork ID')
  const frozen = snapshots.map((row) => ({ ...row, totalCount: groupLogicalMedia(row.images).length }))
  const user = sqlLiteral(userId)
  return [
    "SET LOCAL lock_timeout = '2s'",
    "SET LOCAL statement_timeout = '30s'",
    `SELECT id FROM "Artwork" WHERE id IN (${snapshots.map(({ id }) => id).join(',')}) ORDER BY id FOR UPDATE`,
    `WITH frozen AS (
      SELECT * FROM jsonb_to_recordset(${sqlLiteral(JSON.stringify(frozen))}::jsonb)
      AS f(id int, "mediaRevision" int, images jsonb, summary jsonb, "readMedia" jsonb, "totalCount" int)
    ), eligible AS MATERIALIZED (
      SELECT f.* FROM frozen f JOIN "Artwork" a ON a.id = f.id
      WHERE a."createdVia" = 'PIXIV_SCAN' AND a."deletedAt" IS NULL AND a."archiveLifecycleState" = 'ACTIVE'
        AND a."mediaRevision" = f."mediaRevision" AND f."totalCount" > 0
        AND EXISTS (SELECT 1 FROM "UserBA" WHERE id = ${user})
        AND COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'path', i.path, 'mediaType', i."mediaType", 'sortOrder', i."sortOrder") ORDER BY i."sortOrder", i.id)
          FROM "Image" i WHERE i."artworkId" = a.id), '[]'::jsonb) = f.images
        AND COALESCE((SELECT to_jsonb(s) FROM artwork_reading_summaries s WHERE s."artworkId" = a.id AND s."userId" = ${user}), 'null'::jsonb) = COALESCE(f.summary, 'null'::jsonb)
        AND COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."mediaId") FROM artwork_read_media r WHERE r."artworkId" = a.id AND r."userId" = ${user}), '[]'::jsonb) = f."readMedia"
    ), marked AS (
      INSERT INTO artwork_read_media ("userId", "artworkId", "mediaId", "firstSeenAt")
      SELECT ${user}, e.id, i.id, CURRENT_TIMESTAMP FROM eligible e JOIN "Image" i ON i."artworkId" = e.id
      ON CONFLICT DO NOTHING RETURNING "artworkId", "mediaId"
    ), summarized AS (
      INSERT INTO artwork_reading_summaries
        ("userId", "artworkId", "viewCount", "seenCount", "totalCount", "stateVersion", "createdAt", "updatedAt")
      SELECT ${user}, id, 0, "totalCount", "totalCount", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM eligible
      ON CONFLICT ("userId", "artworkId") DO UPDATE SET
        "seenCount" = EXCLUDED."seenCount", "totalCount" = EXCLUDED."totalCount",
        "stateVersion" = artwork_reading_summaries."stateVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE artwork_reading_summaries."seenCount" IS DISTINCT FROM EXCLUDED."seenCount"
        OR artwork_reading_summaries."totalCount" IS DISTINCT FROM EXCLUDED."totalCount"
        OR EXISTS (SELECT 1 FROM marked WHERE marked."artworkId" = EXCLUDED."artworkId")
      RETURNING "artworkId"
    )
    SELECT (SELECT count(*) FROM frozen)::int AS planned,
      (SELECT count(*) FROM eligible)::int AS eligible,
      (SELECT count(*) FROM marked)::int AS "insertedMedia",
      (SELECT count(*) FROM summarized)::int AS "updatedSummaries"`
  ]
}
