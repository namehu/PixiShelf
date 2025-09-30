import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

// 处理搜索查询，转义特殊字符并构建 tsquery
function buildTsQuery(query: string): string {
  // 移除特殊字符，只保留字母、数字、空格和中文字符
  const cleanQuery = query.replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
  
  // 分割成单词并过滤空字符串
  const words = cleanQuery.split(/\s+/).filter(word => word.length > 0)
  
  if (words.length === 0) {
    return ''
  }
  
  // 为每个词添加前缀匹配（:*）以支持部分匹配
  const tsqueryParts = words.map(word => `${word}:*`).join(' & ')
  
  return tsqueryParts
}

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
  sort: z.enum(['name', 'artworkCount', 'createdAt', 'relevance']).optional().default('relevance'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
})

/**
 * GET /api/tags/search
 * 标签搜索API
 *
 * 查询参数:
 * - q: 搜索关键词 (必需)
 * - page: 页码，默认1
 * - limit: 每页数量，默认20，最大100
 * - sort: 排序字段 (name|artworkCount|createdAt|relevance)，默认relevance
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

    // 构建 tsquery
    const tsquery = buildTsQuery(q)
    
    let tags: any[] = []
    let totalCount = 0

    if (tsquery) {
      // 使用全文搜索
      try {
        // 构建排序条件
        let orderByClause = ''
        if (sort === 'relevance') {
          orderByClause = 'ORDER BY ts_rank(search_vector, to_tsquery(\'simple\', $1)) DESC'
        } else {
          const direction = order.toUpperCase()
          switch (sort) {
            case 'name':
              orderByClause = `ORDER BY name ${direction}`
              break
            case 'artworkCount':
              orderByClause = `ORDER BY "artworkCount" ${direction}`
              break
            case 'createdAt':
              orderByClause = `ORDER BY "createdAt" ${direction}`
              break
            default:
              orderByClause = 'ORDER BY ts_rank(search_vector, to_tsquery(\'simple\', $1)) DESC'
          }
        }

        // 执行全文搜索查询
        const searchQuery = `
          SELECT 
            id, 
            name, 
            name_zh, 
            description, 
            "artworkCount", 
            "createdAt", 
            "updatedAt",
            ts_rank(search_vector, to_tsquery('simple', $1)) as relevance_score
          FROM "Tag" 
          WHERE search_vector @@ to_tsquery('simple', $1)
          ${orderByClause}
          LIMIT $2 OFFSET $3
        `

        const countQuery = `
          SELECT COUNT(*) as count
          FROM "Tag" 
          WHERE search_vector @@ to_tsquery('simple', $1)
        `

        const [searchResults, countResults] = await Promise.all([
          prisma.$queryRaw<any[]>(Prisma.sql([searchQuery], tsquery, actualLimit, offset)),
          prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql([countQuery], tsquery))
        ])

        tags = searchResults.map(tag => ({
          id: tag.id,
          name: tag.name,
          name_zh: tag.name_zh,
          description: tag.description,
          artworkCount: tag.artworkCount,
          createdAt: tag.createdAt,
          updatedAt: tag.updatedAt,
          relevanceScore: parseFloat(tag.relevance_score || '0')
        }))

        totalCount = Number(countResults[0]?.count || 0)
      } catch (fullTextError) {
        console.warn('全文搜索失败，回退到传统搜索:', fullTextError)
        
        // 回退到传统搜索
        const searchCondition = {
          OR: [
            {
              name: {
                contains: q,
                mode: 'insensitive' as const
              }
            },
            {
              name_zh: {
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

        // 构建排序条件（排除 relevance）
        let orderBy: any = { artworkCount: 'desc' }
        if (sort !== 'relevance') {
          orderBy = { [sort]: order }
        }

        const [fallbackTags, fallbackCount] = await Promise.all([
          prisma.tag.findMany({
            where: searchCondition,
            orderBy,
            skip: offset,
            take: actualLimit,
            select: {
              id: true,
              name: true,
              name_zh: true,
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

        tags = fallbackTags
        totalCount = fallbackCount
      }
    } else {
      // 空查询，返回热门标签
      const [popularTags, popularCount] = await Promise.all([
        prisma.tag.findMany({
          orderBy: { artworkCount: 'desc' },
          skip: offset,
          take: actualLimit,
          select: {
            id: true,
            name: true,
            name_zh: true,
            description: true,
            artworkCount: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        prisma.tag.count()
      ])

      tags = popularTags
      totalCount = popularCount
    }

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
