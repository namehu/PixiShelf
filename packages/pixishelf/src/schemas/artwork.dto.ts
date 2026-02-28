import z from 'zod'
import { MediaTypeFilter, SortOption } from '@/types'
import { ArtworkModel, ImageModel, TagModel } from './models'
import { dateToString, nullableDateToString } from './utils'
import { ArtistResponseDto } from './artist.dto'
import { EMediaType } from '@/enums/EMediaType'

/** 作品详情查询参数 */
export const ArtworkGetSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer')
})
export type ArtworkGetSchema = z.infer<typeof ArtworkGetSchema>

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
 * 作品列表无限加载查询参数
 * @description 验证作品列表查询接口的参数，包括分页、标签、搜索、艺术家ID、标签ID、排序选项和媒体类型。
 */
export const ArtworksInfiniteQuerySchema = z.object({
  cursor: z.number().min(1).nullish().default(1),
  pageSize: z.coerce.number().int().min(1).max(10000).default(24),
  tags: z
    .string()
    .nullish()
    .transform((val) => val?.split(',').filter(Boolean) || []),
  search: z
    .string()
    .nullish()
    .transform((val) => val?.trim() || ''),
  artistId: z.coerce.number().int().optional(),
  artistName: z.string().nullish(),
  tagId: z.coerce.number().int().optional(),
  sortBy: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'random') return 'random'
      return getSafeSortOption(val || null)
    }),
  randomSeed: z.number().int().optional(),
  mediaType: z
    .string()
    .optional()
    .default('all')
    .transform((val) => (val as MediaTypeFilter) || 'all'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
    .optional()
    .nullish(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
    .optional()
    .nullish(),
  externalId: z.string().nullish().optional(),
  exactMatch: z.boolean().optional().default(false),
  mediaCountMin: z.coerce.number().int().min(0).nullish(),
  mediaCountMax: z.coerce.number().int().min(0).nullish()
})

export type ArtworksInfiniteQuerySchema = z.infer<typeof ArtworksInfiniteQuerySchema>

/**
 * 推荐作品接口参数验证 Schema
 */
export const RecommendationsGetSchema = z.object({
  /** 每页数量 */
  pageSize: z.coerce.number().int().positive().default(10),
  cursor: z.number().nullish()
})

export type RecommendationsGetSchema = z.infer<typeof RecommendationsGetSchema>

/**
 * 随机作品接口参数验证 Schema
 */
export const RandomArtworksGetSchema = z.object({
  cursor: z.number().nullish(), // page number
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  count: z.coerce.number().int().min(1).max(100).default(8),
  mediaType: z.enum(EMediaType).default(EMediaType.all)
})

export type RandomArtworksGetSchema = z.infer<typeof RandomArtworksGetSchema>

/**
 * 邻近作品查询参数
 */
export const NeighboringArtworksGetSchema = z.object({
  artistId: z.coerce.number().int(),
  artworkId: z.coerce.number().int(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  direction: z.enum(['both', 'older', 'newer']).default('both')
})

export type NeighboringArtworksGetSchema = z.infer<typeof NeighboringArtworksGetSchema>

/**
 * Image DTO
 * - 时间转字符串
 * - 增加 mediaType 计算字段
 */
export const ArtworkImageResponseDto = ImageModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  // 前端辅助字段，数据库没有，需要 Service 层计算填充
  mediaType: z.enum(['image', 'video']).default('image')
})

export type ArtworkImageResponseDto = z.infer<typeof ArtworkImageResponseDto>

/**
 * Tag DTO
 * - 时间转字符串
 */
const ArtworkTagDtoTag = TagModel.pick({
  id: true,
  name: true,
  name_zh: true
})

export type TArtworkTagDto = z.infer<typeof ArtworkTagDtoTag>

// ==========================================
// Main Aggregated DTO (核心聚合)
// ==========================================

/**
 * Artwork Detail DTO
 * 包含：作品本身信息 + 艺术家 + 图片列表 + 标签列表
 */
export const ArtworkResponseDto = ArtworkModel.extend({
  // 1. 覆盖时间字段 (Date -> String)
  createdAt: dateToString,
  updatedAt: dateToString,
  directoryCreatedAt: nullableDateToString,
  sourceDate: nullableDateToString,

  // 扩展关联字段 (Relations)
  artist: ArtistResponseDto.nullable().optional(),

  // 图片列表
  images: z
    .array(
      ArtworkImageResponseDto.extend({
        // 扩展webm 原生apng对象
        raw: ArtworkImageResponseDto.nullable().optional()
      })
    )
    .default([]),

  tags: z.array(ArtworkTagDtoTag).default([]),

  /**
   * 总媒体大小
   */
  totalMediaSize: z.number().int().default(0),

  /**
   * 图片数量
   */
  imageCount: z.number().int().default(0),

  /**
   * 媒体数量
   * 最准确的数量
   */
  mediaCount: z.number().int().default(0),

  /**
   * 是否视频
   */
  isVideo: z.boolean().default(false),

  /**
   * 系列信息
   */
  series: z
    .object({
      id: z.number(),
      title: z.string(),
      order: z.number(),
      prev: z.object({ id: z.number(), title: z.string() }).nullable(),
      next: z.object({ id: z.number(), title: z.string() }).nullable()
    })
    .nullable()
    .optional()
})

// export type ArtistResponse = z.infer<typeof ArtistResponseDto>
// export type TagResponse = z.infer<typeof TagResponseDto>
export type ArtworkResponseDto = z.infer<typeof ArtworkResponseDto>

/**
 * 批量创建作品参数 Schema
 */
export const BatchCreateArtworkSchema = z.object({
  artworks: z.array(
    z.object({
      tempId: z.string(), // 前端临时ID
      title: z.string().min(1),
      artistId: z.number().int(),
      artistUserId: z.string(),
      tagIds: z.array(z.number().int()).default([]),
      sourceDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
        .optional()
    })
  )
})

export type BatchCreateArtworkSchema = z.infer<typeof BatchCreateArtworkSchema>

/**
 * 批量导入作品参数 Schema
 */
export const BatchImportArtworkSchema = z.object({
  tempId: z.string(),
  id: z.number().int(),
  externalId: z.string(),
  /** 目标相对目录 */
  targetRelDir: z.string(),
  /** 上传目标目录 */
  uploadTargetDir: z.string(),
  title: z.string()
})

export type BatchImportArtworkSchema = z.infer<typeof BatchImportArtworkSchema>

/**
 * 批量注册图片参数 Schema
 */
export const BatchRegisterImageSchema = z.object({
  items: z.array(
    z.object({
      artworkId: z.number().int(),
      images: z.array(
        z.object({
          path: z.string(),
          size: z.number().int(),
          width: z.number().int().optional(),
          height: z.number().int().optional()
        })
      )
    })
  )
})

export type BatchRegisterImageSchema = z.infer<typeof BatchRegisterImageSchema>
