import { prisma } from '@/lib/prisma'

/**
 * 切换点赞状态
 * 优化：移除复杂的内存防抖，利用数据库事务保证一致性
 * @param userId 用户ID
 * @param artworkId 作品ID
 * @returns 点赞结果
 */
export async function toggleLike(userId: string, artworkId: number) {
  // 参数验证
  if (!userId || !artworkId) {
    throw new Error('用户ID和作品ID不能为空')
  }

  // 使用事务确保操作原子性
  return await prisma.$transaction(async (tx) => {
    // 1. 检查当前是否已点赞
    const existingLike = await tx.artworkLike.findUnique({
      where: {
        userId_artworkId: {
          userId,
          artworkId
        }
      }
    })

    let isLiked = false

    if (existingLike) {
      // 2. 如果已点赞，则取消点赞
      await tx.artworkLike.delete({
        where: { id: existingLike.id }
      })
      isLiked = false
    } else {
      // 3. 如果未点赞，则添加点赞
      // 注意：如果 artworkId 或 userId 无效，外键约束会抛出异常
      await tx.artworkLike.create({
        data: { userId, artworkId }
      })
      isLiked = true
    }

    return isLiked
  })
}

/**
 * 批量获取多个作品的点赞状态
 * 优化：仅查询用户是否点赞，不查询点赞总数
 * @param uid 用户ID
 * @param artworkIds 作品ID数组
 * @returns 作品点赞状态映射 { [artworkId]: boolean }
 */
export async function getUserArtworkLikeStatus(uid: string, artworkIds: number[]): Promise<Record<number, boolean>> {
  const result: Record<number, boolean> = {}

  // 参数验证
  if (!artworkIds?.length || !uid) {
    return result
  }

  // 初始化结果为 false
  artworkIds.forEach((id) => {
    result[id] = false
  })

  // 查询用户的点赞状态
  const userLikes = await prisma.artworkLike.findMany({
    where: {
      userId: uid,
      artworkId: { in: artworkIds }
    },
    select: { artworkId: true }
  })

  // 更新用户点赞状态
  userLikes.forEach((like) => {
    result[like.artworkId] = true
  })

  return result
}
