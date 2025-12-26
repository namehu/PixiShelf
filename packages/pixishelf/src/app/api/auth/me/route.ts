import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-handler'
import { sessionManager } from '@/lib/session'
import { ApiError } from '@/lib/errors'

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
  const response = NextResponse.json(
    {
      success: true,
      errorCode: 0,
      user: {
        id: refreshedSession.userId,
        username: refreshedSession.username
      }
    },
    { status: 200 }
  )

  // 如果会话被刷新，更新Cookie
  if (refreshedSession.token !== token) {
    const cookieOptions = sessionManager.getCookieOptionsForRequest(request)
    response.cookies.set('auth-token', refreshedSession.token, {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      maxAge: cookieOptions.maxAge,
      path: cookieOptions.path
    })
  }

  return response
})
