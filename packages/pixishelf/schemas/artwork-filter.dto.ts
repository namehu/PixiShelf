import { z } from 'zod'

export const mediaKinds = ['image', 'animation', 'video'] as const
export type MediaKind = (typeof mediaKinds)[number]
export const mediaKindLabels: Record<MediaKind, string> = { image: '图片', animation: '动图', video: '视频' }
export const readingStatuses = ['UNREAD', 'IN_PROGRESS', 'COMPLETED'] as const
export type ReadingStatusFilter = (typeof readingStatuses)[number]
export const readingStatusLabels: Record<ReadingStatusFilter, string> = {
  UNREAD: '未读',
  IN_PROGRESS: '阅读中',
  COMPLETED: '已读完'
}

export const mediaKindsFilterSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean)), z.array(z.enum(mediaKinds))])
  .pipe(z.array(z.enum(mediaKinds)).max(100))
  .transform((values) => mediaKinds.filter((kind) => values.includes(kind)))
export const readingStatusesFilterSchema = z
  .union([z.string().transform((value) => value.split(',').filter(Boolean)), z.array(z.enum(readingStatuses))])
  .pipe(z.array(z.enum(readingStatuses)).max(100))
  .transform((values) => readingStatuses.filter((status) => values.includes(status)))

/** Explicit empty selections take priority over legacy single values. */
export function normalizeArtworkSelections<
  T extends {
    mediaKinds?: MediaKind[]
    mediaType?: MediaKind | 'all'
    readingStatuses?: ReadingStatusFilter[]
    readingStatus?: ReadingStatusFilter | 'all'
  }
>(input: T) {
  const { mediaType, readingStatus, ...query } = input
  return {
    ...query,
    mediaKinds: input.mediaKinds ?? (mediaType && mediaType !== 'all' ? [mediaType] : []),
    readingStatuses: input.readingStatuses ?? (readingStatus && readingStatus !== 'all' ? [readingStatus] : [])
  }
}

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
