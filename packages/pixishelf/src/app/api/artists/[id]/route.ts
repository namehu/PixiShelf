import { apiHandler } from '@/lib/api-handler'
import { getArtistById } from '@/services/artist-service'
import { ApiError } from '@/lib/errors'
import { z } from 'zod'

// 定义 Schema
const GetArtistSchema = z.object({
  /** 艺术家ID 路径参数 */
  id: z.coerce.number().positive()
})

/**
 * GET /api/artists/[id]
 * 获取单个艺术家详情
 */
export const GET = apiHandler(GetArtistSchema, async (req, data) => {
  const artist = await getArtistById(data.id)

  if (!artist) {
    throw new ApiError('Artist not found', 404)
  }

  return artist
})
