import { z } from 'zod'
import { ArtistModel } from './models'
import { dateToString } from './utils'
import { combinationStaticAvatar, combinationStaticArtistBg } from '@/utils/combinationStatic'

// ==========================================
// Artist Response DTO
// ==========================================

/**
 * Artist Response DTO
 * 包含：艺术家本身信息 + 时间字段转换 + 静态资源路径处理
 */
export const ArtistResponseDto = ArtistModel.extend({
  createdAt: dateToString,
  updatedAt: dateToString,
  artworksCount: z.number().int().default(0)
}).transform((artist) => {
  return {
    ...artist,
    avatar: combinationStaticAvatar(artist.userId, artist.avatar),
    backgroundImg: combinationStaticArtistBg(artist.userId, artist.backgroundImg)
  }
})

export type ArtistResponseDto = z.infer<typeof ArtistResponseDto>
