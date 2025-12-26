import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-handler'
import { sessionManager } from '@/lib/session'
import { SUCCESS_MESSAGES } from '@/lib/constants'
import type { LogoutResponse } from '@/types/auth'
import logger from '@/lib/logger'

// 定义登出 Schema (空对象，不需要参数)
const LogoutSchema = z.object({})

/**
 * 处理用户登出请求
 * POST /api/auth/logout
 */
export const POST = apiHandler(LogoutSchema, async (request) => {
  // 辅助函数：创建统一的登出成功响应
  const createSuccessResponse = () => {
    const response = NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS
      } satisfies LogoutResponse,
      { status: 200 }
    )
    // 无论如何都清除 Cookie
    response.cookies.delete('auth-token')
    return response
  }

  try {
    // 从请求中提取认证令牌
    const token = sessionManager.extractTokenFromRequest(request)

    // 如果有令牌，尝试销毁会话
    if (token) {
      await sessionManager.destroySession(token)
    }

    // 返回成功响应
    return createSuccessResponse()
  } catch (error) {
    logger.error('登出API错误:', error)
    // 即使出现错误（如数据库连接失败），也要清除Cookie并返回成功
    // 因为登出操作应该是幂等的，客户端只关心是否清理了本地状态
    return createSuccessResponse()
  }
})
