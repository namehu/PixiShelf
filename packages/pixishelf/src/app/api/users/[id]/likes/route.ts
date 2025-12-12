import { NextRequest, NextResponse } from 'next/server'
import { likeService } from '@/services/like-service'
import { z } from 'zod'

/**
 * 用户点赞历史API接口
 * GET /api/users/:id/likes - 获取用户点赞的作品列表
 */

// 查询参数验证schema
const getUserLikesSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 20)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 0))
})

/**
 * 获取用户点赞的作品列表
 * GET /api/users/:id/likes?limit=20&offset=0
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params
    const userId = Number(id)

    // 验证用户ID
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: 'Invalid user ID', code: 'INVALID_USER_ID' }, { status: 400 })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const queryValidation = getUserLikesSchema.safeParse({
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset')
    })

    if (!queryValidation.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: queryValidation.error.message
        },
        { status: 400 }
      )
    }

    const { limit, offset } = queryValidation.data

    // 验证分页参数
    if (limit < 1 || limit > 100) {
      return NextResponse.json({ error: 'Limit must be between 1 and 100', code: 'INVALID_LIMIT' }, { status: 400 })
    }

    if (offset < 0) {
      return NextResponse.json({ error: 'Offset must be non-negative', code: 'INVALID_OFFSET' }, { status: 400 })
    }

    try {
      // 调用服务层获取用户点赞的作品列表
      const likedArtworkIds = await likeService.getUserLikedArtworks(userId, {
        pageSize: limit,
        page: offset
      })

      return NextResponse.json({
        success: true,
        data: {
          artworkIds: likedArtworkIds,
          pagination: {
            limit,
            offset,
            count: likedArtworkIds.total,
            hasMore: likedArtworkIds.total > limit * offset
          }
        },
        message: `成功获取用户 ${userId} 的点赞作品列表`
      })
    } catch (serviceError) {
      console.error('Get user likes service error:', serviceError)

      if (serviceError instanceof Error && serviceError.message.includes('不存在')) {
        return NextResponse.json({ error: serviceError.message, code: 'NOT_FOUND' }, { status: 404 })
      }

      return NextResponse.json({ error: '获取用户点赞列表失败', code: 'GET_USER_LIKES_FAILED' }, { status: 500 })
    }
  } catch (error) {
    console.error('Get user likes API error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
