import { z } from 'zod'
import { ArtworkModel, ImageModel, TagModel } from './models'
import { dateToString, nullableDateToString } from './utils'
import { ArtistResponseDto } from './artist.dto'

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

  // 2. 扩展关联字段 (Relations)
  // 允许 artist 为 null (例如数据不完整)
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

  // 标签列表：注意这里我们直接返回 Tag[]，而不是中间表 ArtworkTag[]
  tags: z.array(ArtworkTagDtoTag).default([]),

  /**
   * 总媒体大小
   * 目前来说仅计算 视频 / apng 文件大小 图片大小统一为0
   */
  totalMediaSize: z.number().int().default(0)
}).omit({
  // 4. 剔除不需要暴露给 API 的内部字段
  // 如果你需要把 artistId 藏起来，可以在这里 omit
  // artistId: true,
})

// export type ArtistResponse = z.infer<typeof ArtistResponseDto>
// export type TagResponse = z.infer<typeof TagResponseDto>
export type ArtworkResponseDto = z.infer<typeof ArtworkResponseDto>
