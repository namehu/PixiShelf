import { z } from 'zod'
import { router, authProcedure } from '@/server/trpc'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

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

export const tagRouter = router({
  /**
   * 标签列表/搜索/随机获取
   */
  list: authProcedure
    .input(
      z.object({
        cursor: z.number().nullish(), // tRPC infinite query standard cursor
        pageSize: z.number().min(1).max(100).default(100),
        query: z.string().optional(),
        mode: z.enum(['popular', 'random']).default('popular'),
        // 随机模式专用参数
        minCount: z.number().min(0).default(0),
        excludeEmpty: z.boolean().default(false)
      })
    )
    .query(async ({ input }) => {
      const { cursor, pageSize, query, mode, minCount, excludeEmpty } = input
      const page = cursor || 1

      // --------------------------------------------------------------------------
      // 场景 1: 搜索模式 (有 query)

      // --------------------------------------------------------------------------
      // 场景 1: 搜索模式 (有 query)
      // --------------------------------------------------------------------------
      if (query) {
        const offset = (page - 1) * pageSize
        const tsquery = buildTsQuery(query)

        let tags: any[] = []
        let totalCount = 0

        if (tsquery) {
          // Tie-breaker: 始终在排序末尾添加 id ASC，防止分页重复
          const orderByClause = "ORDER BY ts_rank(search_vector, to_tsquery('simple', $1)) DESC, id ASC"

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

        const totalPages = Math.ceil(totalCount / pageSize)

        return {
          items: tags,
          pagination: {
            page,
            pageSize,
            total: totalCount,
            totalPages,
            hasNextPage: page < totalPages
          },
          nextCursor: page < totalPages ? page + 1 : undefined
        }
      }

      // --------------------------------------------------------------------------
      // 场景 2: 热门模式 (无 query, mode='popular')
      // --------------------------------------------------------------------------
      if (mode === 'popular') {
        const offset = (page - 1) * pageSize

        // 空查询无相关性，默认按 artworkCount 降序
        const orderBy: Prisma.TagOrderByWithRelationInput[] = [{ artworkCount: 'desc' }, { id: 'asc' }]

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

        const totalPages = Math.ceil(popularCount / pageSize)

        return {
          items: popularTags,
          pagination: {
            page,
            pageSize,
            total: popularCount,
            totalPages,
            hasNextPage: page < totalPages
          },
          nextCursor: page < totalPages ? page + 1 : undefined
        }
      }

      // --------------------------------------------------------------------------
      // 场景 3: 随机模式 (无 query, mode='random')
      // --------------------------------------------------------------------------
      // 1. 构建查询条件
      const whereCondition: any = {}
      if (excludeEmpty || minCount > 0) {
        whereCondition.artworkCount = {
          gte: Math.max(minCount, excludeEmpty ? 1 : 0)
        }
      }

      // 2. 获取符合条件的标签总数
      const totalCount = await prisma.tag.count({
        where: whereCondition
      })

      if (totalCount === 0) {
        return {
          items: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
            hasNextPage: false
          },
          nextCursor: undefined
        }
      }

      // 3. 生成不重复的随机偏移量
      const actualLimit = Math.min(pageSize, totalCount)
      const randomOffsets = new Set<number>()

      while (randomOffsets.size < actualLimit) {
        const randomOffset = Math.floor(Math.random() * totalCount)
        randomOffsets.add(randomOffset)
      }

      // 4. 并行执行查询
      const randomTagsPromises = Array.from(randomOffsets).map((offset) =>
        prisma.tag.findMany({
          where: whereCondition,
          skip: offset,
          take: 1,
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
      )

      const randomTagsResults = await Promise.all(randomTagsPromises)
      let randomTags = randomTagsResults.filter((result) => result.length > 0).map((result) => result[0])

      // 5. 兜底补全
      if (randomTags.length < actualLimit) {
        const existingIds = randomTags.map((tag) => tag!.id)
        const needed = actualLimit - randomTags.length

        const additionalTags = await prisma.tag.findMany({
          where: {
            ...whereCondition,
            id: { notIn: existingIds }
          },
          take: needed,
          orderBy: { createdAt: 'desc' },
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

        randomTags = [...randomTags, ...additionalTags]
      }

      // 6. 再次打乱
      for (let i = randomTags.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[randomTags[i], randomTags[j]] = [randomTags[j], randomTags[i]]
      }

      return {
        items: randomTags,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          hasNextPage: totalCount > 0
        },
        // 随机模式下只要有数据，就允许请求下一页（实际上是新的一组随机数据）
        nextCursor: randomTags.length > 0 ? page + 1 : undefined
      }
    })
})
