import { prisma } from '@/lib/prisma'
import { TAG_SELECT } from '@/schemas/models/tags'
import { TTagResponseDto, TagResponseDto } from '@/schemas/tag.dto'
import { Prisma } from '@prisma/client'

// 定义列表查询的返回结构
export interface TagListResult {
  items: any[]
  nextCursor: number | undefined
}

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

/**
 * 根据 ID 获取单个标签
 * @param id 标签 ID
 * @returns 标签数据或 null
 */
export async function getById(id: number): Promise<TTagResponseDto | null> {
  const tag = await prisma.tag.findUnique({
    where: { id },
    select: TAG_SELECT
  })

  return !tag ? null : TagResponseDto.parse(tag)
}

/**
 * 搜索模式 (有 query)
 */
export async function searchTags(params: { page: number; pageSize: number; query: string }): Promise<TagListResult> {
  const { page, pageSize, query } = params
  const offset = (page - 1) * pageSize
  const tsquery = buildTsQuery(query)

  let tags: any[] = []
  let totalCount = 0

  if (tsquery) {
    // 1. 定义排序逻辑
    // 注意：在 $queryRaw 中，如果一段 SQL 是动态拼接的，需要用 Prisma.raw() 包裹
    // 但在这里，我们直接写在模板里最安全。

    const [searchResults, countResults] = await Promise.all([
      // 查询结果
      prisma.$queryRaw<any[]>`
      SELECT
        id,
        name,
        name_zh,
        name_en,
        description,
        "artworkCount",
        "createdAt",
        "updatedAt",
        ts_rank(search_vector, to_tsquery('simple', ${tsquery})) as relevance_score
      FROM "Tag"
      WHERE search_vector @@ to_tsquery('simple', ${tsquery})
      ORDER BY ts_rank(search_vector, to_tsquery('simple', ${tsquery})) DESC, id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `,

      // 查询总数
      prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "Tag"
      WHERE search_vector @@ to_tsquery('simple', ${tsquery})
    `
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
    nextCursor: page < totalPages ? page + 1 : undefined
  }
}

/**
 * 热门模式 (无 query, mode='popular')
 */
export async function getPopularTags(params: { page: number; pageSize: number }): Promise<TagListResult> {
  const { page, pageSize } = params
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
    nextCursor: page < totalPages ? page + 1 : undefined
  }
}

/**
 * 随机模式 (无 query, mode='random')
 */
export async function getRandomTags(params: { page: number; pageSize: number }): Promise<TagListResult> {
  const { page, pageSize } = params

  // 1. 构建查询条件
  const whereCondition: any = {}

  // 2. 获取符合条件的标签总数
  const totalCount = await prisma.tag.count({
    where: whereCondition
  })

  if (totalCount === 0) {
    return {
      items: [],
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
  const randomTags = randomTagsResults.flat()

  // 随机模式下，hasNextPage 总是 true (除非 totalCount 为 0，上面已处理)，允许无限刷新
  // 但为了配合 infinite query 的逻辑，我们可以简单地让 nextCursor 自增
  // 或者如果这里是随机获取，其实 page 并不重要，只是作为 cursor 传递
  const totalPages = Math.ceil(totalCount / pageSize) // 这里的 totalPages 意义不大，因为是随机取

  return {
    items: randomTags,
    nextCursor: page + 1
  }
}

/**
 * 获取所有未翻译标签的名称
 * 用于导出功能
 */
export async function getUntranslatedTagNames(): Promise<string[]> {
  const tags = await prisma.tag.findMany({
    where: {
      translateType: 'NONE'
    },
    select: {
      name: true
    }
  })

  return tags.map((tag) => tag.name)
}
