import { apiHandler } from '@/lib/api-handler'
import { ArtworksQuerySchema } from '@/schemas/api/artwork'
import { getArtworksList } from '@/services/artwork-service' // 引入新写的 service

/**
 * 获取作品列表接口
 * GET /api/artworks
 * * 职责：只负责参数解析和响应，不处理业务逻辑
 */
export const GET = apiHandler(ArtworksQuerySchema, async (req, data) => {
  const result = await getArtworksList(data)

  return result
})
