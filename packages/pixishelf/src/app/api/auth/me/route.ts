import { z } from 'zod'
import { apiHandler, responseSuccess } from '@/lib/api-handler'
import { sessionManager } from '@/lib/session'
import { ApiError } from '@/lib/errors'
import { AuthMeResponseDTO } from '@/schemas/auth.dto'

// 定义获取用户信息 Schema (空对象，不需要参数)
const MeSchema = z.object({})

/**
 * 获取当前登录用户信息
 * GET /api/auth/me
 */
export const GET = apiHandler(MeSchema, async (request) => {
  // 从请求中提取认证令牌
  const token = sessionManager.extractTokenFromRequest(request)
  if (!token) {
    throw new ApiError('未提供认证令牌', 401)
  }

  // 验证会话
  const session = await sessionManager.getSession(token)
  if (!session) {
    throw new ApiError('会话已过期或无效', 401)
  }

  // 检查会话是否需要刷新
  const refreshedSession = await sessionManager.refreshSession(token)
  if (!refreshedSession) {
    throw new ApiError('会话刷新失败', 401)
  }

  // 返回用户信息
  // 手动构建 NextResponse 以支持 Cookie 更新
  const response = responseSuccess({
    data: AuthMeResponseDTO.parse({
      id: refreshedSession.userId,
      username: refreshedSession.username
    })
  })

  return response
})
