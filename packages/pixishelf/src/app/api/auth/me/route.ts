import { NextRequest, NextResponse } from 'next/server'
import { sessionManager } from '@/lib/session'
import { ERROR_MESSAGES } from '@/lib/constants'
import type { MeResponse } from '@/types/auth'

// ============================================================================
// 获取当前用户信息 API 路由
// ============================================================================

/**
 * 获取当前登录用户信息
 * GET /api/auth/me
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // 从请求中提取认证令牌
    const token = sessionManager.extractTokenFromRequest(request)
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: '未提供认证令牌',
        } satisfies MeResponse,
        { status: 401 }
      )
    }

    // 验证会话
    const session = await sessionManager.getSession(token)
    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: '会话已过期或无效',
        } satisfies MeResponse,
        { status: 401 }
      )
    }

    // 检查会话是否需要刷新
    const refreshedSession = await sessionManager.refreshSession(token)
    if (!refreshedSession) {
      return NextResponse.json(
        {
          success: false,
          error: '会话刷新失败',
        } satisfies MeResponse,
        { status: 401 }
      )
    }

    // 返回用户信息
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: refreshedSession.userId,
          username: refreshedSession.username,
        },
      } satisfies MeResponse,
      { status: 200 }
    )

    return response
  } catch (error) {
    console.error('获取用户信息API错误:', error)

    // 处理会话相关错误
    if (error instanceof Error && error.message.includes('会话')) {
      return NextResponse.json(
        {
          success: false,
          error: '会话验证失败',
        } satisfies MeResponse,
        { status: 401 }
      )
    }

    // 处理数据库连接错误
    if (error instanceof Error && error.message.includes('数据库')) {
      return NextResponse.json(
        {
          success: false,
          error: '数据库连接失败，请稍后重试',
        } satisfies MeResponse,
        { status: 503 }
      )
    }

    // 默认服务器错误
    return NextResponse.json(
      {
        success: false,
        error: ERROR_MESSAGES.SERVER_ERROR,
      } satisfies MeResponse,
      { status: 500 }
    )
  }
}

/**
 * 处理不支持的HTTP方法
 */
export async function POST(): Promise<NextResponse> {
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