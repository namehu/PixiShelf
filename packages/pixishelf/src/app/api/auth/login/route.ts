import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/lib/auth'
import { sessionManager } from '@/lib/session'
import { validateLoginForm } from '@/lib/validators'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '@/lib/constants'
import type { LoginRequest, LoginResponse } from '@/types/api'

// ============================================================================
// 登录 API 路由
// ============================================================================

/**
 * 处理用户登录请求
 * POST /api/auth/login
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 解析请求体
    let body: LoginRequest
    try {
      body = await request.json()
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: '请求数据格式错误',
        } satisfies LoginResponse,
        { status: 400 }
      )
    }

    // 验证输入数据
    const validation = validateLoginForm(body)
    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: Object.values(validation.errors)[0] || '输入数据无效',
        } satisfies LoginResponse,
        { status: 400 }
      )
    }

    const { username, password } = body

    // 验证用户凭据
    const user = await authService.validateCredentials(username, password)
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_MESSAGES.LOGIN_FAILED,
        } satisfies LoginResponse,
        { status: 401 }
      )
    }

    // 创建会话
    const session = await sessionManager.createSession(user)

    // 创建响应
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          username: user.username,
        },
      } satisfies LoginResponse,
      { status: 200 }
    )

    // 设置认证Cookie
    const cookieOptions = sessionManager.getCookieOptionsForRequest(request)
    response.cookies.set('auth-token', session.token, {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      maxAge: cookieOptions.maxAge,
      path: cookieOptions.path,
    })

    return response
  } catch (error) {
    console.error('登录API错误:', error)

    // 处理认证服务错误
    if (error instanceof Error && error.message.includes('凭据验证失败')) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_MESSAGES.LOGIN_FAILED,
        } satisfies LoginResponse,
        { status: 401 }
      )
    }

    // 处理数据库连接错误
    if (error instanceof Error && error.message.includes('数据库')) {
      return NextResponse.json(
        {
          success: false,
          error: '数据库连接失败，请稍后重试',
        } satisfies LoginResponse,
        { status: 503 }
      )
    }

    // 默认服务器错误
    return NextResponse.json(
      {
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR,
      } satisfies LoginResponse,
      { status: 500 }
    )
  }
}

/**
 * 处理不支持的HTTP方法
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: '不支持的请求方法',
    },
    { status: 405 }
  )
}

export async function PUT(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: '不支持的请求方法',
    },
    { status: 405 }
  )
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: '不支持的请求方法',
    },
    { status: 405 }
  )
}

export async function PATCH(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: '不支持的请求方法',
    },
    { status: 405 }
  )
}