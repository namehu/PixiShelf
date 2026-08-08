import { prisma } from '@/lib/prisma'

interface TagCountRebuildRow {
  updated_count: number | bigint
}

export interface TagCountRebuildResult {
  updatedTags: number
}

/**
 * 一次聚合 ArtworkTag 并集合式校准所有不一致的 Tag.artworkCount。
 */
export async function rebuildTagArtworkCounts(): Promise<TagCountRebuildResult> {
  const rows = await prisma.$queryRawUnsafe<TagCountRebuildRow[]>(`
    WITH counts AS (
      SELECT
        t.id,
        COALESCE(c.artwork_count, 0)::INTEGER AS artwork_count
      FROM "Tag" t
      LEFT JOIN (
        SELECT "tagId", COUNT(*) AS artwork_count
        FROM "ArtworkTag"
        GROUP BY "tagId"
      ) c ON c."tagId" = t.id
    ),
    updated AS (
      UPDATE "Tag" t
      SET
        "artworkCount" = counts.artwork_count,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM counts
      WHERE t.id = counts.id
        AND t."artworkCount" IS DISTINCT FROM counts.artwork_count
      RETURNING t.id
    )
    SELECT COUNT(*)::INTEGER AS updated_count
    FROM updated
  `)

  return { updatedTags: Number(rows[0]?.updated_count ?? 0) }
}
