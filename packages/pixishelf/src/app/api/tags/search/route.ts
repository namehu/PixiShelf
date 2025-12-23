// route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { apiHandler } from '@/lib/api-handler'

/**
 * 构建全文搜索查询字符串 (tsquery)
 */
function buildTsQuery(query: string): string {
  const cleanQuery = query.replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
  const words = cleanQuery.split(/\s+/).filter((word) => word.length > 0)

  if (words.length === 0) return ''

  // 为每个词添加前缀匹配符 :*，并用 & 连接
  return words.map((word) => `${word}:*`).join(' & ')
}

// 定义请求参数 Schema
const searchParamsSchema = z.object({
  q: z.string().max(100, '搜索关键词过长').optional(),

  // 页码，默认 1
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().min(1, '页码必须大于0')),

  // 每页数量，默认 20，最大 100
  pageSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().min(1).max(100, '每页数量不能超过100')),

  sort: z.enum(['name', 'artworkCount', 'createdAt', 'relevance']).optional().default('relevance'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
})

export type TagSearchParams = z.infer<typeof searchParamsSchema>

// ============================================================================
// 业务处理 Handler
// ============================================================================

export const GET = apiHandler(searchParamsSchema, async (req: NextRequest, data: TagSearchParams) => {
  const { q, page, pageSize, sort, order } = data
  const offset = (page - 1) * pageSize

  // 构建 Postgres 全文搜索查询串
  const tsquery = q ? buildTsQuery(q) : ''

  let tags: any[] = []
  let totalCount = 0

  // --------------------------------------------------------------------------
  // 分支 A: 带有关键词的全文搜索 (使用 Raw SQL)
  // --------------------------------------------------------------------------
  if (tsquery) {
    let orderByClause = ''

    // 💡 Tie-breaker: 始终在排序末尾添加 id ASC，防止分页重复
    if (sort === 'relevance') {
      orderByClause = "ORDER BY ts_rank(search_vector, to_tsquery('simple', $1)) DESC, id ASC"
    } else {
      const direction = order.toUpperCase()
      orderByClause = `ORDER BY "${sort}" ${direction}, id ASC`
    }

    const searchQuery = `
      SELECT
        id,
        name,
        name_zh,
        name_en,
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
      prisma.$queryRaw<any[]>(Prisma.sql([searchQuery], tsquery, pageSize, offset)),
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql([countQuery], tsquery))
    ])

    tags = searchResults.map((tag) => ({
      ...tag,
      relevanceScore: parseFloat(tag.relevance_score || '0')
    }))

    totalCount = Number(countResults[0]?.count || 0)
  }

  // --------------------------------------------------------------------------
  // 分支 B: 空查询/列表模式 (使用 Prisma FindMany)
  // --------------------------------------------------------------------------
  else {
    let orderBy: Prisma.TagOrderByWithRelationInput[] = []

    // 💡 Tie-breaker: 同样在 Prisma 查询中加入 id 排序兜底
    if (sort === 'relevance') {
      // 空查询无相关性，默认按 artworkCount 降序
      orderBy = [{ artworkCount: 'desc' }, { id: 'asc' }]
    } else {
      orderBy = [{ [sort]: order }, { id: 'asc' }]
    }

    const [popularTags, popularCount] = await Promise.all([
      prisma.tag.findMany({
        orderBy,
        skip: offset,
        take: pageSize,
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
      }),
      prisma.tag.count()
    ])

    tags = popularTags
    totalCount = popularCount
  }

  // --------------------------------------------------------------------------
  // 响应构建 (Standardized Response)
  // --------------------------------------------------------------------------
  const totalPages = Math.ceil(totalCount / pageSize)

  // 统一返回结构
  return {
    data: tags, // 数据列表
    pagination: {
      page,
      pageSize: pageSize,
      total: totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    },
    // 可选：返回查询元数据，方便前端调试或回显
    meta: {
      keyword: q,
      sort,
      order
    }
  }
})
