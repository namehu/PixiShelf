import { apiHandler } from '@/lib/api-handler'
import { RecommendationsGetSchema } from '@/schemas/api/artwork'
import { getRecommendedArtworks } from '@/services/artwork-service'

/**
 * 获取推荐作品接口
 * GET /api/artworks/recommendations
 */
export const GET = apiHandler(RecommendationsGetSchema, async (req, data) => {
  // 调用 Service 层
  const result = await getRecommendedArtworks({ pageSize: data.pageSize })

  // 直接返回数据
  return result
})
