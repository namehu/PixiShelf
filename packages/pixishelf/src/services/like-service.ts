import { prisma } from '@/lib/prisma'

// 点赞结果接口
interface LikeResult {
  liked: boolean
  likeCount: number
  userLiked: boolean
}

// 点赞状态接口
export interface LikeStatus {
  likeCount: number
  userLiked: boolean
}

// 批量点赞状态接口
export interface BatchLikeStatus {
  [artworkId: number]: LikeStatus
}

// 并发控制：防抖映射表
const pendingLikeOperations = new Map<string, Promise<LikeResult>>()

// 操作时间戳映射表（用于清理过期操作）
const operationTimestamps = new Map<string, number>()

// 生成操作键
function getLikeOperationKey(userId: number, artworkId: number): string {
  return `${userId}-${artworkId}`
}

// 清理过期的操作记录（超过30秒的操作被认为是过期的）
function cleanupExpiredOperations() {
  const now = Date.now()
  const expireTime = 30 * 1000 // 30秒

  for (const [key, timestamp] of operationTimestamps.entries()) {
    if (now - timestamp > expireTime) {
      pendingLikeOperations.delete(key)
      operationTimestamps.delete(key)
    }
  }
}

// 定期清理过期操作（每分钟执行一次）
setInterval(cleanupExpiredOperations, 60 * 1000)

/**
 * 点赞服务层 - 业务逻辑封装
 * 职责：封装点赞相关的业务逻辑，数据验证和转换
 */
export const likeService = {
  /**
   * 切换点赞状态（并发安全版本）
   * @param userId 用户ID
   * @param artworkId 作品ID
   * @returns 点赞结果
   */
  async toggleLike(userId: number, artworkId: number): Promise<LikeResult> {
    // 参数验证
    if (!userId || !artworkId) {
      throw new Error('用户ID和作品ID不能为空')
    }

    const operationKey = getLikeOperationKey(userId, artworkId)

    // 检查是否有正在进行的相同操作（防抖）
    const existingOperation = pendingLikeOperations.get(operationKey)
    if (existingOperation) {
      console.log('Debouncing like operation for:', operationKey)
      return existingOperation
    }

    // 创建新的操作Promise
    const operation = this._performToggleLike(userId, artworkId)

    // 将操作添加到映射表并记录时间戳
    pendingLikeOperations.set(operationKey, operation)
    operationTimestamps.set(operationKey, Date.now())

    try {
      const result = await operation
      return result
    } finally {
      // 操作完成后清理映射表
      pendingLikeOperations.delete(operationKey)
      operationTimestamps.delete(operationKey)
    }
  },

  /**
   * 执行实际的点赞切换操作
   * @private
   */
  async _performToggleLike(userId: number, artworkId: number): Promise<LikeResult> {
    try {
      // 使用事务确保并发安全
      const result = await prisma.$transaction(
        async (tx) => {
          // 验证作品是否存在（加锁读取）
          const artwork = await tx.artwork.findUnique({
            where: { id: artworkId },
            select: { id: true, likeCount: true }
          })

          if (!artwork) {
            throw new Error('作品不存在')
          }

          // 验证用户是否存在
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true }
          })

          if (!user) {
            throw new Error('用户不存在')
          }

          // 检查是否已经点赞
          const existingLike = await tx.artworkLike.findUnique({
            where: {
              userId_artworkId: {
                userId,
                artworkId
              }
            }
          })

          if (existingLike) {
            // 取消点赞
            await tx.artworkLike.delete({ where: { id: existingLike.id } })
          } else {
            // 添加点赞
            await tx.artworkLike.create({ data: { userId, artworkId } })
          }

          let liked: boolean = !existingLike

          // 获取更新后的点赞数量（由数据库触发器自动更新）
          const updatedArtwork = await tx.artwork.findUnique({
            where: { id: artworkId },
            select: { likeCount: true }
          })

          return {
            liked,
            likeCount: updatedArtwork?.likeCount || 0,
            userLiked: liked
          }
        },
        {
          // 设置事务隔离级别为可重复读，避免幻读
          isolationLevel: 'RepeatableRead',
          // 设置超时时间
          timeout: 10000
        }
      )

      return result
    } catch (error) {
      console.error('Toggle like error:', error)

      // 处理并发冲突错误
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        // 重试机制：如果是唯一约束冲突，说明并发操作，等待一小段时间后重新尝试
        console.warn('Concurrent like operation detected, retrying after delay...')
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200)) // 100-300ms随机延迟
        return this._performToggleLike(userId, artworkId)
      }

      throw error
    }
  },

  /**
   * 获取点赞状态
   * @param userId 用户ID（可选，如果不提供则只返回点赞总数）
   * @param artworkId 作品ID
   * @returns 点赞状态
   */
  async getLikeStatus(userId: number | null, artworkId: number): Promise<LikeStatus> {
    try {
      // 参数验证
      if (!artworkId) {
        throw new Error('作品ID不能为空')
      }

      // 获取作品的点赞总数
      const artwork = await prisma.artwork.findUnique({
        where: { id: artworkId },
        select: { likeCount: true }
      })

      if (!artwork) {
        throw new Error('作品不存在')
      }

      let userLiked = false

      // 如果提供了用户ID，检查用户是否点赞了该作品
      if (userId) {
        const like = await prisma.artworkLike.findUnique({
          where: {
            userId_artworkId: { userId, artworkId }
          }
        })
        userLiked = !!like
      }

      return {
        likeCount: artwork.likeCount,
        userLiked
      }
    } catch (error) {
      console.error('Error getting like status:', error)
      if (error instanceof Error) {
        throw error
      }
      throw new Error('获取点赞状态失败')
    }
  },

  /**
   * 获取作品的点赞总数
   * @param artworkId 作品ID
   * @returns 点赞总数
   */
  async getLikeCount(artworkId: number): Promise<number> {
    try {
      // 参数验证
      if (!artworkId) {
        throw new Error('作品ID不能为空')
      }

      const artwork = await prisma.artwork.findUnique({
        where: { id: artworkId },
        select: { likeCount: true }
      })

      if (!artwork) {
        throw new Error('作品不存在')
      }

      return artwork.likeCount
    } catch (error) {
      console.error('Error getting like count:', error)
      if (error instanceof Error) {
        throw error
      }
      throw new Error('获取点赞数量失败')
    }
  },

  /**
   * 获取用户点赞的作品列表
   * @param userId 用户ID
   * @param options 查询选项
   * @returns 用户点赞的作品列表
   */
  async getUserLikedArtworks(
    userId: number,
    options: {
      page?: number
      pageSize?: number
    } = {}
  ) {
    try {
      // 参数验证
      if (!userId) {
        throw new Error('用户ID不能为空')
      }

      const { page = 1, pageSize = 10 } = options
      const skip = (page - 1) * pageSize

      // 查询用户点赞的作品
      const [likes, total] = await Promise.all([
        prisma.artworkLike.findMany({
          where: { userId },
          include: {
            artwork: {
              include: {
                artist: true,
                images: true,
                artworkTags: {
                  include: {
                    tag: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize
        }),
        prisma.artworkLike.count({
          where: { userId }
        })
      ])

      const artworks = likes.map((like) => like.artwork)

      return {
        artworks,
        total,
        page,
        pageSize
      }
    } catch (error) {
      console.error('Error getting user liked artworks:', error)
      if (error instanceof Error) {
        throw error
      }
      throw new Error('获取用户点赞作品失败')
    }
  },

  /**
   * 批量获取多个作品的点赞状态
   * @param userId 用户ID（可选）
   * @param artworkIds 作品ID数组
   * @returns 作品点赞状态映射
   */
  async getBatchLikeStatus(userId: number | null, artworkIds: number[]): Promise<Record<number, LikeStatus>> {
    try {
      // 参数验证
      if (!artworkIds || artworkIds.length === 0) {
        return {}
      }

      // 获取作品的点赞总数
      const artworks = await prisma.artwork.findMany({
        where: { id: { in: artworkIds } },
        select: { id: true, likeCount: true }
      })

      const result: Record<number, LikeStatus> = {}

      // 初始化结果
      artworks.forEach((artwork) => {
        result[artwork.id] = {
          likeCount: artwork.likeCount,
          userLiked: false
        }
      })

      // 如果提供了用户ID，查询用户的点赞状态
      if (userId) {
        const userLikes = await prisma.artworkLike.findMany({
          where: {
            userId,
            artworkId: { in: artworkIds }
          },
          select: { artworkId: true }
        })

        // 更新用户点赞状态
        userLikes.forEach((like) => {
          const likeStatus = result[like.artworkId]
          if (likeStatus) {
            likeStatus.userLiked = true
          }
        })
      }

      return result
    } catch (error) {
      console.error('Error getting batch like status:', error)
      if (error instanceof Error) {
        throw error
      }
      throw new Error('批量获取点赞状态失败')
    }
  }
}
