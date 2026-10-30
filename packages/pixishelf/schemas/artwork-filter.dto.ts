import { z } from 'zod'

export const likedRatingLevels = [2, 3, 4] as const
export type LikedRatingLevel = (typeof likedRatingLevels)[number]
export const likedRatingLabels: Record<LikedRatingLevel, string> = { 2: '喜欢', 3: '超爱', 4: '夯爆了' }

export const ratingLevelsFilterSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean).map(Number)), z.array(z.number())])
  .pipe(z.array(z.union([z.literal(2), z.literal(3), z.literal(4)])).max(100))
  .transform((values) => [...new Set(values)].sort())

export const excludeArtistIdsSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean).map(Number)), z.array(z.number())])
  .pipe(z.array(z.number().int().positive().safe()).max(100))
  .transform((values) => [...new Set(values)].sort((a, b) => a - b))

/** An explicit empty selection clears the legacy liked-only condition too. */
export function resolveRatingLevels(input: {
  ratingLevels?: LikedRatingLevel[]
  likedOnly?: boolean
}): LikedRatingLevel[] {
  return input.ratingLevels ?? (input.likedOnly ? [...likedRatingLevels] : [])
}
