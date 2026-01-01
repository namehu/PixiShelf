import { apiHandler } from '@/lib/api-handler'
import { ArtistsGetSchema } from '@/schemas/artist.dto'
import { getArtists } from '@/services/artist-service'

/**
 * GET /api/artists
 * 获取艺术家列表
 */
export const GET = apiHandler(ArtistsGetSchema, async (req, data) => {
  return getArtists(data)
})
