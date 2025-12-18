import { getArtworkById } from '@/services/artwork-service'
import z from 'zod'
import { apiHandler } from '@/lib/api-handler'
import { ApiError } from '@/lib/errors'

const RouteParamsSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer')
})

/**
 * /api/artworks/[id]
 * 获取单个作品详情
 *
 * @param _req
 * @param param1
 * @returns
 */
export const GET = apiHandler(RouteParamsSchema, async (req, data) => {
  const artwork = await getArtworkById(data.id)

  if (!artwork) {
    throw new ApiError('Artwork not found', 404)
  }

  return artwork
})
