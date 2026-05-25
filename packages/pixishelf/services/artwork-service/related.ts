import 'server-only'
import { prisma } from '@/lib/prisma'
import { NeighboringArtworksGetSchema } from '@/schemas/artwork.dto'
import { transformSingleArtwork } from './utils'

/**
 * 获取邻近作品（前后作品）
 * @description 根据 sourceDate 排序，获取指定作品前后的作品列表
 */
export async function getNeighboringArtworks(input: NeighboringArtworksGetSchema) {
  const { artistId, artworkId, limit, direction } = input

  // 1. 获取当前作品（作为 cursor）的 sourceDate 和 ID
  const cursorArtwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    select: { id: true, sourceDate: true }
  })

  if (!cursorArtwork || !cursorArtwork.sourceDate) {
    return []
  }

  const cursorDate = cursorArtwork.sourceDate
  const cursorId = cursorArtwork.id

  // 公共 include
  const commonInclude = {
    images: { take: 2, orderBy: { sortOrder: 'asc' } as const },
    artist: true,
    artworkTags: { include: { tag: true } }
  }

  // 2. 根据 direction 分支处理
  if (direction === 'newer') {
    // 向左加载更多（更新的作品）
    // 条件：(sourceDate > cursorDate) OR (sourceDate = cursorDate AND id > cursorId)
    // 排序：ASC (离 cursor 最近的先查出来)
    const items = await prisma.artwork.findMany({
      where: {
        artistId,
        OR: [{ sourceDate: { gt: cursorDate } }, { sourceDate: cursorDate, id: { gt: cursorId } }]
      },
      orderBy: [{ sourceDate: 'asc' }, { id: 'asc' }],
      take: limit,
      include: commonInclude
    })
    // 结果需要 reverse，使其符合 DESC 顺序（[最远新...最近新] -> [最近新...最远新] wait..
    // UI 需要拼接到头部。
    // 查询结果：[New1(近), New2(远), New3(更远)]
    // 如果直接返回这个数组，前端 prepend: [New1, New2, New3, Current...] -> 顺序变成了 升序 (New1 < New2 < New3) 错误。
    // 前端列表期望：[New3, New2, New1, Current...] (降序)
    // 所以我们需要 reverse 吗？
    // [New1, New2, New3].reverse() -> [New3, New2, New1]. Correct.
    return items.reverse().map(transformSingleArtwork)
  }

  if (direction === 'older') {
    // 向右加载更多（更旧的作品）
    // 条件：(sourceDate < cursorDate) OR (sourceDate = cursorDate AND id < cursorId)
    // 排序：DESC (离 cursor 最近的先查出来)
    const items = await prisma.artwork.findMany({
      where: {
        artistId,
        OR: [{ sourceDate: { lt: cursorDate } }, { sourceDate: cursorDate, id: { lt: cursorId } }]
      },
      orderBy: [{ sourceDate: 'desc' }, { id: 'desc' }],
      take: limit,
      include: commonInclude
    })
    // 查询结果：[Old1(近), Old2(远)]
    // 前端 append: [Current, Old1, Old2...] (降序). Correct.
    return items.map(transformSingleArtwork)
  }

  // default: 'both' (Initial load)
  // 3. 获取“前”（Newer/Previous）的作品
  const prevItems = await prisma.artwork.findMany({
    where: {
      artistId,
      OR: [{ sourceDate: { gt: cursorDate } }, { sourceDate: cursorDate, id: { gt: cursorId } }]
    },
    orderBy: [{ sourceDate: 'asc' }, { id: 'asc' }],
    take: limit,
    include: commonInclude
  })

  // 4. 获取“后”（Older/Next）的作品
  const nextItems = await prisma.artwork.findMany({
    where: {
      artistId,
      OR: [{ sourceDate: { lt: cursorDate } }, { sourceDate: cursorDate, id: { lt: cursorId } }]
    },
    orderBy: [{ sourceDate: 'desc' }, { id: 'desc' }],
    take: limit,
    include: commonInclude
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

  // 6. 组合结果
  const allRaw = [...prevItems.reverse(), currentFull!, ...nextItems]

  return allRaw.map(transformSingleArtwork)
}
