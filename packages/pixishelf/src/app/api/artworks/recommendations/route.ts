import { apiHandler } from '@/lib/api-handler'
import { RecommendationsGetSchema } from '@/schemas/artwork.dto'
import { getRecommendedArtworks } from '@/services/artwork-service'

/**
 * 获取推荐作品接口
 * GET /api/artworks/recommendations
 */
export const GET = apiHandler(RecommendationsGetSchema, async (req, data) => {
  return getRecommendedArtworks({ pageSize: data.pageSize })
})
