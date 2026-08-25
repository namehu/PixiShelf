import { z } from 'zod'
import { ArtistModel } from './models'
import { dateToString } from './utils'
import { buildPixivArtistAvatarUrl, buildPixivArtistBackgroundUrl } from '@/lib/pixiv-data'

/**
 * 艺术家详情查询结构
 * 获取单个艺术家查询参数
 */
export const ArtistGetSchema = z.object({
  /** 艺术家ID 路径参数 */
  id: z.coerce.number().positive()
})

export type ArtistGetSchema = z.infer<typeof ArtistGetSchema>

const ArtistExternalRefDto = z.object({
  id: z.string(),
  providerKey: z.string(),
  externalId: z.string(),
  sourceName: z.string().nullable(),
  status: z.enum(['SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED']).nullable(),
  lastAttemptAt: z.date().nullable(),
  lastSuccessAt: z.date().nullable(),
  lastErrorCode: z.string().nullable(),
  lastError: z.string().nullable(),
  lastSystemJobId: z.string().nullable()
})

/**
 * 艺术家响应 DTO
 * 包含：艺术家本身信息 + 时间字段转换 + 静态资源路径处理
 */
export const ArtistResponseDto = ArtistModel.extend({
  externalRefs: z.array(ArtistExternalRefDto).default([]),
  localImportMappings: z.array(z.object({ id: z.number().int() })).default([]),
  createdAt: dateToString,
  updatedAt: dateToString,
  artworksCount: z.number().int().default(0),
  _count: z
    .object({
      artworks: z.number().int().default(0)
    })
    .default({ artworks: 0 })
    .nullable()
    .optional()
}).transform(({ _count, externalRefs, localImportMappings, ...artist }) => {
  const pixiv = externalRefs.find((source) => source.providerKey === 'pixiv') ?? null
  const sources: Array<{
    type: 'PIXIV' | 'EXTERNAL' | 'LOCAL' | 'MANUAL'
    providerKey: string
    externalId: string
    sourceName: string | null
  }> = externalRefs.map((source) => ({
    type: source.providerKey === 'pixiv' ? ('PIXIV' as const) : ('EXTERNAL' as const),
    providerKey: source.providerKey,
    externalId: source.externalId,
    sourceName: source.sourceName
  }))
  if (localImportMappings.length > 0) {
    sources.push({ type: 'LOCAL' as const, providerKey: 'local', externalId: '', sourceName: null })
  }
  if (sources.length === 0) {
    sources.push({ type: 'MANUAL' as const, providerKey: 'manual', externalId: '', sourceName: null })
  }
  const pixivUserId = pixiv && /^[1-9][0-9]*$/.test(pixiv.externalId) ? pixiv.externalId : null
  return {
    ...artist,
    avatar: buildPixivArtistAvatarUrl(pixivUserId, artist.avatar),
    backgroundImg: buildPixivArtistBackgroundUrl(pixivUserId, artist.backgroundImg),
    sources,
    pixivUserId,
    pixivEligible: pixivUserId !== null,
    pixivSync: pixiv
      ? {
          status: pixiv.status,
          sourceName: pixiv.sourceName,
          lastAttemptAt: pixiv.lastAttemptAt?.toISOString() ?? null,
          lastSuccessAt: pixiv.lastSuccessAt?.toISOString() ?? null,
          lastErrorCode: pixiv.lastErrorCode,
          lastError: pixiv.lastError,
          lastSystemJobId: pixiv.lastSystemJobId
        }
      : null,
    artworksCount: _count?.artworks || 0
  }
})

export type ArtistResponseDto = z.infer<typeof ArtistResponseDto>

/**
 * 艺术家列表查询结构
 * 获取艺术家列表查询参数
 */
export const ArtistsGetSchema = z.object({
  cursor: z.number().int().min(1).default(1), // 用于无限滚动的游标，对应 page
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['name_asc', 'name_desc', 'artworks_desc', 'artworks_asc']).optional().default('name_asc'),
  isStarred: z.boolean().optional()
})

export type ArtistsGetSchema = z.infer<typeof ArtistsGetSchema>
export type ArtistsGetRequest = z.input<typeof ArtistsGetSchema>

/**
 * 创建艺术家 Schema
 */
export const ArtistCreateSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  username: z.string().optional(),
  pixivUserId: z
    .string()
    .regex(/^[1-9][0-9]*$/, 'Pixiv UserID 必须是正整数')
    .nullish(),
  bio: z.string().optional(),
  avatar: z.string().nullable().optional(),
  backgroundImg: z.string().nullish(),
  isStarred: z.boolean().default(false)
})

export type ArtistCreateSchema = z.infer<typeof ArtistCreateSchema>

/**
 * 更新艺术家 Schema
 */
export const ArtistUpdateSchema = z.object({
  id: z.number().int(),
  data: ArtistCreateSchema.partial()
})

export type ArtistUpdateSchema = z.infer<typeof ArtistUpdateSchema>
