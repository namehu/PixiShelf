import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'
import { apiHandler } from '@/lib/api-handler'
import { UserDeleteSchema } from '@/schemas/api/user'
import { ApiError } from '@/lib/errors'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '@/lib/constants'

// ============================================================================
// 用户管理 API 路由
// ============================================================================

/**
 * 删除用户接口
 * DELETE /api/v1/users/[id]
 */
export const DELETE = apiHandler(UserDeleteSchema, async (request, data) => {
  const userId = data.id

  // 验证认证
  const authResult = await verifyAuth(request)
  if (!authResult.success) {
    throw new ApiError(ERROR_MESSAGES.UNAUTHORIZED, 401)
  }

  // 防止删除自己
  if (authResult.user && Number(authResult.user.id) === userId) {
    throw new ApiError('Cannot delete yourself', 400)
  }

  // 检查是否是最后一个用户
  const totalUsers = await prisma.user.count()
  if (totalUsers <= 1) {
    throw new ApiError('Cannot delete the last user', 400)
  }

  // 检查用户是否存在
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new ApiError(ERROR_MESSAGES.NOT_FOUND, 404)
  }

  // 删除用户
  await prisma.user.delete({ where: { id: userId } })

  return { message: SUCCESS_MESSAGES.DELETE_SUCCESS }
})
