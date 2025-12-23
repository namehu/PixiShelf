import { z } from 'zod'
import { ArtistModel } from './models'
import { dateToString } from './utils'
import { combinationStaticArtistBg, combinationStaticAvatar } from '@/utils/combinationStatic'
import { ARTIST_SELECT } from './models/artists'

/**
 * Artist Response DTO
 * 包含：艺术家本身信息 + 时间字段 + 静态资源地址处理 + 作品数量
 */
export const ArtistResponseDto = ArtistModel.pick(ARTIST_SELECT)
  .extend({
    // 扩展 _count 字段，用于接收 Prisma 的 _count 聚合结果
    _count: z
      .object({
        artworks: z.number().int()
      })
      .optional()
      .nullable()
  })
  .transform((artist) => {
    const { _count, userId, createdAt, updatedAt, avatar, backgroundImg, ...rest } = artist
    return {
      ...rest,
      userId, // 保留 userId，因为 combinationStatic 需要它，或者根据需求决定是否输出
      // 转换时间
      createdAt: dateToString.parse(createdAt),
      updatedAt: dateToString.parse(updatedAt),
      // 转换图片地址
      avatar: combinationStaticAvatar(userId, avatar),
      backgroundImg: combinationStaticArtistBg(userId, backgroundImg),
      // 扁平化 worksCount
      artworksCount: _count?.artworks || 0
    }
  })

export type TArtistResponseDto = z.infer<typeof ArtistResponseDto>
