import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ARTIST_SELECT } from '@/schemas/models/artists'
import { ArtistCreateSchema, ArtistsGetSchema, ArtistUpdateSchema } from '@/schemas/artist.dto'
import { ArtistResponseDto } from '@/schemas/artist.dto'
import { PaginationResponseData } from '@/types'
import {
  buildVideoPosterUrl,
  isVideoCoverSource,
  resolveMediaCoverUrl,
  VIDEO_POSTER_METADATA_SELECT
} from '@/lib/media-cover'
import { Prisma } from '@prisma/client'

/**
 * 根据 ID 获取单个艺术家
 * @param id 艺术家 ID
 * @returns 艺术家数据或 null
 */
export async function getArtistById(id: number | string): Promise<ArtistResponseDto | null> {
  const artist = await prisma.artist.findUnique({
    where: { id: Number(id) },
    select: {
      ...ARTIST_SELECT,
      _count: {
        select: {
          artworks: true
        }
      }
    }
  })

  return !artist ? null : ArtistResponseDto.parse(artist)
}

/**
 * 获取艺术家列表
 * @param options 查询选项
 * @returns 艺术家列表响应
 */
export async function getArtists(options: ArtistsGetSchema): Promise<PaginationResponseData<ArtistResponseDto>> {
  const { pageSize, search, sortBy, cursor, isStarred } = options
  const page = cursor ?? 1
  try {
    // 限制页面大小，防止过大的查询
    const limitedPageSize = Math.min(100, pageSize)
    const skip = (page - 1) * limitedPageSize

    // 构建搜索条件
    const whereClause: any = {}
    if (isStarred !== undefined) {
      whereClause.isStarred = isStarred
    }
    if (search) {
      whereClause.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          username: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          externalRefs: {
            some: {
              OR: [
                { externalId: { contains: search, mode: 'insensitive' } },
                { sourceName: { contains: search, mode: 'insensitive' } }
              ]
            }
          }
        }
      ]
    }

    // 构建排序条件
    let orderBy: any
    switch (sortBy) {
      case 'name_desc':
        orderBy = { name: 'desc' }
        break
      case 'artworks_desc':
        orderBy = { artworks: { _count: 'desc' } }
        break
      case 'artworks_asc':
        orderBy = { artworks: { _count: 'asc' } }
        break
      default:
        orderBy = { name: 'asc' }
    }

    // 并行查询艺术家数据和总数
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: whereClause,
        select: {
          ...ARTIST_SELECT,
          _count: {
            select: {
              artworks: true
            }
          }
        },
        orderBy,
        skip,
        take: limitedPageSize
      }),
      prisma.artist.count({ where: whereClause })
    ])

    // 转换数据格式
    const data = artists.map((artist) => ArtistResponseDto.parse(artist))

    const hasNextPage = page * limitedPageSize < total
    return {
      data,
      nextCursor: hasNextPage ? page + 1 : undefined,
      pagination: {
        page,
        pageSize: limitedPageSize,
        total,
        totalPages: Math.ceil(total / limitedPageSize),
        hasNextPage,
        hasPrevPage: page > 1
      }
    }
  } catch (error) {
    logger.error('Error fetching artists:', error)
    return {
      data: [],
      nextCursor: undefined,
      pagination: {
        page: cursor || 1,
        pageSize: options.pageSize || 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      }
    }
  }
}

/**
 * 获取热门艺术家（按作品数量排序）
 * @param options 查询选项
 * @returns 热门艺术家响应
 */
export async function getRecentArtists(
  options: {
    page?: number
    pageSize?: number
  } = {}
): Promise<PaginationResponseData<ArtistResponseDto>> {
  try {
    const { page = 1, pageSize = 10 } = options
    const skip = (page - 1) * pageSize

    // 并行查询艺术家数据和总数
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        select: {
          ...ARTIST_SELECT,
          _count: {
            select: {
              artworks: true
            }
          }
        },
        orderBy: {
          artworks: {
            _count: 'desc'
          }
        },
        skip,
        take: pageSize
      }),
      prisma.artist.count()
    ])

    // 转换数据格式
    const items = artists.map((artist) => ArtistResponseDto.parse(artist))

    return {
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1
      }
    }
  } catch (error) {
    logger.error('Error fetching recent artists:', error)
    return {
      data: [],
      pagination: {
        page: options.page || 1,
        pageSize: options.pageSize || 10,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      }
    }
  }
}

export interface DashboardArtistArtworkPreview {
  id: number
  title: string
  coverUrl: string | null
  coverMediaType: 'image' | 'video' | null
}

export interface DashboardArtistItem extends ArtistResponseDto {
  recentArtworks: DashboardArtistArtworkPreview[]
}

/**
 * 获取仪表板艺术家卡片数据
 * 策略：
 * 1. 从随机主键位置开始读取固定数量的艺术家，避免把全部候选 ID 拉进 Node
 * 2. 用 LATERAL 子查询一次获取每位艺术家的最近作品 ID
 * 3. 一次查询取回全部预览详情，避免按艺术家执行 N+1 查询
 */
export async function getDashboardArtists(
  options: {
    pageSize?: number
    previewArtworkSize?: number
  } = {}
): Promise<DashboardArtistItem[]> {
  try {
    const pageSize = Math.max(0, Math.floor(options.pageSize ?? 12))
    const previewArtworkSize = Math.max(0, Math.floor(options.previewArtworkSize ?? 3))
    if (pageSize === 0) return []

    const bounds = await prisma.artist.aggregate({
      _min: { id: true },
      _max: { id: true }
    })
    const minId = bounds._min.id
    const maxId = bounds._max.id
    if (minId == null || maxId == null) return []

    const artistSelect = {
      ...ARTIST_SELECT,
      _count: {
        select: {
          artworks: true
        }
      }
    } as const
    const pivot = minId + Math.floor(Math.random() * (maxId - minId + 1))
    const firstArtists = await prisma.artist.findMany({
      where: {
        id: { gte: pivot },
        artworks: { some: {} }
      },
      select: artistSelect,
      orderBy: { id: 'asc' },
      take: pageSize
    })
    const wrappedArtists =
      firstArtists.length < pageSize
        ? await prisma.artist.findMany({
            where: {
              id: { lt: pivot },
              artworks: { some: {} }
            },
            select: artistSelect,
            orderBy: { id: 'asc' },
            take: pageSize - firstArtists.length
          })
        : []
    const selectedArtists = [...firstArtists, ...wrappedArtists]
    const selectedIds = selectedArtists.map(({ id }) => id)
    if (selectedIds.length === 0) return []

    const recentArtworkRows =
      previewArtworkSize > 0
        ? await prisma.$queryRaw<Array<{ id: number; artistId: number }>>(
            Prisma.sql`
              WITH selected("artistId", position) AS (
                VALUES ${Prisma.join(selectedIds.map((artistId, position) => Prisma.sql`(${artistId}, ${position})`))}
              )
              SELECT preview.id, preview."artistId"
              FROM selected
              CROSS JOIN LATERAL (
                SELECT a.id, a."artistId", a."sourceDate"
                FROM "Artwork" a
                WHERE a."artistId" = selected."artistId"
                  AND a."deletedAt" IS NULL
                ORDER BY a."sourceDate" DESC, a.id DESC
                LIMIT ${previewArtworkSize}
              ) preview
              ORDER BY selected.position, preview."sourceDate" DESC, preview.id DESC
            `
          )
        : []
    const recentArtworkIds = recentArtworkRows.map(({ id }) => id)
    const recentArtworks =
      recentArtworkIds.length > 0
        ? await prisma.artwork.findMany({
            where: { id: { in: recentArtworkIds }, deletedAt: null },
            select: {
              id: true,
              title: true,
              artistId: true,
              images: {
                select: {
                  path: true,
                  mediaType: true,
                  videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT }
                },
                orderBy: {
                  sortOrder: 'asc'
                },
                take: 1
              }
            }
          })
        : []
    const recentArtworkById = new Map(recentArtworks.map((artwork) => [artwork.id, artwork]))

    const artworkMap = new Map<number, DashboardArtistArtworkPreview[]>()
    for (const { id } of recentArtworkRows) {
      const artwork = recentArtworkById.get(id)
      if (!artwork) continue
      if (artwork.artistId == null) continue
      const bucket = artworkMap.get(artwork.artistId)
      const preview: DashboardArtistArtworkPreview = {
        id: artwork.id,
        title: artwork.title,
        coverUrl: artwork.images[0]
          ? resolveMediaCoverUrl({
              path: artwork.images[0].path,
              mediaType: artwork.images[0].mediaType,
              posterUrl: buildVideoPosterUrl(artwork.images[0].videoMetadata)
            })
          : null,
        coverMediaType: artwork.images[0]
          ? isVideoCoverSource({ path: artwork.images[0].path, mediaType: artwork.images[0].mediaType })
            ? 'video'
            : 'image'
          : null
      }
      if (!bucket) artworkMap.set(artwork.artistId, [preview])
      else bucket.push(preview)
    }

    // 保持随机顺序：按 selectedIds 的顺序输出
    return selectedArtists.map((artist) => ({
      ...ArtistResponseDto.parse(artist),
      recentArtworks: artworkMap.get(artist.id) ?? []
    }))
  } catch (error) {
    logger.error('Error fetching dashboard artists:', error)
    return []
  }
}

/**
 * 创建艺术家
 */
export async function createArtist(data: ArtistCreateSchema): Promise<ArtistResponseDto> {
  const { pixivUserId, ...artistInput } = data
  return prisma.$transaction(async (transaction) => {
    const artist = await transaction.artist.create({
      data: {
        ...artistInput,
        username: artistInput.username || artistInput.name,
        // 旧字段仅作为一个发布周期的回滚镜像；来源判断只读取 ArtistExternalRef。
        userId: pixivUserId ?? null
      }
    })
    if (pixivUserId) {
      await transaction.artistExternalRef.create({
        data: {
          artistId: artist.id,
          providerKey: 'pixiv',
          externalId: pixivUserId,
          canonicalUrl: `https://www.pixiv.net/users/${pixivUserId}`
        }
      })
    }
    const created = await transaction.artist.findUniqueOrThrow({ where: { id: artist.id }, select: ARTIST_SELECT })
    return ArtistResponseDto.parse(created)
  })
}

/**
 * 更新艺术家
 */
export async function updateArtist(id: number, data: ArtistUpdateSchema['data']): Promise<ArtistResponseDto> {
  // 如果更新了 name 且没有显式提供 username，则同步更新 username
  // 注意：前端目前逻辑是 username 始终跟随 name，所以这里我们也可以强制同步
  const { pixivUserId, ...artistInput } = data
  return prisma.$transaction(async (transaction) => {
    if (pixivUserId !== undefined) {
      const current = await transaction.artist.findUniqueOrThrow({
        where: { id },
        select: {
          avatar: true,
          backgroundImg: true,
          externalRefs: { where: { providerKey: 'pixiv' }, select: { externalId: true } }
        }
      })
      const currentPixivUserId = current.externalRefs[0]?.externalId ?? null
      const identityChanged = currentPixivUserId !== null && currentPixivUserId !== pixivUserId
      if (identityChanged && current.avatar && artistInput.avatar === undefined) {
        throw new Error('修改 Pixiv UserID 前请显式清空或重新填写现有头像')
      }
      if (identityChanged && current.backgroundImg && artistInput.backgroundImg === undefined) {
        throw new Error('修改 Pixiv UserID 前请显式清空或重新填写现有背景图')
      }
    }
    await transaction.artist.update({
      where: { id },
      data: {
        ...artistInput,
        ...(artistInput.name && !artistInput.username ? { username: artistInput.name } : {}),
        ...(pixivUserId !== undefined ? { userId: pixivUserId } : {})
      }
    })
    if (pixivUserId === null) {
      await transaction.artistExternalRef.deleteMany({ where: { artistId: id, providerKey: 'pixiv' } })
    } else if (pixivUserId !== undefined) {
      await transaction.artistExternalRef.upsert({
        where: { artistId_providerKey: { artistId: id, providerKey: 'pixiv' } },
        create: {
          artistId: id,
          providerKey: 'pixiv',
          externalId: pixivUserId,
          canonicalUrl: `https://www.pixiv.net/users/${pixivUserId}`
        },
        update: {
          externalId: pixivUserId,
          canonicalUrl: `https://www.pixiv.net/users/${pixivUserId}`,
          sourceName: null,
          status: null,
          normalizedPayload: Prisma.DbNull,
          payloadHash: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          lastError: null,
          lastSystemJobId: null
        }
      })
    }
    const artist = await transaction.artist.findUniqueOrThrow({ where: { id }, select: ARTIST_SELECT })
    return ArtistResponseDto.parse(artist)
  })
}

export async function adoptPixivSourceName(id: number): Promise<ArtistResponseDto> {
  return prisma.$transaction(async (transaction) => {
    const source = await transaction.artistExternalRef.findUnique({
      where: { artistId_providerKey: { artistId: id, providerKey: 'pixiv' } },
      select: { sourceName: true }
    })
    const sourceName = source?.sourceName?.trim()
    if (!sourceName) throw new Error('该艺术家尚无可采用的 Pixiv 来源姓名')
    await transaction.artist.update({ where: { id }, data: { name: sourceName, username: sourceName } })
    const artist = await transaction.artist.findUniqueOrThrow({ where: { id }, select: ARTIST_SELECT })
    return ArtistResponseDto.parse(artist)
  })
}

/**
 * 删除艺术家
 */
export async function deleteArtist(id: number): Promise<void> {
  // 检查是否有关联作品
  const artworksCount = await prisma.artwork.count({
    where: { artistId: id }
  })

  if (artworksCount > 0) {
    throw new Error(`无法删除：该艺术家名下还有 ${artworksCount} 个作品`)
  }

  await prisma.artist.delete({
    where: { id }
  })
}
