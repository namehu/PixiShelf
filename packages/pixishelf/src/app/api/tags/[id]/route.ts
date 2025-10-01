import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/tags/[id]
 * 获取单个标签详情
 *
 * 路径参数:
 * - id: 标签ID
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
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
    const tag = await prisma.tag.findUnique({
      where: {
        id: tagId
      },
      select: {
        id: true,
        name: true,
        name_zh: true,
        name_en: true,
        description: true,
        artworkCount: true,
        createdAt: true,
        updatedAt: true
      }
    })

    if (!tag) {
      return NextResponse.json(
        {
          success: false,
          error: 'Tag not found'
        },
        { status: 404 }
      )
    }

    // 转换日期格式
    const formattedTag = {
      ...tag,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString()
    }

    return NextResponse.json({
      success: true,
      data: formattedTag
    })
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
