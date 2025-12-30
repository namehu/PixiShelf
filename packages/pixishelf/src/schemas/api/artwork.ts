import { MediaTypeFilter, SortOption } from '@/types'
import z from 'zod'

/**
 * 推荐作品接口参数验证 Schema
 */
export const RecommendationsGetSchema = z.object({
  /** 每页数量 */
  pageSize: z.coerce.number().int().positive().default(10)
})

export type RecommendationsGetSchema = z.infer<typeof RecommendationsGetSchema>

function getSafeSortOption(sortBy: string | null): SortOption {
  const validOptions: SortOption[] = [
    'title_asc',
    'title_desc',
    'artist_asc',
    'artist_desc',
    'images_desc',
    'images_asc',
    'source_date_desc',
    'source_date_asc'
  ]
  return validOptions.includes(sortBy as SortOption) ? (sortBy as SortOption) : 'source_date_desc'
}

/**
 * 作品列表查询接口参数验证
 * @description 验证作品列表查询接口的参数，包括分页、标签、搜索、艺术家ID、标签ID、排序选项和媒体类型。
 */
export const ArtworksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  tags: z
    .string()
    .optional()
    .transform((val) => val?.split(',').filter(Boolean) || []),
  search: z
    .string()
    .optional()
    .transform((val) => val?.trim() || ''),
  artistId: z.coerce.number().int().optional(),
  tagId: z.coerce.number().int().optional(),
  sortBy: z
    .string()
    .optional()
    .transform((val) => getSafeSortOption(val || null)),
  mediaType: z
    .string()
    .optional()
    .default('all')
    .transform((val) => (val as MediaTypeFilter) || 'all')
})

export type ArtworksQuerySchema = z.infer<typeof ArtworksQuerySchema>
