import { z } from 'zod'
import { router, authProcedure, adminProcedure } from '@/server/trpc'
import * as tagService from '@/services/tag-service'
import { prisma } from '@/lib/prisma'
import { TagManagementStats } from '@/types/tags'
import { Prisma } from '@pixishelf/db'
import { buildPixivTagImageUrl } from '@/lib/pixiv-data'
import {
  cancelPixivTagEnrichment,
  getPixivTagEnrichmentSummary,
  retryPixivTagEnrichment,
  startPixivTagEnrichment
} from '@/services/pixiv-tag-enrichment-service'

/**
 * 获取标签管理统计信息
 */
async function getTagManagementStats(): Promise<TagManagementStats> {
  const [totalTags, translatedTags] = await Promise.all([
    prisma.tag.count(),
    prisma.tag.count({
      where: { OR: [{ name_zh: { not: null } }, { name_en: { not: null } }] }
    })
  ])

  const untranslatedTags = totalTags - translatedTags
  const translationRate = totalTags > 0 ? (translatedTags / totalTags) * 100 : 0
  // 注意 totalTags 统计的是主记录条数，而 translatedTags 以 name_zh/name_en 非空为计数条件；
  // untranslatedTags 与 translationRate 用于管理页概览，不参与分页查询条件。

  return {
    totalTags,
    translatedTags,
    untranslatedTags,
    translationRate: Math.round(translationRate * 100) / 100 // 保留两位小数
  }
}

export const tagRouter = router({
  getByIds: authProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).max(100)
      })
    )
    .query(async ({ input }) => {
      if (input.ids.length === 0) {
        return { items: [] }
      }

      const tags = await tagService.getTagsByIds(input.ids)
      return { items: tags }
    }),

  /**
   * 标签列表/搜索/随机获取
   */
  list: authProcedure
    .input(
      z.object({
        cursor: z.number().nullish().default(1),
        pageSize: z.number().min(1).max(100).default(100),
        query: z.string().optional(),
        mode: z.enum(['popular', 'random']).default('popular')
      })
    )
    .query(async ({ input }) => {
      const { cursor, pageSize, query, mode } = input
      const page = cursor || 1

      // --------------------------------------------------------------------------
      // 场景 1: 搜索模式 (有 query)
      // --------------------------------------------------------------------------
      if (query) {
        return tagService.searchTags({
          page,
          pageSize,
          query
        })
      }

      // --------------------------------------------------------------------------
      // 场景 2: 热门模式 (无 query, mode='popular')
      // --------------------------------------------------------------------------
      if (mode === 'popular') {
        return tagService.getPopularTags({
          page,
          pageSize
        })
      }

      // --------------------------------------------------------------------------
      // 场景 3: 随机模式 (无 query, mode='random')
      // --------------------------------------------------------------------------
      return tagService.getRandomTags({
        page,
        pageSize
      })
    }),

  /**
   * 标签管理列表
   */
  management: authProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().min(1).max(100).default(30),
        search: z.string().optional(),
        filter: z.enum(['all', 'translated', 'untranslated']).default('all'),
        sort: z.enum(['name', 'name_zh', 'name_en', 'artworkCount', 'createdAt', 'updatedAt']).default('artworkCount'),
        order: z.enum(['asc', 'desc']).default('desc')
      })
    )
    .query(async ({ input }) => {
      const { page, limit, search, filter, sort, order } = input

      // 构建where条件
      const andConditions: Prisma.TagWhereInput[] = []

      // 搜索条件
      if (search) {
        andConditions.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { name_zh: { contains: search, mode: 'insensitive' } },
            { name_en: { contains: search, mode: 'insensitive' } }
          ]
        })
      }

      // 筛选条件
      if (filter === 'translated') {
        andConditions.push({ OR: [{ name_zh: { not: null } }, { name_en: { not: null } }] })
      } else if (filter === 'untranslated') {
        // “未翻译”要求中英文都为空，与自动补全对任一字段成功的语义保持一致。
        andConditions.push({ AND: [{ name_zh: null }, { name_en: null }] })
      }
      const whereConditions: Prisma.TagWhereInput = andConditions.length > 0 ? { AND: andConditions } : {}

      // 计算偏移量
      const skip = (page - 1) * limit

      // 构建排序条件
      const orderBy: any = {}
      if (sort) {
        orderBy[sort] = order
      }

      // 获取标签列表
      const [tags, totalCount] = await Promise.all([
        prisma.tag.findMany({
          where: whereConditions,
          orderBy,
          skip,
          take: limit,
          select: {
            id: true,
            name: true,
            namespace: true,
            isSystem: true,
            systemKey: true,
            name_zh: true,
            name_en: true,
            description: true,
            image: true,
            artworkCount: true,
            createdAt: true,
            updatedAt: true,
            externalMetadata: {
              where: { providerKey: 'pixiv' },
              take: 1,
              select: {
                status: true,
                lastAttemptAt: true,
                lastErrorCode: true,
                lastError: true,
                lastSystemJobId: true
              }
            },
            artworkTags: {
              where: {
                provenance: 'SOURCE',
                sourceRef: { is: { providerKey: 'pixiv' } }
              },
              take: 1,
              select: { id: true }
            }
          }
        }),
        prisma.tag.count({ where: whereConditions })
      ])

      // 获取统计信息
      const stats = await getTagManagementStats()

      // 计算分页信息
      const totalPages = Math.ceil(totalCount / limit)
      const hasNextPage = page < totalPages
      const hasPrevPage = page > 1

      return {
        success: true,
        data: {
          // 将关联表压平成管理页需要的 Pixiv 状态，避免把 Prisma 关系结构暴露给 UI。
          tags: tags.map(({ externalMetadata, artworkTags, namespace, image, ...tag }) => ({
            ...tag,
            image: buildPixivTagImageUrl(image),
            pixivSync: externalMetadata[0] ?? null,
            pixivEligible: namespace === 'general' && artworkTags.length > 0 && !tag.isSystem
          })),
          pagination: {
            page,
            limit,
            totalCount,
            totalPages,
            hasNextPage,
            hasPrevPage
          },
          stats,
          query: input
        }
      }
    }),

  /**
   * 创建标签
   */
  create: authProcedure
    .input(
      z.object({
        name: z.string().min(1, '标签名不能为空'),
        name_zh: z.string().optional().nullable(),
        name_en: z.string().optional().nullable(),
        description: z.string().optional().nullable()
      })
    )
    .mutation(async ({ input }) => {
      return tagService.createTag(input)
    }),

  /**
   * 更新标签
   */
  update: authProcedure
    .input(
      z.object({
        id: z.number(),
        data: z.object({
          name: z.string().optional(),
          name_zh: z.string().optional().nullable(),
          name_en: z.string().optional().nullable(),
          description: z.string().optional().nullable()
        })
      })
    )
    .mutation(async ({ input }) => {
      return tagService.updateTag(input.id, input.data)
    }),

  pixivEnrichmentSummary: adminProcedure.query(() => getPixivTagEnrichmentSummary()),

  startPixivEnrichment: adminProcedure
    .input(z.object({ tagIds: z.array(z.number().int().positive()).min(1).max(1_000).optional() }))
    .mutation(({ input, ctx }) => startPixivTagEnrichment(ctx.userId, input.tagIds)),

  cancelPixivEnrichment: adminProcedure.mutation(() => cancelPixivTagEnrichment()),

  retryPixivEnrichment: adminProcedure
    .input(z.object({ tagId: z.number().int().positive() }))
    .mutation(({ input, ctx }) => retryPixivTagEnrichment(input.tagId, ctx.userId)),

  /**
   * 删除标签
   */
  delete: authProcedure.input(z.number()).mutation(async ({ input }) => {
    return tagService.deleteTag(input)
  })
})
