import { apiHandler } from '@/lib/api-handler'
import { getArtistById } from '@/services/artist-service'
import { ApiError } from '@/lib/errors'
import { ArtistGetSchema } from '@/schemas/api/artists'

/**
 * GET /api/artists/[id]
 * 获取单个艺术家详情
 */
export const GET = apiHandler(ArtistGetSchema, async (req, data) => {
  const artist = await getArtistById(data.id)

  if (!artist) {
    throw new ApiError('Artist not found', 404)
  }

  return artist
})
