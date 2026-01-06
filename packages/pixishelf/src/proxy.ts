import { NextRequest, NextResponse } from 'next/server'
import { sessionManager } from '@/lib/session'
import { COOKIE_AUTH_TOKEN, ROUTES } from '@/lib/constants'
import logger from './lib/logger'
import { responseUnauthorized } from './lib/api-handler'
import type { Session } from '@/types/auth'

// ============================================================================
// Next.js 认证中间件
// ============================================================================

/**
 * 公开访问的路径模式（不需要认证）
 */
const PUBLIC_PATHS = ['/', '/login']

/**
 * 检查路径是否匹配模式
 */
function matchesPattern(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return pathname.startsWith(pattern.slice(0, -1))
    }
    return pathname === pattern || pathname.startsWith(pattern + '/')
  })
}

/**
 * 如果会话令牌已刷新，更新响应中的 Cookie
 */
// oxlint-disable-next-line max-params
function updateAuthCookie(request: NextRequest, response: NextResponse, session: Session, oldToken: string) {
  if (session.token !== oldToken) {
    const cookieOptions = sessionManager.getCookieOptions(request.headers)
    response.cookies.set(COOKIE_AUTH_TOKEN, session.token, {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      maxAge: cookieOptions.maxAge,
      path: cookieOptions.path
    })
  }
}

/**
 * 中间件主函数
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // 1. 特殊处理：如果用户访问登录页且已持有有效令牌，重定向到仪表盘
  if (pathname === ROUTES.LOGIN) {
    try {
      const token = sessionManager.extractTokenFromRequest(request)
      if (token) {
        const session = await sessionManager.validateAndRefreshSession(token)
        if (session) {
          const dashboardUrl = new URL(ROUTES.DASHBOARD, request.url)
          const response = NextResponse.redirect(dashboardUrl)

          // 如果会话被刷新，更新Cookie
          updateAuthCookie(request, response, session, token)

          return response
        }
      }
    } catch (error) {
      // 验证失败，忽略错误，继续执行允许访问登录页
      logger.error('登录页重定向检查失败:', error)
    }
  }

  // 检查是否需要认证
  if (matchesPattern(pathname, PUBLIC_PATHS)) {
    return NextResponse.next()
  }

  try {
    // 提取认证令牌
    const token = sessionManager.extractTokenFromRequest(request)

    if (!token) {
      return handleUnauthenticated(request, pathname)
    }

    // 检查会话是否需要刷新
    const refreshedSession = await sessionManager.validateAndRefreshSession(token)

    if (!refreshedSession) {
      return handleUnauthenticated(request, pathname)
    }

    // 1. 克隆现有的请求头，因为原始的 request.headers 是只读的
    const requestHeaders = new Headers(request.headers)
    // 2. 将用户信息（或整个会话）序列化后添加到请求头中
    // 假设 refreshedSession 包含一个 user 对象 { id: '...', name: '...' }
    // 注意：Header 的值必须是字符串
    requestHeaders.set(
      'x-user-session',
      JSON.stringify({
        ...refreshedSession,
        userId: Number(refreshedSession.userId)
      })
    )

    // 3. 创建一个新的响应，并用我们修改过的请求头来继续请求链
    // 这样，后续的 API 路由接收到的 request 对象就会包含这个新的 header
    const response = NextResponse.next({
      request: {
        headers: requestHeaders
      }
    })

    // 如果会话被刷新，更新Cookie
    updateAuthCookie(request, response, refreshedSession, token)

    // 认证成功，继续处理请求
    return response
  } catch (error) {
    logger.error('中间件认证错误:', error)
    return handleUnauthenticated(request, pathname)
  }
}

/**
 * 处理未认证的请求
 */
function handleUnauthenticated(request: NextRequest, pathname: string): NextResponse {
  // 对于API请求，返回401状态
  if (pathname.startsWith('/api/')) {
    return responseUnauthorized()
  }

  // 对于页面请求，重定向到登录页
  const loginUrl = new URL(ROUTES.LOGIN, request.url)

  // 保存原始请求的URL，登录后可以重定向回来
  if (pathname !== ROUTES.LOGIN) {
    loginUrl.searchParams.set('redirect', pathname)
  }

  const response = NextResponse.redirect(loginUrl)
  // 清除可能存在的无效认证Cookie
  response.cookies.delete(COOKIE_AUTH_TOKEN)

  return response
}

/**
 * 中间件配置
 */
export const config = {
  runtime: 'nodejs',
  matcher: [
    /*
     * 匹配所有请求路径，除了：
     * - _next/static (static files)
     * - next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)'
  ]
}
