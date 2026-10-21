import { z } from 'zod'
import type { ReadingContextDto } from '@pixishelf/db/reading-contract'
import type { ArtworkImageResponseDto, ArtworkResponseDto } from './artwork.dto'

export const MEDIA_PAGE_SIZE = 24
export const MEDIA_INDEX_CONFLICT = 'ARTWORK_MEDIA_INDEX_CONFLICT'
export const ReaderInputSchema = z.object({
  artworkId: z.number().int().positive(),
  expectedUserId: z.string().min(1)
})
export const MediaPageInputSchema = ReaderInputSchema.extend({
  fingerprint: z.string().length(64),
  page: z.number().int().nonnegative()
})
export interface MediaIndexItem {
  mediaId: number
  memberMediaIds: number[]
  index: number
  width: number | null
  height: number | null
  mediaType: 'image' | 'video'
  isAnimated: boolean
  reliableDimensions: boolean
}
export interface MediaIndex {
  fingerprint: string
  mediaRevision: number
  items: MediaIndexItem[]
}
export interface ReaderInitialization {
  title: string
  index: MediaIndex
  /** Logical membership is transmitted once, in index.items. */
  reading: Omit<ReadingContextDto, 'media'>
}
export interface ReaderInitialPage {
  artwork: ArtworkResponseDto
  fingerprint: string
  total: number
}
export interface MediaPage {
  fingerprint: string
  page: number
  images: ArtworkImageResponseDto[]
}
