import { z } from 'zod'
import { TagModel } from './models'
import { dateToString } from './utils'
import { combinationStaticTagImage } from '@/utils/combinationStatic'

// ==========================================

/**
 * Tag Response DTO
 * 包含：标签本身信息 + 时间字段
 */
export const TagResponseDto = TagModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  image: z
    .string()
    .nullable()
    .transform((image) => combinationStaticTagImage(image))
}).pick({
  id: true,
  name: true,
  name_zh: true,
  name_en: true,
  description: true,
  artworkCount: true,
  createdAt: true,
  updatedAt: true,
  image: true,
  abstract: true,
  translateType: true
})

export type TTagResponseDto = z.infer<typeof TagResponseDto>
