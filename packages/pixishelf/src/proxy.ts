import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { ROUTES } from '@/lib/constants'
import logger from './lib/logger'
import { responseUnauthorized } from './lib/api-handler'
import { headers } from 'next/headers'
import { rateLimiter } from './lib/rate-limit'

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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // 1. 全局限流 (Global Rate Limit)
  // 限制每个 IP 每分钟 600 次请求 (10 requests/sec average)
  // 这是一个宽松的限制，主要用于防止 DDoS 攻击
  // 静态资源已被 config.matcher 排除
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!rateLimiter.check(600, `mw:${ip}`)) {
    return new NextResponse('Too Many Requests', { status: 429 })
  }

  // 1. 特殊处理：如果用户访问登录页且已持有有效令牌，重定向到仪表盘
  if (pathname === ROUTES.LOGIN) {
    try {
      const session = await auth.api.getSession({
        headers: await headers()
      })

      if (session) {
        const dashboardUrl = new URL(ROUTES.DASHBOARD, request.url)
        return NextResponse.redirect(dashboardUrl)
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
    const session = await auth.api.getSession({
      headers: await headers()
    })

    if (!session) {
      return handleUnauthenticated(request, pathname)
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set(
      'x-user-session',
      JSON.stringify({
        userId: session.user.id,
        username: session.user.name,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image
      })
    )

    return NextResponse.next({
      request: {
        headers: requestHeaders
      }
    })
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
  return response
}

/**
 * 中间件配置
 */
export const config = {
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
