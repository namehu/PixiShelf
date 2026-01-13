import 'server-only'
import { prisma } from '@/lib/prisma'
import { NeighboringArtworksGetSchema } from '@/schemas/artwork.dto'
import { transformSingleArtwork } from './utils'

/**
 * 获取邻近作品（前后作品）
 * @description 根据 sourceDate 排序，获取指定作品前后的作品列表
 */
export async function getNeighboringArtworks(input: NeighboringArtworksGetSchema) {
  const { artistId, artworkId, limit } = input

  // 1. 获取当前作品的 sourceDate 和 ID，用于定位
  const current = await prisma.artwork.findUnique({
    where: { id: artworkId },
    select: { id: true, sourceDate: true, createdAt: true }
    // 确保当前作品存在
  })

  if (!current || !current.sourceDate) {
    return []
  }

  const currentDate = current.sourceDate

  // 2. 查询条件：同一艺术家
  // 排序逻辑：sourceDate DESC, id DESC (最新的在前)

  // 3. 获取“前”（Newer/Previous）的作品
  // 这里的“前”是指在列表排序中位于当前作品之前的元素（即比当前作品更新）
  // 条件：(sourceDate > curDate) OR (sourceDate = curDate AND id > curId)
  // 排序：为了取到紧邻的，需要用 ASC 排序（sourceDate ASC, id ASC），取完后再反转
  const prevItems = await prisma.artwork.findMany({
    where: {
      artistId,
      OR: [{ sourceDate: { gt: currentDate } }, { sourceDate: currentDate, id: { gt: current.id } }]
    },
    orderBy: [{ sourceDate: 'asc' }, { id: 'asc' }],
    take: limit,
    include: {
      images: { take: 2, orderBy: { sortOrder: 'asc' } },
      artist: true,
      artworkTags: { include: { tag: true } }
    }
  })

  // 4. 获取“后”（Older/Next）的作品
  // 这里的“后”是指在列表排序中位于当前作品之后的元素（即比当前作品更旧）
  // 条件：(sourceDate < curDate) OR (sourceDate = curDate AND id < curId)
  // 排序：sourceDate DESC, id DESC
  const nextItems = await prisma.artwork.findMany({
    where: {
      artistId,
      OR: [{ sourceDate: { lt: currentDate } }, { sourceDate: currentDate, id: { lt: current.id } }]
    },
    orderBy: [{ sourceDate: 'desc' }, { id: 'desc' }],
    take: limit,
    include: {
      images: { take: 2, orderBy: { sortOrder: 'asc' } },
      artist: true,
      artworkTags: { include: { tag: true } }
    }
  })

  // 5. 获取当前作品的完整信息
  const currentFull = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      artist: true,
      artworkTags: { include: { tag: true } }
    }
  })

  // 6. 组合结果：[...Newer(reversed), Current, ...Older]
  // 注意 prevItems 是 ASC 排序的（离 current 最近的在最前），所以需要 reverse 变成 DESC 顺序
  // [Newer3, Newer2, Newer1] (closest) -> reverse -> [Newer1, Newer2, Newer3] (wrong?)

  // Wait.
  // DB ASC: [ClosestNewer, NextClosestNewer, FurthestNewer]
  // We want DESC Order: [FurthestNewer, NextClosestNewer, ClosestNewer, CURRENT, ClosestOlder, NextClosestOlder, FurthestOlder]
  // So we need to reverse prevItems.

  const allRaw = [...prevItems.reverse(), currentFull!, ...nextItems]

  return allRaw.map(transformSingleArtwork)
}
