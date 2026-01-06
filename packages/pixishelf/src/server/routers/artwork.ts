import { authProcedure, router } from '@/server/trpc'
import { RecommendationsGetSchema } from '@/schemas/artwork.dto'
import { getRecommendedArtworks } from '@/services/artwork-service'

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
  })
})
