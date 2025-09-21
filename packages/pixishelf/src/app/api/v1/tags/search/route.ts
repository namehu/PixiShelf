import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// 搜索参数验证schema
const searchParamsSchema = z.object({
  q: z.string().min(1, '搜索关键词不能为空').max(100, '搜索关键词过长'),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 20)),
  sort: z.enum(['name', 'artworkCount', 'createdAt']).optional().default('artworkCount'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
})

/**
 * GET /api/v1/tags/search
 * 标签搜索API
 *
 * 查询参数:
 * - q: 搜索关键词 (必需)
 * - page: 页码，默认1
 * - limit: 每页数量，默认20，最大100
 * - sort: 排序字段 (name|artworkCount|createdAt)，默认artworkCount
 * - order: 排序方向 (asc|desc)，默认desc
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // 验证查询参数
    const validationResult = searchParamsSchema.safeParse({
      q: searchParams.get('q'),
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      sort: searchParams.get('sort'),
      order: searchParams.get('order')
    })

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid parameters',
          details: validationResult.error.issues
        },
        { status: 400 }
      )
    }

    const { q, page, limit, sort, order } = validationResult.data

    // 限制每页最大数量
    const actualLimit = Math.min(limit, 100)
    const offset = (page - 1) * actualLimit

    // 构建搜索条件
    const searchCondition = {
      OR: [
        {
          name: {
            contains: q,
            mode: 'insensitive' as const
          }
        },
        {
          description: {
            contains: q,
            mode: 'insensitive' as const
          }
        }
      ]
    }

    // 构建排序条件
    const orderBy = {
      [sort]: order
    }

    // 执行搜索查询
    const [tags, totalCount] = await Promise.all([
      prisma.tag.findMany({
        where: searchCondition,
        orderBy,
        skip: offset,
        take: actualLimit,
        select: {
          id: true,
          name: true,
          description: true,
          artworkCount: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.tag.count({
        where: searchCondition
      })
    ])

    // 计算分页信息
    const totalPages = Math.ceil(totalCount / actualLimit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: {
        tags,
        pagination: {
          page,
          limit: actualLimit,
          totalCount,
          totalPages,
          hasNextPage,
          hasPrevPage
        },
        query: {
          keyword: q,
          sort,
          order
        }
      }
    })
  } catch (error) {
    console.error('标签搜索API错误:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: '搜索标签时发生错误'
      },
      { status: 500 }
    )
  }
}
