import { NextRequest, NextResponse } from 'next/server'
import { likeService } from '@/services'
import { sessionManager } from '@/lib/session'

/**
 * 切换点赞状态
 * POST /api/artworks/:id/like
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params
    const artworkId = Number(id)

    // 验证作品ID
    if (!Number.isFinite(artworkId) || artworkId <= 0) {
      return NextResponse.json({ error: 'Invalid artwork ID', code: 'INVALID_ARTWORK_ID' }, { status: 400 })
    }

    // 从请求头中获取由中间件注入的用户信息
    const user = sessionManager.extractUserSessionFromRequest(request)

    try {
      // 调用服务层切换点赞状态
      const result = await likeService.toggleLike(user.userId, artworkId)

      return NextResponse.json({
        success: true,
        data: result,
        message: result.liked ? '点赞成功' : '取消点赞成功'
      })
    } catch (serviceError) {
      console.error('Like service error:', serviceError)

      if (serviceError instanceof Error) {
        // 处理业务逻辑错误
        if (serviceError.message.includes('不存在')) {
          return NextResponse.json({ error: serviceError.message, code: 'NOT_FOUND' }, { status: 404 })
        }

        if (serviceError.message.includes('不能为空')) {
          return NextResponse.json({ error: serviceError.message, code: 'INVALID_PARAMS' }, { status: 400 })
        }
      }

      // 其他服务层错误
      return NextResponse.json({ error: '点赞操作失败', code: 'LIKE_OPERATION_FAILED' }, { status: 500 })
    }
  } catch (error) {
    console.error('Toggle like API error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

/**
 * 获取点赞状态
 * GET /api/artworks/:id/like?userId=123
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params
    const artworkId = Number(id)

    // 验证作品ID
    if (!Number.isFinite(artworkId) || artworkId <= 0) {
      return NextResponse.json({ error: 'Invalid artwork ID', code: 'INVALID_ARTWORK_ID' }, { status: 400 })
    }

    // 获取查询参数
    const { userId } = sessionManager.extractUserSessionFromRequest(request)

    try {
      // 调用服务层获取点赞状态
      const status = await likeService.getLikeStatus(userId, artworkId)

      return NextResponse.json({
        success: true,
        data: status
      })
    } catch (serviceError) {
      console.error('Get like status service error:', serviceError)

      if (serviceError instanceof Error && serviceError.message.includes('不存在')) {
        return NextResponse.json({ error: serviceError.message, code: 'NOT_FOUND' }, { status: 404 })
      }

      return NextResponse.json({ error: '获取点赞状态失败', code: 'GET_LIKE_STATUS_FAILED' }, { status: 500 })
    }
  } catch (error) {
    console.error('Get like status API error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
