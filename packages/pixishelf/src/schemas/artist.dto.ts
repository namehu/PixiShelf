import { z } from 'zod'
import { ArtistModel } from './models'
import { dateToString } from './utils'
import { combinationStaticAvatar, combinationStaticArtistBg } from '@/utils/combinationStatic'

/**
 * Artists Get Schema
 * 获取单个艺术家查询参数
 */
export const ArtistGetSchema = z.object({
  /** 艺术家ID 路径参数 */
  id: z.coerce.number().positive()
})

export type ArtistGetSchema = z.infer<typeof ArtistGetSchema>

/**
 * Artist Response DTO
 * 包含：艺术家本身信息 + 时间字段转换 + 静态资源路径处理
 */
export const ArtistResponseDto = ArtistModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  artworksCount: z.number().int().default(0),
  _count: z
    .object({
      artworks: z.number().int().default(0)
    })
    .default({ artworks: 0 })
    .nullable()
    .optional()
}).transform(({ _count, ...artist }) => {
  return {
    ...artist,
    avatar: combinationStaticAvatar(artist.userId, artist.avatar),
    backgroundImg: combinationStaticArtistBg(artist.userId, artist.backgroundImg),
    artworksCount: _count?.artworks || 0
  }
})

export type ArtistResponseDto = z.infer<typeof ArtistResponseDto>

/**
 * Artists Get Schema
 * 获取艺术家列表查询参数
 */
export const ArtistsGetSchema = z.object({
  cursor: z.number().int().min(1).default(1), // 用于无限滚动的游标，对应 page
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['name_asc', 'name_desc', 'artworks_desc', 'artworks_asc']).optional().default('name_asc')
})

export type ArtistsGetSchema = z.infer<typeof ArtistsGetSchema>
export type ArtistsGetRequest = z.input<typeof ArtistsGetSchema>

/**
 * 创建艺术家 Schema
 */
export const ArtistCreateSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  username: z.string().optional(),
  userId: z.string().optional(),
  bio: z.string().optional(),
  avatar: z.string().nullable(),
  backgroundImg: z.string().nullish()
})

export type ArtistCreateSchema = z.infer<typeof ArtistCreateSchema>

/**
 * 更新艺术家 Schema
 */
export const ArtistUpdateSchema = z.object({
  id: z.number().int(),
  data: ArtistCreateSchema.partial()
})

export type ArtistUpdateSchema = z.infer<typeof ArtistUpdateSchema>
