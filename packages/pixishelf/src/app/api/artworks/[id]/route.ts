import { getArtworkById } from '@/services/artwork-service'
import { apiHandler } from '@/lib/api-handler'
import { ApiError } from '@/lib/errors'
import { ArtworkGetSchema } from '@/schemas/artwork.dto'

/**
 * /api/artworks/[id]
 * 获取单个作品详情
 *
 * @param _req
 * @param param1
 * @returns
 */
export const GET = apiHandler(ArtworkGetSchema, async (req, data) => {
  const artwork = await getArtworkById(data.id)

  if (!artwork) {
    throw new ApiError('Artwork not found', 404)
  }

  return artwork
})
