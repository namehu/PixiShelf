import { apiHandler } from '@/lib/api-handler'
import { getArtists } from '@/services/artist-service'
import { z } from 'zod'

// 定义 Schema
const GetArtistsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['name_asc', 'name_desc', 'artworks_desc', 'artworks_asc']).default('name_asc')
})

/**
 * GET /api/artists
 * 获取艺术家列表
 */
export const GET = apiHandler(GetArtistsSchema, async (req, data) => {
  return getArtists(data)
})
