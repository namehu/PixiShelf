import { NextRequest, NextResponse } from 'next/server'
import { sessionManager } from '@/lib/session'
import { ROUTES } from '@/lib/constants'

// ============================================================================
// Next.js 认证中间件
// ============================================================================

/**
 * 需要认证的路径模式
 */
const PROTECTED_PATHS = []

/**
 * 公开访问的路径模式（不需要认证）
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/']

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
 * 检查路径是否需要认证
 */
function requiresAuth(pathname: string): boolean {
  return !matchesPattern(pathname, PUBLIC_PATHS)
}

/**
 * 中间件主函数
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // 检查是否需要认证
  if (!requiresAuth(pathname)) {
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

    // 如果会话被刷新，更新Cookie
    if (refreshedSession.token !== token) {
      const response = NextResponse.next()
      const cookieOptions = sessionManager.getCookieOptionsForRequest(request)

      response.cookies.set('auth-token', refreshedSession.token, {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        maxAge: cookieOptions.maxAge,
        path: cookieOptions.path
      })

      return response
    }

    // 认证成功，继续处理请求
    return NextResponse.next()
  } catch (error) {
    console.error('中间件认证错误:', error)
    return handleUnauthenticated(request, pathname)
  }
}

/**
 * 处理未认证的请求
 */
function handleUnauthenticated(request: NextRequest, pathname: string): NextResponse {
  // 对于API请求，返回401状态
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ success: false, error: '未授权访问' }, { status: 401 })
  }

  // 对于页面请求，重定向到登录页
  const loginUrl = new URL(ROUTES.LOGIN, request.url)

  // 保存原始请求的URL，登录后可以重定向回来
  if (pathname !== ROUTES.LOGIN) {
    loginUrl.searchParams.set('redirect', pathname)
  }

  const response = NextResponse.redirect(loginUrl)
  // 清除可能存在的无效认证Cookie
  response.cookies.delete('auth-token')

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
