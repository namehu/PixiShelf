import { z } from 'zod'
import { router, authProcedure } from '@/server/trpc'
import * as tagService from '@/services/tag-service'
import { prisma } from '@/lib/prisma'
import { TagManagementStats } from '@/types/tags'

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

  return {
    totalTags,
    translatedTags,
    untranslatedTags,
    translationRate: Math.round(translationRate * 100) / 100 // 保留两位小数
  }
}

export const tagRouter = router({
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
      const whereConditions: any = {}

      // 搜索条件
      if (search) {
        whereConditions.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { name_zh: { contains: search, mode: 'insensitive' } },
          { name_en: { contains: search, mode: 'insensitive' } }
        ]
      }

      // 筛选条件
      if (filter === 'translated') {
        whereConditions.OR = [{ name_zh: { not: null } }, { name_en: { not: null } }]
      } else if (filter === 'untranslated') {
        whereConditions.OR = [{ name_zh: null }, { name_en: null }]
      }

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
            name_zh: true,
            name_en: true,
            description: true,
            artworkCount: true,
            createdAt: true,
            updatedAt: true
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
          tags,
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
    })
})
