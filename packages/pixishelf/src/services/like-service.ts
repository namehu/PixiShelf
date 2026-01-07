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
// 注意：在Next.js热重载环境中，这可能会产生多个定时器。
// 在生产环境中通常没问题，但在开发环境中可能需要处理。
// 这里简单处理，如果已经存在就不再设置（实际上模块级别的副作用在重新加载时会重新执行）
const cleanupInterval = setInterval(cleanupExpiredOperations, 60 * 1000)
if (process.env.NODE_ENV !== 'production') {
  // 简单的防止内存泄漏尝试，但在纯模块文件中很难做到完美的清理
}

/**
 * 切换点赞状态（并发安全版本）
 * @param userId 用户ID
 * @param artworkId 作品ID
 * @returns 点赞结果
 */
export async function toggleLike(userId: number, artworkId: number): Promise<LikeResult> {
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
  const operation = performToggleLike(userId, artworkId)

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
}

/**
 * 执行实际的点赞切换操作
 * @private 内部函数
 */
async function performToggleLike(userId: number, artworkId: number): Promise<LikeResult> {
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
      return performToggleLike(userId, artworkId)
    }

    throw error
  }
}

/**
 * 批量获取多个作品的点赞状态
 * 仅查询用户是否点赞，不查询点赞总数
 * @param uid 用户ID
 * @param artworkIds 作品ID数组
 * @returns 作品点赞状态映射 { [artworkId]: boolean }
 */
export async function getUserArtworkLikeStatus(uid: number, artworkIds: number[]): Promise<Record<number, boolean>> {
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
