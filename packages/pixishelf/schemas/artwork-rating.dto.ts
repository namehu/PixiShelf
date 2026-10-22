import { z } from 'zod'

export const ArtworkRatingValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export const ArtworkRatingLevelSchema = ArtworkRatingValueSchema.nullable()
export type ArtworkRatingLevel = z.infer<typeof ArtworkRatingLevelSchema>

export const ARTWORK_RATING_LABELS = {
  1: '一般',
  2: '喜欢',
  3: '超爱',
  4: '夯爆了'
} as const

export function isArtworkLiked(level: ArtworkRatingLevel): boolean {
  return level !== null && level >= 2
}

export const ArtworkRatingStateSchema = z.object({
  artworkId: z.number().int().positive(),
  level: ArtworkRatingLevelSchema,
  isLike: z.boolean(),
  updatedAt: z.string().datetime().nullable()
})
export type ArtworkRatingState = z.infer<typeof ArtworkRatingStateSchema>

export const ArtworkRatingGetInputSchema = z.object({
  artworkId: z.number().int().positive(),
  expectedUserId: z.string().min(1)
})
export const ArtworkRatingSetInputSchema = ArtworkRatingGetInputSchema.extend({ level: ArtworkRatingLevelSchema })
