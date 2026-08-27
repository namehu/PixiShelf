import 'server-only'

import { ArtworkCardData, ArtworkCardListResponse, EnhancedArtworksResponse } from '@/types'
import { prisma } from '@/lib/prisma'
import {
  ArtworksInfiniteQuerySchema,
  RandomArtworksGetSchema,
  ArtworkResponseDto,
  ViewerFeedQuerySchema
} from '@/schemas/artwork.dto'
import { isApngFile, isVideoFile } from '@/lib/media'
import { VIDEO_EXTENSIONS } from '@/lib/constant'
import { RandomImageItem, RandomImagesResponse, ViewerFeedResponse } from '@/types/images'
import { guid } from '@/utils/guid'
import { MediaType } from '@/types'
import { combinationApiResource } from '@/utils/combination-static'
import { buildPixivArtistAvatarUrl } from '@/lib/pixiv-data'
import { getUserArtworkLikeStatus } from '@/services/like-service'
import logger from '@/lib/logger'
import { EMediaType } from '@/enums/e-media-type'
import { generateLocalStorageKey, shuffleArray, transformImages, transformSingleArtwork } from './utils'
import { fetchRandomIds } from './dao'
import { RandomTagDto } from '@/schemas/tag.dto'
import { Prisma, ScanRunMode, ScanRunType } from '@prisma/client'
import { buildArtworkWhereClause } from './query-builder'
import fs from 'fs/promises'
import path from 'path'
import { getScanPath } from '@/services/setting.service'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { ESource, type ESource as ArtworkSource } from '@/enums/e-source'
import { appendScanRunItems, completeScanRunSummary, startScanRun } from '@/services/scan-run-service'
import { toApiImageSize } from '@/utils/image-size'
import { buildVideoPosterUrl, VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'
import { requestArchiveArtworkMaintenance } from '@/services/archive/archive-maintenance-service'
import { ARTIST_SELECT } from '@/schemas/models/artists'

const publishedKeyframeSummaryInclude = {
  where: { status: 'PUBLISHED' as const },
  orderBy: { publishedAt: 'desc' as const },
  take: 1,
  select: {
    id: true,
    publishedCount: true,
    sourceSize: true,
    sourceMtimeMs: true
  }
} as const

export * from './related'
export * from './video-chapters'

/**
 * 获取作品列表 (重构版)
 * 使用原生 SQL 处理复杂的过滤、搜索和排序，
 * 同时复用 transformSingleArtwork 确保返回数据格式一致。
 */
export async function getArtworksList(params: ArtworksInfiniteQuerySchema): Promise<EnhancedArtworksResponse> {
  const { cursor } = params
  const page = cursor ?? 1
  const pageSize = params.pageSize
  const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

  // --- 2. 获取总数 ---
  const countQuery = `
    SELECT COUNT(*) as count
    FROM "Artwork" a
    LEFT JOIN "Artist" artist ON a."artistId" = artist.id
    ${whereSQL}
  `
  const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...sqlParams)
  const total = Number(countResult[0]?.count || 0)

  const { rows: rawArtworks } = await queryArtworkRowsPage(params)

  if (rawArtworks.length === 0) {
    return { items: [], total, page, pageSize }
  }

  const items = await hydrateArtworkRows(rawArtworks)

  return { items, total, page, pageSize }
}

async function queryArtworkRowsPage(params: ArtworksInfiniteQuerySchema, overfetch = false) {
  const page = params.cursor ?? 1
  const skip = (page - 1) * params.pageSize
  const { whereSQL, sqlParams, paramIndex: initialParamIndex } = buildArtworkWhereClause(params)
  let paramIndex = initialParamIndex
  const orderBySQL =
    params.sortBy === 'random' && params.randomSeed !== undefined
      ? `ORDER BY md5(a.id::text || $${paramIndex++}) ASC, a.id ASC`
      : mapSortOptionToSQL(params.sortBy || 'source_date_desc')

  if (params.sortBy === 'random' && params.randomSeed !== undefined) {
    sqlParams.push(params.randomSeed.toString())
  }

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT
        a.*,
        artist.id as artist_id,
        artist.name as artist_name,
        artist.username as artist_username,
        artist."userId" as artist_userId,
        artist.bio as artist_bio,
        artist.avatar as artist_avatar,
        artist."backgroundImg" as artist_background_img,
        artist."isStarred" as artist_is_starred,
        artist."createdAt" as artist_createdAt,
        artist."updatedAt" as artist_updatedAt
      FROM "Artwork" a
      LEFT JOIN "Artist" artist ON a."artistId" = artist.id
      ${whereSQL}
      ${orderBySQL}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    ...sqlParams,
    params.pageSize + (overfetch ? 1 : 0),
    skip
  )

  return {
    rows: overfetch ? rows.slice(0, params.pageSize) : rows,
    hasNextPage: overfetch && rows.length > params.pageSize
  }
}

async function hydrateArtworkRows(rawArtworks: any[]) {
  if (rawArtworks.length === 0) return []

  const artworkIds = rawArtworks.map((a) => a.id)
  const artistIds = [...new Set(rawArtworks.map((artwork) => artwork.artist_id).filter(Boolean))] as number[]
  const [allImages, allTags, artistExternalRefs, localArtistMappings, artworkExternalRefs] = await Promise.all([
    prisma.image.findMany({
      where: { artworkId: { in: artworkIds } },
      orderBy: { sortOrder: 'asc' },
      include: { videoMetadata: true, keyframeSets: publishedKeyframeSummaryInclude }
    }),
    prisma.artworkTag.findMany({
      where: { artworkId: { in: artworkIds } },
      include: { tag: true }
    }),
    prisma.artistExternalRef.findMany({
      where: { artistId: { in: artistIds } },
      select: {
        id: true,
        artistId: true,
        providerKey: true,
        externalId: true,
        sourceName: true,
        status: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
        lastErrorCode: true,
        lastError: true,
        lastSystemJobId: true
      }
    }),
    prisma.localImportArtistMapping.findMany({
      where: { artistId: { in: artistIds } },
      select: { id: true, artistId: true }
    }),
    prisma.artworkExternalRef.findMany({
      where: { artworkId: { in: artworkIds } },
      select: {
        id: true,
        artworkId: true,
        providerKey: true,
        externalId: true,
        status: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
        lastErrorCode: true,
        lastError: true,
        lastSystemJobId: true,
        onlineSnapshotHash: true,
        onlineSnapshotPath: true
      }
    })
  ])

  const imagesByArtwork = new Map<number, (typeof allImages)[number][]>()
  for (const image of allImages) {
    const images = imagesByArtwork.get(image.artworkId!) ?? []
    images.push(image)
    imagesByArtwork.set(image.artworkId!, images)
  }
  const tagsByArtwork = new Map<number, (typeof allTags)[number][]>()
  for (const tag of allTags) {
    const tags = tagsByArtwork.get(tag.artworkId) ?? []
    tags.push(tag)
    tagsByArtwork.set(tag.artworkId, tags)
  }
  const externalRefsByArtist = new Map<number, typeof artistExternalRefs>()
  for (const ref of artistExternalRefs) {
    const refs = externalRefsByArtist.get(ref.artistId) ?? []
    refs.push(ref)
    externalRefsByArtist.set(ref.artistId, refs)
  }
  const localMappingsByArtist = new Map<number, Array<{ id: number }>>()
  for (const mapping of localArtistMappings) {
    const mappings = localMappingsByArtist.get(mapping.artistId) ?? []
    mappings.push({ id: mapping.id })
    localMappingsByArtist.set(mapping.artistId, mappings)
  }
  const externalRefsByArtwork = new Map<number, typeof artworkExternalRefs>()
  for (const ref of artworkExternalRefs) {
    const refs = externalRefsByArtwork.get(ref.artworkId) ?? []
    refs.push(ref)
    externalRefsByArtwork.set(ref.artworkId, refs)
  }

  return rawArtworks.map((raw) => {
    const artistObj = raw.artist_id
      ? {
          id: raw.artist_id,
          name: raw.artist_name,
          username: raw.artist_username,
          userId: raw.artist_userId,
          bio: raw.artist_bio,
          avatar: raw.artist_avatar,
          backgroundImg: raw.artist_background_img,
          isStarred: raw.artist_is_starred,
          createdAt: raw.artist_createdAt,
          updatedAt: raw.artist_updatedAt,
          externalRefs: externalRefsByArtist.get(raw.artist_id) ?? [],
          localImportMappings: localMappingsByArtist.get(raw.artist_id) ?? []
        }
      : null

    const artworkImages = imagesByArtwork.get(raw.id) ?? []
    const artworkTags = tagsByArtwork.get(raw.id) ?? []

    const prismaLikeObject = {
      ...raw,
      artist: artistObj,
      images: artworkImages,
      artworkTags: artworkTags,
      externalRefs: externalRefsByArtwork.get(raw.id) ?? [],
      imageCount: raw.imageCount,
      _count: { images: raw.imageCount }
    }

    return transformSingleArtwork(prismaLikeObject)
  })
}

export interface ArtworkCardsPageResponse {
  items: ArtworkCardData[]
  total?: number
  page: number
  pageSize: number
  hasNextPage: boolean
}

/**
 * 获取普通作品列表卡片。
 *
 * 这里只返回 ArtworkCard 所需字段，并把每个作品的媒体关系限制为封面一条。
 * 第一页保留精确总数；后续页多取一条记录判断是否还有下一页，避免重复 COUNT。
 */
export async function getArtworkCardsPage(params: ArtworksInfiniteQuerySchema): Promise<ArtworkCardsPageResponse> {
  const { cursor, sortBy } = params
  const page = cursor ?? 1
  const pageSize = params.pageSize
  const skip = (page - 1) * pageSize

  let { whereSQL, sqlParams, paramIndex } = buildArtworkWhereClause(params)
  const countParams = [...sqlParams]
  const countQuery = `
    SELECT COUNT(*) as count
    FROM "Artwork" a
    LEFT JOIN "Artist" artist ON a."artistId" = artist.id
    ${whereSQL}
  `

  let orderBySQL: string
  if (sortBy === 'random' && params.randomSeed !== undefined) {
    orderBySQL = `ORDER BY md5(a.id::text || $${paramIndex}) ASC, a.id ASC`
    sqlParams.push(params.randomSeed.toString())
    paramIndex++
  } else {
    orderBySQL = mapSortOptionToSQL(sortBy || 'source_date_desc')
  }

  const idQuery = `
    SELECT a.id
    FROM "Artwork" a
    LEFT JOIN "Artist" artist ON a."artistId" = artist.id
    ${whereSQL}
    ${orderBySQL}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `
  sqlParams.push(pageSize + 1, skip)

  const [countResult, rawIdRows] = await Promise.all([
    page === 1 ? prisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...countParams) : Promise.resolve(undefined),
    prisma.$queryRawUnsafe<Array<{ id: number }>>(idQuery, ...sqlParams)
  ])

  const visibleIdRows = rawIdRows.slice(0, pageSize)
  const artworkIds = visibleIdRows.map(({ id }) => id)
  const artworks =
    artworkIds.length > 0
      ? await prisma.artwork.findMany({
          where: { id: { in: artworkIds } },
          select: artworkCardSelect
        })
      : []
  const resolvedArtworks = await resolveArtworkCardCovers(artworks)
  const artworkById = new Map(resolvedArtworks.map((artwork) => [artwork.id, artwork]))
  const items = artworkIds
    .map((id) => artworkById.get(id))
    .filter((artwork): artwork is NonNullable<typeof artwork> => artwork !== undefined)
    .map(transformArtworkCard)

  return {
    items,
    total: countResult ? Number(countResult[0]?.count || 0) : undefined,
    page,
    pageSize,
    hasNextPage: rawIdRows.length > pageSize
  }
}

/**
 * 删除作品
 * 级联删除逻辑：
 * 1. 物理删除关联的图片文件
 * 2. 删除 Image 表记录 (无数据库级联)
 * 3. 删除 Artwork 表记录 (数据库级联删除 ArtworkTag, ArtworkLike, SeriesArtwork)
 */
export async function deleteArtwork(id: number, options: { requestedByUserId: string }) {
  const artwork = await prisma.artwork.findUnique({ where: { id } })
  if (!artwork) throw new Error(`Artwork ${id} not found`)
  if (artwork.createdVia === 'URL_ARCHIVE') {
    await requestArchiveArtworkMaintenance({
      artworkId: id,
      action: 'TRASH_ARCHIVE',
      requestedByUserId: options.requestedByUserId
    })
    return prisma.artwork.findUniqueOrThrow({ where: { id } })
  }

  // 1. 获取关联图片
  const images = await prisma.image.findMany({
    where: { artworkId: id }
  })

  // 2. 尝试删除物理文件
  const scanRoot = await getScanPath()
  if (scanRoot && images.length > 0) {
    await Promise.all(
      images.map(async (img) => {
        const pathsToDelete: string[] = []

        if (img.path) {
          pathsToDelete.push(img.path)
        }

        if (img.chaptersPath && isChapterManifestFileName(path.basename(img.chaptersPath))) {
          pathsToDelete.push(img.chaptersPath)
        }

        await Promise.all(
          pathsToDelete.map(async (relativePath) => {
            const absolutePath = resolvePathWithinScanRoot(scanRoot, relativePath)
            try {
              await fs.unlink(absolutePath)
            } catch (e: any) {
              // 忽略文件不存在等错误
              logger.warn(`[DeleteArtwork] Failed to delete file: ${absolutePath}, error: ${e.message}`)
            }
          })
        )
      })
    )
    // TODO: 删除关联文件夹
  }

  // 3. 删除图片记录 (显式删除，因为没有级联)
  await prisma.image.deleteMany({
    where: { artworkId: id }
  })

  // 4. 删除作品
  return prisma.artwork.delete({
    where: { id }
  })
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}

/**
 * 更新作品
 */
export async function updateArtwork(
  id: number,
  data: {
    title?: string
    description?: string
    artistId?: number | null
    tags?: number[]
    sourceDate?: Date | string | null
  }
) {
  const { tags, artistId, sourceDate, ...rest } = data

  const updateData: Prisma.ArtworkUpdateInput = { ...rest }

  if (sourceDate !== undefined) {
    updateData.sourceDate = typeof sourceDate === 'string' ? new Date(sourceDate) : sourceDate
  }

  if (artistId !== undefined) {
    updateData.artist = artistId ? { connect: { id: artistId } } : { disconnect: true }
  }

  return prisma.$transaction(async (tx) => {
    if (data.title !== undefined || data.description !== undefined) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Artwork" WHERE "id" = ${id} FOR UPDATE`)
      const current = await tx.artwork.findUniqueOrThrow({
        where: { id },
        select: { title: true, description: true }
      })
      if (data.title !== undefined && data.title !== current.title) updateData.titleOverridden = true
      if (data.description !== undefined && data.description !== current.description) {
        updateData.descriptionOverridden = true
      }
    }
    const artwork = await tx.artwork.update({ where: { id }, data: updateData })
    if (tags !== undefined) {
      await tx.artworkTag.deleteMany({
        where: { artworkId: id, provenance: { in: ['MANUAL', 'LEGACY'] } }
      })
      if (tags.length > 0) {
        await tx.artworkTag.createMany({
          data: tags.map((tagId) => ({ artworkId: id, tagId, provenance: 'MANUAL' as const })),
          skipDuplicates: true
        })
      }
    }
    return artwork
  })
}

/**
 * 创建作品
 */
export async function createArtwork(data: {
  title: string
  description?: string
  artistId?: number | null
  tags?: number[]
  source?: ArtworkSource
  sourceDate?: Date | string | null
}) {
  const { tags, artistId, source, sourceDate, ...rest } = data
  const effectiveSource = source ?? ESource.LOCAL_CREATED

  const artwork = await prisma.$transaction(async (tx) => {
    const created = await tx.artwork.create({
      data: {
        ...rest,
        sourceDate: typeof sourceDate === 'string' ? new Date(sourceDate) : sourceDate,
        source: effectiveSource,
        createdVia: effectiveSource === ESource.LOCAL_CREATED ? 'MANUAL_CREATE' : 'UNKNOWN',
        artist: artistId ? { connect: { id: artistId } } : undefined,
        artworkTags:
          tags && tags.length > 0
            ? {
                create: tags.map((tagId) => ({ tagId, provenance: 'MANUAL' }))
              }
            : undefined
      }
    })
    if (effectiveSource !== ESource.LOCAL_CREATED) return created
    return tx.artwork.update({
      where: { id: created.id },
      data: { storageKey: generateLocalStorageKey(created.id) }
    })
  })

  if (effectiveSource === ESource.LOCAL_CREATED && artwork.storageKey) {
    await recordLocalCreateAudit({
      artworkId: artwork.id,
      title: artwork.title,
      storageKey: artwork.storageKey
    })
  }

  const result = await getArtworkById(artwork.id)
  return result!
}

async function recordLocalCreateAudit(input: { artworkId: number; title: string; storageKey: string }) {
  try {
    const scanRun = await startScanRun({
      type: ScanRunType.LOCAL_CREATE,
      mode: ScanRunMode.LOCAL_CREATE
    })
    await appendScanRunItems([
      {
        scanRunId: scanRun.id,
        externalId: input.storageKey,
        title: input.title,
        status: 'SUCCESS',
        action: 'CREATE',
        mediaCount: 0,
        newImageCount: 0,
        finishedAt: new Date()
      }
    ])
    await completeScanRunSummary(scanRun.id, {
      totalArtworks: 1,
      newImages: 0
    })
  } catch (error) {
    logger.error('Failed to record local artwork creation audit', { error, artworkId: input.artworkId })
  }
}

/**
 * 获取没有系列的作品的 External ID 列表
 */
export async function getNoSeriesArtworkExternalIds(): Promise<string[]> {
  const artworks = await prisma.artwork.findMany({
    where: {
      deletedAt: null,
      seriesArtworks: {
        none: { excludedAt: null }
      },
      externalId: {
        not: null
      }
    },
    select: {
      externalId: true
    }
  })

  return artworks.map((a) => a.externalId).filter((id): id is string => id !== null)
}

// 辅助：SQL 排序映射
function mapSortOptionToSQL(sortBy: string): string {
  switch (sortBy) {
    case 'title_asc':
      return 'ORDER BY a.title ASC, a.id ASC'
    case 'title_desc':
      return 'ORDER BY a.title DESC, a.id DESC'
    case 'artist_asc':
      return 'ORDER BY artist.name ASC, a.id ASC'
    case 'artist_desc':
      return 'ORDER BY artist.name DESC, a.id DESC'
    case 'images_desc':
      return 'ORDER BY a."imageCount" DESC, a.id DESC'
    case 'images_asc':
      return 'ORDER BY a."imageCount" ASC, a.id ASC'
    case 'source_date_asc':
      return 'ORDER BY a."sourceDate" ASC, a.id ASC'
    case 'created_at_desc':
      return 'ORDER BY a."createdAt" DESC, a.id DESC'
    case 'created_at_asc':
      return 'ORDER BY a."createdAt" ASC, a.id ASC'
    case 'source_date_desc':
    default:
      return 'ORDER BY a."sourceDate" DESC, a.id DESC'
  }
}

/**
 * 获取推荐作品
 * 逻辑：随机获取ID -> 查详情 -> 按随机顺序重排 -> 数据清洗
 */
export const getRecommendedArtworks = async (
  options: { pageSize?: number; cursor?: number; tagNames?: string[] } = {}
): Promise<ArtworkCardListResponse & { nextCursor?: number }> => {
  const { pageSize = 10, cursor, tagNames } = options
  const currentPage = cursor || 1

  // 1. 获取随机作品 ID (调用内部数据访问函数)
  const randomIds = await fetchRandomIds(pageSize, tagNames)

  if (randomIds.length === 0) {
    return { items: [], total: 0, page: currentPage, pageSize, nextCursor: undefined }
  }

  // 2. 卡片只查询渲染所需字段，避免把描述和完整关联序列化进 RSC/TRPC。
  const artworks = await prisma.artwork.findMany({
    select: artworkCardSelect,
    where: { id: { in: randomIds }, deletedAt: null }
  })
  const resolvedArtworks = await resolveArtworkCardCovers(artworks)

  // 3. 按随机 ID 的顺序重新排序 (因为 SQL WHERE IN 不保证顺序)
  const orderedArtworks = randomIds
    .map((id) => resolvedArtworks.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  // 4. 转换数据格式
  const items = orderedArtworks.map(transformArtworkCard)

  return {
    items,
    total: items.length, // 随机推荐不返回真实总数
    page: currentPage,
    pageSize,
    nextCursor: currentPage + 1 // 总是返回下一页 cursor，实现无限滚动
  }
}

/**
 * 获取最新作品
 * 逻辑：并行查询列表和总数 -> 数据清洗
 */
export const getRecentArtworks = async (
  options: { page?: number; pageSize?: number } = {}
): Promise<ArtworkCardListResponse> => {
  const { page = 1, pageSize = 10 } = options
  const skip = (page - 1) * pageSize

  // 1. 并行查询作品数据和总数
  const [artworks, total] = await Promise.all([
    prisma.artwork.findMany({
      where: { deletedAt: null },
      select: artworkCardSelect,
      orderBy: { sourceDate: 'desc' },
      skip: skip,
      take: pageSize
    }),
    prisma.artwork.count({ where: { deletedAt: null } })
  ])

  // 2. 转换数据格式
  const resolvedArtworks = await resolveArtworkCardCovers(artworks)
  const items = resolvedArtworks.map(transformArtworkCard)
  return {
    items,
    total,
    page,
    pageSize
  }
}

/**
 * 获取首页最新作品。
 * 首页不展示总数，因此省略 PostgreSQL 需要扫描可见行的精确 COUNT。
 */
export const getDashboardRecentArtworks = async (
  options: { pageSize?: number } = {}
): Promise<ArtworkCardListResponse> => {
  const { pageSize = 10 } = options
  const artworks = await prisma.artwork.findMany({
    where: { deletedAt: null },
    select: artworkCardSelect,
    orderBy: [{ sourceDate: 'desc' }, { id: 'desc' }],
    take: pageSize
  })
  const resolvedArtworks = await resolveArtworkCardCovers(artworks)
  const items = resolvedArtworks.map(transformArtworkCard)

  return {
    items,
    total: items.length,
    page: 1,
    pageSize
  }
}

/**
 * 随机获取单张图片作品的业务逻辑
 */
export async function getRandomArtworks(
  input: RandomArtworksGetSchema & { userId: string }
): Promise<RandomImagesResponse> {
  const { cursor, pageSize, count: maxImageCount, mediaType: mediaTypeParam, userId } = input
  const page = cursor ?? 1
  const skip = (page - 1) * pageSize

  // 粗粒度图片/视频筛选只读取持久化的媒体类型。
  const buildMediaFilter = (type: EMediaType) => {
    if (type === EMediaType.all) {
      return {}
    }
    return {
      images: {
        ...(type === EMediaType.video
          ? { some: { mediaType: 'VIDEO' as const } }
          : { none: { mediaType: 'VIDEO' as const } })
      }
    }
  }

  // 1. 查询所有符合条件的 Artwork 的 ID
  const allArtworkIds = await prisma.artwork.findMany({
    where: {
      deletedAt: null,
      imageCount: { lte: maxImageCount },
      ...buildMediaFilter(mediaTypeParam)
    },
    select: { id: true },
    orderBy: {
      id: 'asc'
    }
  })

  const total = allArtworkIds.length

  if (total === 0) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      nextPage: null
    }
  }

  // 2. 在应用层对所有 ID 进行随机排序
  const shuffledIds = shuffleArray(allArtworkIds.map((a) => a.id))

  // 3. 分页
  const paginatedIds = shuffledIds.slice(skip, skip + pageSize)

  if (paginatedIds.length === 0) {
    return {
      items: [],
      total,
      page,
      pageSize,
      nextPage: null
    }
  }

  // 4. 查询完整数据
  const artworks = await prisma.artwork.findMany({
    where: {
      deletedAt: null,
      id: { in: paginatedIds },
      ...buildMediaFilter(mediaTypeParam)
    },
    include: {
      images: {
        take: maxImageCount,
        orderBy: { sortOrder: 'asc' },
        include: { videoMetadata: true, keyframeSets: publishedKeyframeSummaryInclude }
      },
      artist: { select: ARTIST_SELECT },
      artworkTags: { include: { tag: true } }
    }
  })

  // 5. 保持随机顺序
  const sortedArtworks = artworks.sort((a, b) => paginatedIds.indexOf(a.id) - paginatedIds.indexOf(b.id))

  // 6. 批量获取点赞状态
  let likeStatusMap: Record<number, boolean> = {}
  try {
    if (userId) {
      likeStatusMap = await getUserArtworkLikeStatus(userId, paginatedIds)
    }
  } catch (_error) {
    logger.error('批量获取点赞状态失败:', _error)
  }

  // 7. 转换数据 (使用 transformSingleArtwork 统一逻辑)
  const items: RandomImageItem[] = sortedArtworks.map((raw) =>
    toViewerImageItem(transformSingleArtwork(raw), likeStatusMap)
  )

  const nextPage = skip + pageSize < total ? page + 1 : null

  return {
    items,
    total,
    page,
    pageSize,
    nextPage
  }
}

/**
 * 获取沉浸浏览 Feed
 * 支持从全站、艺术家、标签等上下文进入，并在顺序/稳定随机之间切换。
 */
export async function getViewerFeed(input: ViewerFeedQuerySchema & { userId: string }): Promise<ViewerFeedResponse> {
  const {
    cursor,
    pageSize,
    source,
    sourceId,
    mode,
    sortBy,
    randomSeed,
    search,
    artistId,
    tagIds,
    sources,
    hasAudio,
    mediaType,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    mediaCountMax,
    userId
  } = input

  const page = cursor ?? 1

  const listInput = ArtworksInfiniteQuerySchema.parse({
    cursor: page,
    pageSize,
    artistId: artistId ?? (source === 'artist' ? sourceId : undefined),
    tagIds: tagIds.length > 0 ? tagIds : source === 'tag' && sourceId ? [sourceId] : [],
    sources,
    hasAudio,
    search,
    mediaType,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    mediaCountMax,
    sortBy: mode === 'random' ? 'random' : sortBy || 'source_date_desc',
    randomSeed: mode === 'random' ? randomSeed : undefined
  })
  const { rows, hasNextPage } = await queryArtworkRowsPage(listInput, true)
  const artworks = await hydrateArtworkRows(rows)

  const artworkIds = artworks.map((item) => item.id)
  let likeStatusMap: Record<number, boolean> = {}
  try {
    if (userId && artworkIds.length > 0) {
      likeStatusMap = await getUserArtworkLikeStatus(userId, artworkIds)
    }
  } catch (_error) {
    logger.error('批量获取点赞状态失败:', _error)
  }

  const items = artworks.map((item) => toViewerImageItem(item, likeStatusMap))

  return {
    items,
    page,
    pageSize,
    nextPage: hasNextPage ? page + 1 : null
  }
}

export function toViewerImageItem(artwork: any, likeStatusMap: Record<number, boolean>): RandomImageItem {
  const images = (artwork.images || []).map((img: any) => {
    // 沉浸浏览需要真实视频地址供播放器播放，封面仅用于列表卡片。
    const mediaType = img.mediaType === 'video' || isVideoFile(img.path ?? '') ? MediaType.VIDEO : MediaType.IMAGE
    const url = mediaType === MediaType.VIDEO ? combinationApiResource(img.path) : img.path

    return {
      id: img.id,
      key: String(img.id),
      url,
      mediaType,
      updatedAt:
        img.updatedAt instanceof Date
          ? img.updatedAt.toISOString()
          : typeof img.updatedAt === 'string'
            ? img.updatedAt
            : '',
      size: typeof img.size === 'number' ? img.size : null,
      width: typeof img.width === 'number' ? img.width : null,
      height: typeof img.height === 'number' ? img.height : null,
      isAnimated: img.isAnimated === true,
      chaptersUrl: mediaType === MediaType.VIDEO ? (img.chaptersUrl ?? null) : null,
      chaptersCount: mediaType === MediaType.VIDEO ? (img.chaptersCount ?? 0) : 0,
      keyframesUrl: mediaType === MediaType.VIDEO ? (img.keyframesUrl ?? null) : null,
      hasKeyframes: mediaType === MediaType.VIDEO ? img.hasKeyframes === true : false,
      keyframeCount: mediaType === MediaType.VIDEO ? (img.keyframeCount ?? 0) : 0,
      hasAudio: mediaType === MediaType.VIDEO ? (img.hasAudio ?? null) : null,
      duration: mediaType === MediaType.VIDEO ? (img.duration ?? null) : null
    }
  })

  const imageUrl = images[0]?.url ?? ''
  const isCoverVideo = images[0]?.mediaType === MediaType.VIDEO
  const artist = artwork.artist
  const pixivUserId = artist?.externalRefs?.find(
    (ref: { providerKey: string }) => ref.providerKey === 'pixiv'
  )?.externalId

  return {
    id: artwork.id,
    key: guid(),
    title: artwork.title,
    description: artwork.description || '',
    imageUrl,
    mediaType: isCoverVideo ? MediaType.VIDEO : MediaType.IMAGE,
    images,
    author: artist
      ? {
          id: artist.id,
          userId: pixivUserId || '',
          name: artist.name,
          avatar: buildPixivArtistAvatarUrl(pixivUserId, artist.avatar),
          username: artist.username || ''
        }
      : null,
    createdAt: typeof artwork.createdAt === 'string' ? artwork.createdAt : (artwork.createdAt?.toISOString?.() ?? ''),
    tags: (artwork.tags || []).map((tag: any) => RandomTagDto.parse(tag)),
    isLike: likeStatusMap[artwork.id] ?? false
  }
}

/**
 * 根据 ID 获取单个作品详情
 * 包含：所有图片、完整 Tag 信息、Artist 信息
 */
export async function getArtworkById(id: number): Promise<ArtworkResponseDto | null> {
  const artwork = await prisma.artwork.findUnique({
    where: { id, deletedAt: null },
    include: {
      images: {
        orderBy: { sortOrder: 'asc' },
        include: { videoMetadata: true, keyframeSets: publishedKeyframeSummaryInclude }
      },
      artist: { select: ARTIST_SELECT },
      externalRefs: {
        select: {
          id: true,
          providerKey: true,
          externalId: true,
          status: true,
          lastAttemptAt: true,
          lastSuccessAt: true,
          lastErrorCode: true,
          lastError: true,
          lastSystemJobId: true,
          onlineSnapshotHash: true,
          onlineSnapshotPath: true
        }
      },
      artworkTags: { include: { tag: true } },
      seriesArtworks: {
        where: { excludedAt: null },
        orderBy: { seriesId: 'asc' },
        include: {
          series: {
            include: {
              seriesArtworks: {
                where: { excludedAt: null, artwork: { deletedAt: null } },
                orderBy: { sortOrder: 'asc' },
                include: { artwork: { select: { id: true, title: true } } }
              }
            }
          }
        }
      }
    }
  })

  // 服务层返回 null，由控制器决定响应 404 还是其他状态。
  if (!artwork) {
    return null
  }

  const { images: enhancedImages, totalMediaSize, imageCount } = transformImages(artwork.images)

  const seriesData = artwork.seriesArtworks.flatMap((membership) => {
    const currentItem = membership.series.seriesArtworks.find((item) => item.artworkId === id)
    if (currentItem) {
      const currentIndex = membership.series.seriesArtworks.indexOf(currentItem)
      const prev = currentIndex > 0 ? membership.series.seriesArtworks[currentIndex - 1] : null
      const next =
        currentIndex < membership.series.seriesArtworks.length - 1
          ? membership.series.seriesArtworks[currentIndex + 1]
          : null

      return [{
        id: membership.series.id,
        title: membership.series.title,
        order: currentItem.sortOrder,
        prev: prev ? { id: prev.artwork.id, title: prev.artwork.title } : null,
        next: next ? { id: next.artwork.id, title: next.artwork.title } : null
      }]
    }
    return []
  })

  return ArtworkResponseDto.parse({
    ...artwork,
    imageCount,
    images: enhancedImages,
    tags: artwork.artworkTags.map(({ tag }) => tag),
    totalMediaSize,
    artist: artwork.artist,
    artworkTags: undefined,
    seriesArtworks: undefined,
    series: seriesData
  })
}

// ==========================================
// 数据访问辅助函数（内部私有函数，等同于 Repository）
// ==========================================

const artworkCardSelect = {
  id: true,
  title: true,
  imageCount: true,
  images: {
    take: 1,
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      artworkId: true,
      path: true,
      size: true,
      mediaType: true,
      videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT }
    }
  },
  artist: {
    select: {
      name: true
    }
  },
  artworkTags: {
    select: {
      tag: {
        select: {
          name: true
        }
      }
    }
  }
} as const

type ArtworkCardQueryRow = Prisma.ArtworkGetPayload<{ select: typeof artworkCardSelect }>
type ArtworkCardMediaRow = ArtworkCardQueryRow['images'][number]

/**
 * APNG 和同名 WebM/MP4 是一个逻辑媒体的两种表示。
 * 常规卡片只读取一条封面；仅当该封面是 APNG 时，才为当前批次补查视频伙伴。
 */
async function resolveArtworkCardCovers(artworks: ArtworkCardQueryRow[]): Promise<ArtworkCardQueryRow[]> {
  const apngCovers = artworks
    .map((artwork) => artwork.images[0])
    .filter((image): image is ArtworkCardMediaRow => Boolean(image && isApngFile(image.path)))

  if (apngCovers.length === 0) {
    return artworks
  }

  const artworkIds = artworks
    .filter((artwork) => artwork.images[0] && isApngFile(artwork.images[0].path))
    .map((artwork) => artwork.id)
  const videoCandidates = await prisma.image.findMany({
    where: {
      artworkId: { in: artworkIds },
      OR: [
        { mediaType: 'VIDEO' },
        ...VIDEO_EXTENSIONS.map((extension) => ({
          path: { endsWith: extension, mode: 'insensitive' as const }
        }))
      ]
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: artworkCardSelect.images.select
  })

  const videoByLogicalPath = new Map<string, ArtworkCardMediaRow>()
  for (const video of videoCandidates) {
    if (video.artworkId === null) continue
    const key = getLogicalMediaKey(video.artworkId, video.path)
    if (!videoByLogicalPath.has(key) && (video.mediaType === 'VIDEO' || isVideoFile(video.path))) {
      videoByLogicalPath.set(key, video)
    }
  }

  return artworks.map((artwork) => {
    const cover = artwork.images[0]
    if (!cover || !isApngFile(cover.path)) {
      return artwork
    }

    const videoCover = videoByLogicalPath.get(getLogicalMediaKey(artwork.id, cover.path))
    return videoCover ? { ...artwork, images: [videoCover] } : artwork
  })
}

function getLogicalMediaKey(artworkId: number, mediaPath: string): string {
  const normalizedPath = mediaPath
    .replace(/\\/g, '/')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
  return `${artworkId}:${normalizedPath}`
}

function transformArtworkCard(artwork: {
  id: number
  title: string
  imageCount: number
  images: Array<{
    id: number
    artworkId: number | null
    path: string
    size: number | bigint | null
    mediaType: string
    videoMetadata: { posterStatus: string; posterPath: string | null; posterUpdatedAt: Date | null } | null
  }>
  artist: { name: string } | null
  artworkTags: Array<{ tag: { name: string } }>
}): ArtworkCardData {
  const images = artwork.images.map((image) => ({
    path: image.path,
    size: toApiImageSize(image.size),
    mediaType: image.mediaType === 'VIDEO' || isVideoFile(image.path) ? ('video' as const) : ('image' as const),
    posterUrl: buildVideoPosterUrl(image.videoMetadata)
  }))

  return {
    id: artwork.id,
    title: artwork.title,
    imageCount: images.some((image) => image.mediaType === 'video') ? 0 : artwork.imageCount,
    totalMediaSize: images.reduce((total, image) => total + (image.size ?? 0), 0),
    images,
    artist: artwork.artist,
    tags: artwork.artworkTags.map(({ tag }) => tag)
  }
}
