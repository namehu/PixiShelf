import { z } from 'zod'
import { ArtworkImageResponseDto } from './artwork.dto'

export const MEDIA_MARK_PAGE_SIZE = 24
export const MediaMarkKindSchema = z.enum(['bookmark', 'like'])
export type MediaMarkKind = z.infer<typeof MediaMarkKindSchema>

export const MediaMarkStateDto = z.object({
  markId: z.string().nullable(),
  artworkId: z.number().int().positive(),
  mediaId: z.number().int().positive(),
  bookmarkedAt: z.string().datetime().nullable(),
  likedAt: z.string().datetime().nullable(),
  available: z.boolean()
})
export type MediaMarkStateDto = z.infer<typeof MediaMarkStateDto>

const AccountInput = z.object({ expectedUserId: z.string().min(1) })
export const MediaMarkGetManyInput = AccountInput.extend({
  artworkId: z.number().int().positive(),
  mediaIds: z.array(z.number().int().positive()).max(200)
})
export const MediaMarkGetManyResponseDto = z.object({ items: z.array(MediaMarkStateDto) })
export const MediaMarkSetInput = AccountInput.extend({
  artworkId: z.number().int().positive(),
  mediaId: z.number().int().positive(),
  kind: MediaMarkKindSchema,
  value: z.boolean()
})
export const MediaMarkListInput = AccountInput.extend({
  kind: MediaMarkKindSchema,
  page: z.number().int().min(1).max(1_000_000).default(1)
})
export const MediaMarkListItemDto = z.object({
  id: z.string(),
  artworkId: z.number().int().positive(),
  mediaId: z.number().int().positive().nullable(),
  artworkTitle: z.string(),
  mediaPosition: z.number().int().positive(),
  mediaType: z.enum(['image', 'animation', 'video']),
  media: ArtworkImageResponseDto.extend({ raw: ArtworkImageResponseDto.nullable().optional() }).nullable(),
  bookmarkedAt: z.string().datetime().nullable(),
  likedAt: z.string().datetime().nullable(),
  unavailableReason: z.enum(['deleted', 'writing']).nullable()
})
export type MediaMarkListItemDto = z.infer<typeof MediaMarkListItemDto>
export const MediaMarkListResponseDto = z.object({
  items: z.array(MediaMarkListItemDto),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.literal(MEDIA_MARK_PAGE_SIZE)
})
export type MediaMarkListResponseDto = z.infer<typeof MediaMarkListResponseDto>
export const MediaMarkRemoveInput = AccountInput.extend({ markId: z.string().min(1), kind: MediaMarkKindSchema })
