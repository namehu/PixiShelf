import 'server-only'

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * 从随机主键位置按索引获取一个作品窗口。
 */
export async function fetchRandomIds(limit: number, tagNames?: string[]): Promise<number[]> {
  const filteredTagNames = (tagNames ?? []).map((tag) => tag.trim()).filter(Boolean)
  const safeLimit = Math.max(0, Math.floor(limit))
  if (safeLimit === 0) return []

  const where: Prisma.ArtworkWhereInput =
    filteredTagNames.length > 0
      ? {
          artworkTags: {
            some: {
              tag: {
                name: { in: filteredTagNames }
              }
            }
          }
        }
      : {}

  const bounds = await prisma.artwork.aggregate({
    _min: { id: true },
    _max: { id: true }
  })
  const minId = bounds._min.id
  const maxId = bounds._max.id

  if (minId == null || maxId == null) return []

  // 从随机主键位置开始按索引读取一个窗口，避免 ORDER BY RANDOM() 扫描并排序整张表。
  const pivot = minId + Math.floor(Math.random() * (maxId - minId + 1))
  const firstBatch = await prisma.artwork.findMany({
    where: { ...where, id: { gte: pivot } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: safeLimit
  })

  if (firstBatch.length >= safeLimit) {
    return firstBatch.map(({ id }) => id)
  }

  const wrappedBatch = await prisma.artwork.findMany({
    where: { ...where, id: { lt: pivot } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: safeLimit - firstBatch.length
  })

  return [...firstBatch, ...wrappedBatch].map(({ id }) => id)
}
