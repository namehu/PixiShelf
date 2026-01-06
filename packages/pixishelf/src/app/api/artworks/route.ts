import { apiHandler } from '@/lib/api-handler'
import { ArtworksQuerySchema } from '@/schemas/artwork.dto'
import { getArtworksList } from '@/services/artwork-service' // 引入新写的 service

/**
 * 获取作品列表接口
 * GET /api/artworks
 */
export const GET = apiHandler(ArtworksQuerySchema, async (req, data) => {
  return getArtworksList(data)
})
