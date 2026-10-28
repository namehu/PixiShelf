import { z } from 'zod'
export const MobileId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const MobileAccount = z.object({ expectedUserId: z.string().min(1).max(128) })
export const MobileFeedQuery = MobileAccount.extend({
  search: z.string().trim().max(200).default(''),
  mode: z.enum(['latest', 'random']).default('random'),
  sortBy: z.enum(['source_date_desc', 'source_date_asc', 'created_at_desc', 'created_at_asc', 'title_asc', 'title_desc', 'artist_asc', 'artist_desc', 'images_desc', 'images_asc', 'random']).optional(),
  mediaType: z.enum(['all', 'image', 'animation', 'video']).default('all'),
  readingStatus: z.enum(['UNREAD', 'IN_PROGRESS', 'COMPLETED']).optional(),
  likedOnly: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true').default(false),
  seed: z.coerce.number().int().min(0).max(2147483647).default(1),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  cursor: z.string().min(1).max(4096).optional()
})
export const MobileMediaQuery = MobileAccount.extend({
  revision: MobileId,
  variant: z.enum(['preview', 'thumbnail', 'original']).default('preview')
})
