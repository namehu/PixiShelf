import 'server-only'

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * 使用原生 SQL 随机获取作品 ID
 */
export async function fetchRandomIds(limit: number): Promise<number[]> {
  const randomIdsResult = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${limit}`
  )
  return randomIdsResult.map((a) => a.id)
}
