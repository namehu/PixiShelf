import { z } from 'zod'
import { ArtworkModel, ArtistModel, ImageModel, TagModel, TranslateTypeEnum } from './models'
import { dateToString, nullableDateToString } from './utils'

/**
 * Artist DTO
 * - 时间转字符串
 * - 移除了 userId (隐私信息)
 */
const ArtistResponseDto = ArtistModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString
}).omit({
  userId: true // 假设不想把绑定的第三方 userId 暴露给前端
})

/**
 * Image DTO
 * - 时间转字符串
 * - 增加 mediaType 计算字段
 */
const ImageResponseDto = ImageModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  // 前端辅助字段，数据库没有，需要 Service 层计算填充
  mediaType: z.enum(['image', 'video']).default('image')
})

/**
 * Tag DTO
 * - 时间转字符串
 */
const TagResponseDto = TagModel.pick({
  id: true,
  name: true,
  name_zh: true
})

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
  images: z.array(ImageResponseDto).default([]),

  // 标签列表：注意这里我们直接返回 Tag[]，而不是中间表 ArtworkTag[]
  tags: z.array(TagResponseDto).default([]),

  // apng对象
  apng: ImageResponseDto.pick({
    id: true,
    path: true,
    size: true
  })
    .optional()
    .nullable(),

  // 3. 业务计算字段 (Service 层填充)
  videoCount: z.number().int().default(0),
  totalMediaSize: z.number().int().default(0) // 可能是 bigint，注意 JS 数字精度
}).omit({
  // 4. 剔除不需要暴露给 API 的内部字段
  // 如果你需要把 artistId 藏起来，可以在这里 omit
  // artistId: true,
})

// export type ArtistResponse = z.infer<typeof ArtistResponseDto>
// export type ImageResponse = z.infer<typeof ImageResponseDto>
// export type TagResponse = z.infer<typeof TagResponseDto>
export type TArtworkResponseDto = z.infer<typeof ArtworkResponseDto>
