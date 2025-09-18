import { NextRequest, NextResponse } from 'next/server'
import { sessionManager } from '@/lib/session'
import { ROUTES } from '@/lib/constants'

// ============================================================================
// Next.js 认证中间件
// ============================================================================

/**
 * 需要认证的路径模式
 */
const PROTECTED_PATHS = [
  '/dashboard',
  '/profile',
  '/settings',
  '/admin',
  '/api/auth/me'
  // 可以添加更多需要保护的路径
]

/**
 * 公开访问的路径模式（不需要认证）
 */
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/',
  '/about',
  '/contact',
  // 静态资源
  '/_next',
  '/favicon.ico',
  '/images',
  '/icons'
]

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
  // 首先检查是否是公开路径
  if (matchesPattern(pathname, PUBLIC_PATHS)) {
    return false
  }

  // 然后检查是否是受保护路径
  if (matchesPattern(pathname, PROTECTED_PATHS)) {
    return true
  }

  // 默认情况下，API路由需要认证（除了已明确标记为公开的）
  if (pathname.startsWith('/api/')) {
    return true
  }

  // 其他路径默认不需要认证
  return false
}

/**
 * 中间件主函数
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // 跳过静态资源和Next.js内部路径
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/_next/') ||
    pathname.includes('.') // 包含文件扩展名的静态资源
  ) {
    return NextResponse.next()
  }

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

    // 验证会话
    const session = await sessionManager.getSession(token)

    if (!session) {
      return handleUnauthenticated(request, pathname)
    }

    // 检查会话是否需要刷新
    const refreshedSession = await sessionManager.refreshSession(token)

    if (!refreshedSession) {
      return handleUnauthenticated(request, pathname)
    }

    // 如果会话被刷新，更新Cookie
    if (refreshedSession.token !== token) {
      const response = NextResponse.next()
      const cookieOptions = sessionManager.getCookieOptions()

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
    return NextResponse.json(
      {
        success: false,
        error: '未授权访问'
      },
      { status: 401 }
    )
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
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)'
  ]
}
