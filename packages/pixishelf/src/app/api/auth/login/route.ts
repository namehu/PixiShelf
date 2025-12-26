import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-handler'
import { authService } from '@/lib/auth'
import { sessionManager } from '@/lib/session'
import { ERROR_MESSAGES } from '@/lib/constants'
import { ApiError } from '@/lib/errors'
import { LoginGetSchema } from '@/schemas/api/auth'

// ============================================================================
// 登录 API 路由
// ============================================================================

/**
 * 处理用户登录请求
 * POST /api/auth/login
 */
export const POST = apiHandler(LoginGetSchema, async (request, data) => {
  const { username, password } = data

  // 验证用户凭据
  const user = await authService.validateCredentials(username, password)
  if (!user) {
    throw new ApiError(ERROR_MESSAGES.LOGIN_FAILED, 401)
  }

  // 创建会话
  const session = await sessionManager.createSession(user)

  const response = NextResponse.json(
    {
      success: true,
      errorCode: 0,
      data: {
        id: user.id
      }
    },
    { status: 200 }
  )

  // 设置认证Cookie
  const cookieOptions = sessionManager.getCookieOptionsForRequest(request)
  response.cookies.set('auth-token', session.token, {
    httpOnly: cookieOptions.httpOnly,
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    maxAge: cookieOptions.maxAge,
    path: cookieOptions.path
  })

  return response
})
