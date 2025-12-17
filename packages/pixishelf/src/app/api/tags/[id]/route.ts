import { NextRequest, NextResponse } from 'next/server'
import { getById } from '@/services/tag-service'
import { z } from 'zod'
import logger from '@/lib/logger'

// 定义zod 验证id参数
const RouteParamsSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer')
})
/**
 * GET /api/tags/[id]
 * 获取单个标签详情
 *
 * 路径参数:
 * - id: 标签ID
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = await RouteParamsSchema.parseAsync(params)

    if (!id) {
      return NextResponse.json({ success: false, error: 'Invalid tag ID' }, { status: 400 })
    }

    // 查询标签信息
    const tag = await getById(id)

    if (!tag) {
      return NextResponse.json({ success: false, error: 'Tag not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: tag })
  } catch (error) {
    logger.error('获取标签详情失败:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
