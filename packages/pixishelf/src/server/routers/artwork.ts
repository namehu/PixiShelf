import { authProcedure, router } from '@/server/trpc'
import { RandomArtworksGetSchema, RecommendationsGetSchema } from '@/schemas/artwork.dto'
import { getRecommendedArtworks, getRandomArtworks } from '@/services/artwork-service'
import logger from '@/lib/logger'
import { TRPCError } from '@trpc/server'

/**
 * 作品路由
 */
export const artworkRouter = router({
  /**
   * 获取作品列表
   */
  queryRecommendPage: authProcedure.input(RecommendationsGetSchema).query(async ({ input }) => {
    return await getRecommendedArtworks({
      pageSize: input.pageSize,
      cursor: input.cursor ?? undefined
    })
  }),

  /**
   * 随机获取单张图片作品的API接口 (已优化为真随机)
   */
  random: authProcedure.input(RandomArtworksGetSchema).query(async ({ input, ctx }) => {
    try {
      return await getRandomArtworks({
        ...input,
        userId: ctx.userId!
      })
    } catch (error) {
      logger.error('获取随机图片失败:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '获取随机图片失败',
        cause: error
      })
    }
  })
})
