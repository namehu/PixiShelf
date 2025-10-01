import { NextRequest, NextResponse } from 'next/server'
import { tagService } from '@/services/tagService'

/**
 * GET /api/tags/[id]
 * 获取单个标签详情
 *
 * 路径参数:
 * - id: 标签ID
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = await params
    const tagId = parseInt(id)

    if (isNaN(tagId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid tag ID'
        },
        { status: 400 }
      )
    }

    // 查询标签信息
    const tag = await tagService.getById(tagId)

    if (!tag) {
      return NextResponse.json({ success: false, error: 'Tag not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: tag })
  } catch (error) {
    console.error('获取标签详情失败:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
