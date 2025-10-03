import { NextRequest, NextResponse } from 'next/server'
import { likeService } from '@/services'
import { z } from 'zod'

/**
 * 批量获取点赞状态API接口
 * POST /api/artworks/like/batch
 */

// 请求体验证schema
const batchLikeStatusSchema = z.object({
  userId: z.number().positive().optional(),
  artworkIds: z.array(z.number().positive()).min(1, '至少需要一个作品ID').max(100, '最多支持100个作品ID')
})

/**
 * 批量获取点赞状态
 * POST /api/artworks/like/batch
 * Body: { userId?: number, artworkIds: number[] }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 解析请求体
    let body
    try {
      body = await request.json()
    } catch (error) {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, { status: 400 })
    }

    // 验证请求体
    const validation = batchLikeStatusSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: validation.error.message
        },
        { status: 400 }
      )
    }

    const { userId, artworkIds } = validation.data

    try {
      // 调用服务层获取批量点赞状态
      const batchStatus = await likeService.getBatchLikeStatus(userId || null, artworkIds)

      return NextResponse.json({
        success: true,
        data: batchStatus,
        message: `成功获取 ${artworkIds.length} 个作品的点赞状态`
      })
    } catch (serviceError) {
      console.error('Batch like status service error:', serviceError)

      return NextResponse.json({ error: '获取批量点赞状态失败', code: 'BATCH_LIKE_STATUS_FAILED' }, { status: 500 })
    }
  } catch (error) {
    console.error('Batch like status API error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
