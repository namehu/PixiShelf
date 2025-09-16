import { NextRequest, NextResponse } from 'next/server'
import { sessionManager } from '@/lib/session'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '@/lib/constants'
import type { LogoutResponse } from '@/types/auth'

// ============================================================================
// 登出 API 路由
// ============================================================================

/**
 * 处理用户登出请求
 * POST /api/auth/logout
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 从请求中提取认证令牌
    const token = sessionManager.extractTokenFromRequest(request)
    
    // 如果没有令牌，直接返回成功（已经是登出状态）
    if (!token) {
      const response = NextResponse.json(
        {
          success: true,
          message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
        } satisfies LogoutResponse,
        { status: 200 }
      )

      // 清除Cookie
      response.cookies.delete('auth-token')
      return response
    }

    // 销毁会话
    await sessionManager.destroySession(token)

    // 创建响应
    const response = NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      } satisfies LogoutResponse,
      { status: 200 }
    )

    // 清除认证Cookie
    response.cookies.delete('auth-token')

    return response
  } catch (error) {
    console.error('登出API错误:', error)

    // 即使出现错误，也要清除Cookie并返回成功
    // 因为登出操作应该是幂等的
    const response = NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      } satisfies LogoutResponse,
      { status: 200 }
    )

    // 清除Cookie
    response.cookies.delete('auth-token')
    return response
  }
}

/**
 * 处理GET请求的登出（支持通过链接登出）
 * GET /api/auth/logout
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // 从请求中提取认证令牌
    const token = sessionManager.extractTokenFromRequest(request)
    
    // 如果有令牌，销毁会话
    if (token) {
      await sessionManager.destroySession(token)
    }

    // 创建响应
    const response = NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      } satisfies LogoutResponse,
      { status: 200 }
    )

    // 清除认证Cookie
    response.cookies.delete('auth-token')

    return response
  } catch (error) {
    console.error('登出API错误:', error)

    // 即使出现错误，也要清除Cookie并返回成功
    const response = NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.LOGOUT_SUCCESS,
      } satisfies LogoutResponse,
      { status: 200 }
    )

    // 清除Cookie
    response.cookies.delete('auth-token')
    return response
  }
}

/**
 * 处理不支持的HTTP方法
 */
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