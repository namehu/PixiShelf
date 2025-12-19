import { z } from 'zod'
import { TagModel } from './models'
import { dateToString } from './utils'
import { combinationStaticTagImage } from '@/utils/combinationStatic'
import { TAG_SELECT } from './models/tags'

// ==========================================

/**
 * Tag Response DTO
 * 包含：标签本身信息 + 时间字段
 */
export const TagResponseDto = TagModel.pick(TAG_SELECT).extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  image: z
    .string()
    .nullable()
    .transform((image) => combinationStaticTagImage(image))
})

export type TTagResponseDto = z.infer<typeof TagResponseDto>
