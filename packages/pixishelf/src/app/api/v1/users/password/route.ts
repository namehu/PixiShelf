import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'
import { apiHandler } from '@/lib/api-handler'
import { ChangePasswordSchema } from '@/schemas/api/user'
import { ApiError } from '@/lib/errors'
import { ERROR_MESSAGES } from '@/lib/constants'

// ============================================================================
// 修改密码 API 路由
// ============================================================================

/**
 * 修改密码接口
 * PUT /api/v1/users/password
 */
export const PUT = apiHandler(ChangePasswordSchema, async (request, data) => {
  const { currentPassword, newPassword } = data

  // 验证认证
  const authResult = await verifyAuth(request)
  if (!authResult.success || !authResult.user) {
    throw new ApiError(ERROR_MESSAGES.UNAUTHORIZED, 401)
  }

  // 获取当前用户信息
  const user = await prisma.user.findUnique({ where: { id: Number(authResult.user.id) } })
  if (!user) {
    throw new ApiError(ERROR_MESSAGES.NOT_FOUND, 404)
  }

  // 验证当前密码
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
  if (!isCurrentPasswordValid) {
    throw new ApiError('当前密码不正确', 400)
  }

  // 加密新密码
  const salt = await bcrypt.genSalt(10)
  const hashedNewPassword = await bcrypt.hash(newPassword, salt)

  // 更新密码
  await prisma.user.update({
    where: { id: Number(authResult.user.id) },
    data: { password: hashedNewPassword }
  })

  return {
    success: true,
    message: '密码修改成功'
  }
})
