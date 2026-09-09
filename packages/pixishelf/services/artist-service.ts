import { activeCreatorMembership, visibleCreatorArtwork } from '@pixishelf/db'
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
          artworkMemberships: { where: { ...activeCreatorMembership, artwork: visibleCreatorArtwork } }
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
  const { pageSize, search, sortBy, cursor, isStarred, pixivStatus } = options
  const page = cursor ?? 1
  try {
    // 限制页面大小，防止过大的查询
    const limitedPageSize = Math.min(100, pageSize)
    const skip = (page - 1) * limitedPageSize

    // 构建搜索条件
    const whereClause: Prisma.ArtistWhereInput = { ...(options.kind ? { kind: options.kind } : {}) }
    if (isStarred !== undefined) {
      whereClause.isStarred = isStarred
    }
    if (pixivStatus) {
      switch (pixivStatus) {
        case 'NO_IDENTITY':
          whereClause.externalRefs = { none: { providerKey: 'pixiv' } }
          break
        case 'UNCHECKED':
          whereClause.externalRefs = { some: { providerKey: 'pixiv', status: null } }
          break
        case 'CHECKED':
          whereClause.externalRefs = { some: { providerKey: 'pixiv', status: { not: null } } }
          break
        default:
          whereClause.externalRefs = { some: { providerKey: 'pixiv', status: pixivStatus } }
      }
    }
    if (search) {
      whereClause.OR = [
        { sourceTagMappings: { some: { sourceName: { contains: search, mode: 'insensitive' } } } },
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
        orderBy = { artworkMemberships: { _count: 'desc' } }
        break
      case 'artworks_asc':
        orderBy = { artworkMemberships: { _count: 'asc' } }
        break
      default:
        orderBy = { name: 'asc' }
    }

    const rankedIds = sortBy.startsWith('artworks_') ? await rankCreators(options, skip, limitedPageSize) : null
    // 并行查询艺术家数据和总数
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: { ...whereClause, ...(rankedIds ? { id: { in: rankedIds } } : {}) },
        select: {
          ...ARTIST_SELECT,
          _count: {
            select: {
              artworkMemberships: { where: { ...activeCreatorMembership, artwork: visibleCreatorArtwork } }
            }
          }
        },
        orderBy,
        skip: rankedIds ? 0 : skip,
        take: limitedPageSize
      }),
      prisma.artist.count({ where: whereClause })
    ])

    // 转换数据格式
    if (rankedIds) artists.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id))
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
  options: { page?: number; pageSize?: number } = {}
): Promise<PaginationResponseData<ArtistResponseDto>> {
  return getArtists(
    ArtistsGetSchema.parse({ cursor: options.page ?? 1, pageSize: options.pageSize ?? 10, sortBy: 'artworks_desc' })
  )
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
          artworkMemberships: { where: { ...activeCreatorMembership, artwork: visibleCreatorArtwork } }
        }
      }
    } as const
    const pivot = minId + Math.floor(Math.random() * (maxId - minId + 1))
    const firstArtists = await prisma.artist.findMany({
      where: {
        id: { gte: pivot },
        artworkMemberships: { some: { ...activeCreatorMembership, artwork: visibleCreatorArtwork } }
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
              artworkMemberships: { some: { ...activeCreatorMembership, artwork: visibleCreatorArtwork } }
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
                SELECT a.id, selected."artistId", COALESCE(a."sourceDate", a."createdAt") AS "sourceDate"
                FROM "Artwork" a
                WHERE EXISTS (SELECT 1 FROM effective_artwork_creators c WHERE c."artworkId"=a.id AND c."artistId"=selected."artistId")
                  AND a."deletedAt" IS NULL AND a."archiveLifecycleState" = 'ACTIVE'
                ORDER BY COALESCE(a."sourceDate", a."createdAt") DESC, a.id DESC
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
    for (const { id, artistId } of recentArtworkRows) {
      const artwork = recentArtworkById.get(id)
      if (!artwork) continue
      const bucket = artworkMap.get(artistId)
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
      if (!bucket) artworkMap.set(artistId, [preview])
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
    if (artistInput.kind !== undefined) {
      const currentKind = await transaction.artist.findUniqueOrThrow({ where: { id }, select: { kind: true } })
      if (currentKind.kind !== artistInput.kind) throw new Error('不能更改现有实体的类型，请新建正确类型并调整映射')
    }
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
    where: { OR: [{ artistId: id }, { creators: { some: { artistId: id } } }] }
  })

  if (artworksCount > 0) {
    throw new Error(`无法删除：该艺术家名下还有 ${artworksCount} 个作品`)
  }

  await prisma.artist.delete({
    where: { id }
  })
}

async function rankCreators(options: ArtistsGetSchema, skip: number, take: number): Promise<number[]> {
  const values: Array<string | number | boolean> = []
  const bind = (value: string | number | boolean) => {
    values.push(value)
    return '$' + values.length
  }
  const clauses = ['TRUE']
  if (options.kind) clauses.push('a.kind::text = ' + bind(options.kind))
  if (options.isStarred !== undefined) clauses.push('a."isStarred" = ' + bind(options.isStarred))
  if (options.search) {
    const p = bind('%' + options.search + '%')
    clauses.push(
      '(a.name ILIKE ' +
        p +
        ' OR a.username ILIKE ' +
        p +
        ' OR EXISTS (SELECT 1 FROM artist_source_tag_mappings sm WHERE sm."artistId"=a.id AND sm."sourceName" ILIKE ' +
        p +
        ')' +
        ' OR EXISTS (SELECT 1 FROM artist_external_refs er WHERE er."artistId"=a.id AND (er."externalId" ILIKE ' +
        p +
        ' OR er."sourceName" ILIKE ' +
        p +
        ')))'
    )
  }
  if (options.pixivStatus) {
    const base = 'SELECT 1 FROM artist_external_refs er WHERE er."artistId"=a.id AND er."providerKey"=\'pixiv\''
    if (options.pixivStatus === 'NO_IDENTITY') clauses.push('NOT EXISTS (' + base + ')')
    else
      {clauses.push(
        'EXISTS (' +
          base +
          ' AND ' +
          (options.pixivStatus === 'UNCHECKED'
            ? 'er.status IS NULL'
            : options.pixivStatus === 'CHECKED'
              ? 'er.status IS NOT NULL'
              : 'er.status::text = ' + bind(options.pixivStatus)) +
          ')'
      )}
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    'SELECT a.id FROM "Artist" a WHERE ' +
      clauses.join(' AND ') +
      ' ORDER BY (SELECT COUNT(*) FROM effective_artwork_creators c JOIN "Artwork" w ON w.id=c."artworkId"' +
      ' WHERE c."artistId"=a.id AND w."deletedAt" IS NULL AND w."archiveLifecycleState"=\'ACTIVE\') ' +
      (options.sortBy === 'artworks_asc' ? 'ASC' : 'DESC') +
      ', a.id ASC LIMIT ' +
      bind(take) +
      ' OFFSET ' +
      bind(skip),
    ...values
  )
  return rows.map((row) => row.id)
}
