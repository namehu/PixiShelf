import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-handler'

// ============================================================================
// 验证 Schema
// ============================================================================

const randomParamsSchema = z.object({
  pageSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 24))
    .pipe(z.number().min(1).max(100)),

  // 业务参数：最小作品数
  minCount: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .pipe(z.number().min(0)),

  // 业务参数：排除空标签
  excludeEmpty: z
    .string()
    .optional()
    .transform((val) => val === 'true'),

  // 兼容参数：页码 (虽然随机逻辑不依赖页码，但为了适配通用分页接口签名，允许接收)
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
})

type RandomTagParams = z.infer<typeof randomParamsSchema>

// ============================================================================
// 业务处理 Handler
// ============================================================================

const randomTagsHandler = async (req: NextRequest, data: RandomTagParams) => {
  const { pageSize, minCount, excludeEmpty, page } = data

  // 1. 构建查询条件
  const whereCondition: any = {}

  if (excludeEmpty || minCount > 0) {
    whereCondition.artworkCount = {
      gte: Math.max(minCount, excludeEmpty ? 1 : 0)
    }
  }

  // 2. 获取符合条件的标签总数
  // 这是一个轻量级查询，用于确定随机池的大小
  const totalCount = await prisma.tag.count({
    where: whereCondition
  })

  // 如果没有数据，直接返回空结构
  if (totalCount === 0) {
    return {
      data: [],
      pagination: {
        page,
        pageSize: pageSize,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      }
    }
  }

  // 3. 生成不重复的随机偏移量
  // 算法：在 [0, totalCount) 区间内随机取 N 个不重复的整数
  const actualLimit = Math.min(pageSize, totalCount)
  const randomOffsets = new Set<number>()

  // 优化：防止死循环（虽然有 min 限制，但为了代码健壮性）
  // 如果请求数量接近总数（例如请求 90 个，总数 100 个），直接取全部再打乱可能更快
  // 但为了逻辑一致性，这里保持偏移量采样，适用于 totalCount >> pageSize 的常见场景
  while (randomOffsets.size < actualLimit) {
    const randomOffset = Math.floor(Math.random() * totalCount)
    randomOffsets.add(randomOffset)
  }

  // 4. 并行执行查询 (Scatter-Gather 模式)
  // 使用 Promise.all 并发发起多个 findMany(skip: offset, take: 1)
  // 注意：Prisma 会自动管理连接池，这通常比 raw sql ORDER BY RANDOM() 在大数据量下更安全
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

  // 展平结果 (因为 findMany 返回数组)
  let randomTags = randomTagsResults.filter((result) => result.length > 0).map((result) => result[0])

  // 5. 兜底补全 (Fail-safe)
  // 极少数并发情况下（如刚计算完 count 就有数据被删），可能导致某个 offset 查不到数据
  // 如果获取的数量不足，进行一次补充查询
  if (randomTags.length < actualLimit) {
    const existingIds = randomTags.map((tag) => tag!.id)
    const needed = actualLimit - randomTags.length

    const additionalTags = await prisma.tag.findMany({
      where: {
        ...whereCondition,
        id: { notIn: existingIds }
      },
      take: needed,
      // 补充时按创建时间倒序（或者任意确定性顺序）
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

  // 6. 再次打乱 (Shuffle)
  // 因为偏移量是按 Set 迭代顺序或者 Promise 完成顺序回来的，虽然已经是随机的，
  // 但为了彻底消除任何潜在的顺序模式（如 Prisma 可能按 ID 聚类），再次洗牌
  for (let i = randomTags.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[randomTags[i], randomTags[j]] = [randomTags[j], randomTags[i]]
  }

  // --------------------------------------------------------------------------
  // 响应构建 (Standardized Response)
  // --------------------------------------------------------------------------
  // 随机模式下，分页元数据比较特殊：
  // - page: 只是为了兼容，每次都是新的一页
  // - hasNextPage: 只要数据库里有数据，就认为永远可以“再来一组”
  return {
    data: randomTags,
    pagination: {
      page: page, // 回显当前页码
      pageSize: pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: totalCount > 0,
      hasPrevPage: page > 1
    },
    // 额外的元数据，方便前端显示当前随机池的状态
    meta: {
      mode: 'random',
      poolSize: totalCount,
      minCount,
      excludeEmpty
    }
  }
}

// ============================================================================
// 导出 API Route
// ============================================================================

export const GET = apiHandler(randomParamsSchema, randomTagsHandler)
