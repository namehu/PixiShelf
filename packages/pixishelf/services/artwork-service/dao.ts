import 'server-only'

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * 使用原生 SQL 随机获取作品 ID
 */
export async function fetchRandomIds(limit: number, tagNames?: string[]): Promise<number[]> {
  const filteredTagNames = (tagNames ?? []).map((tag) => tag.trim()).filter(Boolean)

  if (filteredTagNames.length > 0) {
    const randomIdsResult = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`
        SELECT candidate.id
        FROM (
          SELECT DISTINCT a.id
          FROM "Artwork" a
          INNER JOIN "ArtworkTag" at ON at."artworkId" = a.id
          INNER JOIN "Tag" t ON t.id = at."tagId"
          WHERE t.name IN (${Prisma.join(filteredTagNames)})
        ) AS candidate
        ORDER BY RANDOM()
        LIMIT ${limit}
      `
    )
    return randomIdsResult.map((a) => a.id)
  }

  const randomIdsResult = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${limit}`
  )
  return randomIdsResult.map((a) => a.id)
}
