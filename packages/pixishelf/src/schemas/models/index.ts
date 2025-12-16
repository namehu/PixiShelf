import { z } from 'zod'

// ==========================================
// 0. Enums & Shared Types
// ==========================================

// 对应 schema.prisma 中的 enum TranslateType
export const TranslateTypeEnum = z.enum(['NONE', 'PIXIV', 'AI', 'MANUAL'])

export type TranslateType = z.infer<typeof TranslateTypeEnum>

// ==========================================
// 1. Base Models (1:1 Mirror of Prisma)
// ==========================================

/**
 * Model Artist
 */
export const ArtistModel = z.object({
  id: z.number().int(),
  name: z.string(),
  username: z.string().nullable(),
  userId: z.string().nullable(), // [cite: 2]
  bio: z.string().nullable(),
  createdAt: z.date(), // [cite: 3]
  updatedAt: z.date(),
  avatar: z.string().nullable(),
  backgroundImg: z.string().nullable() // [cite: 4]
})

/**
 * Model Artwork
 */
export const ArtworkModel = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  artistId: z.number().int().nullable(), // [cite: 6]
  createdAt: z.date(), // [cite: 7]
  updatedAt: z.date(),
  descriptionLength: z.number().int().default(0),
  directoryCreatedAt: z.date().nullable(),
  imageCount: z.number().int().default(0), // [cite: 8]
  bookmarkCount: z.number().int().nullable(),
  externalId: z.string().nullable(), // [cite: 9]
  isAiGenerated: z.boolean().nullable(),
  originalUrl: z.string().nullable(), // [cite: 10]
  size: z.string().nullable(),
  sourceDate: z.date().nullable(), // [cite: 11]
  sourceUrl: z.string().nullable(), // [cite: 12]
  thumbnailUrl: z.string().nullable(),
  xRestrict: z.string().nullable(), // [cite: 13]
  likeCount: z.number().int().default(0) // [cite: 14]
})

/**
 * Model Tag
 */
export const TagModel = z.object({
  id: z.number().int(),
  name: z.string(), // [cite: 16]
  createdAt: z.date(),
  updatedAt: z.date(),
  artworkCount: z.number().int().default(0),
  description: z.string().nullable(), // [cite: 17]
  name_zh: z.string().nullable(),
  // search_vector 类型为 Unsupported("tsvector")，Zod 中无法直接校验，通常省略或设为 any
  translateType: TranslateTypeEnum.default('NONE'), // [cite: 18]
  abstract: z.string().nullable(),
  image: z.string().nullable(), // [cite: 19]
  name_en: z.string().nullable()
})

/**
 * Model ArtworkTag (关联表)
 */
export const ArtworkTagModel = z.object({
  id: z.number().int(),
  artworkId: z.number().int(),
  tagId: z.number().int(), // [cite: 21]
  createdAt: z.date()
})

/**
 * Model Image
 */
export const ImageModel = z.object({
  id: z.number().int(),
  path: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(), // [cite: 22]
  size: z.number().int().nullable(),
  sortOrder: z.number().int().default(0), // [cite: 23]
  artworkId: z.number().int().nullable(), // [cite: 25]
  createdAt: z.date(), // [cite: 24]
  updatedAt: z.date()
})

export interface IImageModel extends z.infer<typeof ImageModel> {}

/**
 * Model User
 */
export const UserModel = z.object({
  id: z.number().int(),
  username: z.string(),
  password: z.string(), // 注意：通常不应返回给前端，在 DTO 层剔除
  createdAt: z.date(),
  updatedAt: z.date()
})

/**
 * Model ArtworkLike
 */
export const ArtworkLikeModel = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  artworkId: z.number().int(), // [cite: 26]
  createdAt: z.date(),
  updatedAt: z.date()
})

/**
 * Model Setting
 */
export const SettingModel = z.object({
  id: z.number().int(),
  key: z.string(),
  value: z.string().nullable(),
  type: z.string().default('string'), // [cite: 27]
  createdAt: z.date(),
  updatedAt: z.date()
})

/**
 * Model TriggerLog
 */
export const TriggerLogModel = z.object({
  id: z.number().int(),
  operation: z.string(),
  table_name: z.string(),
  record_id: z.number().int().nullable(),
  old_value: z.number().int().nullable(), // [cite: 28]
  new_value: z.number().int().nullable(),
  error_message: z.string().nullable(), // [cite: 29]
  created_at: z.date()
})
