import z from 'zod'

/**
 * Artists Get Schema
 * 获取艺术家列表查询参数
 */
export const ArtistsGetSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['name_asc', 'name_desc', 'artworks_desc', 'artworks_asc']).default('name_asc')
})

export type ArtistsGetSchema = z.infer<typeof ArtistsGetSchema>
