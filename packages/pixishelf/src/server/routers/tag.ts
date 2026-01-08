import { z } from 'zod'
import { router, authProcedure } from '@/server/trpc'
import * as tagService from '@/services/tag-service'

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
    })
})
