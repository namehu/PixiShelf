import 'server-only'

import { EnhancedArtworksResponse } from '@/types'
import { prisma } from '@/lib/prisma'
import { RandomArtworksGetSchema, ArtworkResponseDto } from '@/schemas/artwork.dto'
import { isVideoFile } from '../../../lib/media'
import type { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
import { VIDEO_EXTENSIONS, IMAGE_EXTENSIONS } from '../../../lib/constant'
import { RandomImageItem, RandomImagesResponse } from '@/types/images'
import { guid } from '@/utils/guid'
import { MediaType } from '@/types'
import { combinationApiResource, combinationStaticAvatar } from '@/utils/combinationStatic'
import { getUserArtworkLikeStatus } from '@/services/like-service'
import logger from '@/lib/logger'
import { EMediaType } from '@/enums/EMediaType'
import { shuffleArray, transformImages, transformSingleArtwork } from './utils'
import { fetchRandomIds } from './dao'
import { RandomTagDto } from '@/schemas/tag.dto'
export * from './related'

/**
 * 获取作品列表 (重构版)
 * 使用原生 SQL 处理复杂的过滤、搜索和排序，
 * 同时复用 transformSingleArtwork 确保返回数据格式一致。
 */
export async function getArtworksList(params: ArtworksInfiniteQuerySchema): Promise<EnhancedArtworksResponse> {
  const { cursor, tags, search, artistId, tagId, sortBy, mediaType } = params
  const page = cursor ?? 1
  const pageSize = 24
  const skip = (page - 1) * pageSize

  let whereSQL = 'WHERE 1=1'
  const sqlParams: any[] = []
  let paramIndex = 1

  // 1.1 艺术家筛选
  if (artistId && Number.isFinite(artistId)) {
    whereSQL += ` AND a."artistId" = $${paramIndex}`
    sqlParams.push(artistId)
    paramIndex++
  }

  // 1.2 标签名筛选
  if (tags.length > 0) {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "ArtworkTag" at2
      JOIN "Tag" t2 ON at2."tagId" = t2.id
      WHERE at2."artworkId" = a.id AND t2.name = ANY($${paramIndex})
    )`
    sqlParams.push(tags)
    paramIndex++
  }

  // 1.3 标签ID筛选
  if (tagId && Number.isFinite(tagId)) {
    whereSQL += ` AND EXISTS (
      SELECT 1 FROM "ArtworkTag" at3
      WHERE at3."artworkId" = a.id AND at3."tagId" = $${paramIndex}
    )`
    sqlParams.push(tagId)
    paramIndex++
  }

  // 1.4 文本搜索
  if (search) {
    const searchCondition = `%${search}%`
    whereSQL += ` AND (
      a.title ILIKE $${paramIndex} OR
      a.description ILIKE $${paramIndex} OR
      artist.name ILIKE $${paramIndex}
    )`
    sqlParams.push(searchCondition)
    paramIndex++
  }

  // 1.5 媒体类型筛选 (修复版)
  if (mediaType === 'video' || mediaType === 'image') {
    const extParams = VIDEO_EXTENSIONS.map((ext) => `%${ext}`)

    // 构建类似 LOWER(i.path) LIKE $5 OR LOWER(i.path) LIKE $6 ...
    const likeConditions = VIDEO_EXTENSIONS.map((_, i) => `LOWER(i.path) LIKE $${paramIndex + i}`).join(' OR ')

    const videoCheckSQL = `
      EXISTS (
        SELECT 1 FROM "Image" i
        WHERE i."artworkId" = a.id AND (${likeConditions})
      )
    `

    if (mediaType === 'video') {
      whereSQL += ` AND ${videoCheckSQL}`
    } else {
      whereSQL += ` AND NOT ${videoCheckSQL}`
    }

    sqlParams.push(...extParams)
    paramIndex += VIDEO_EXTENSIONS.length
  }

  // --- 2. 获取总数 ---
  const countQuery = `
    SELECT COUNT(*) as count
    FROM "Artwork" a
    LEFT JOIN "Artist" artist ON a."artistId" = artist.id
    ${whereSQL}
  `
  const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...sqlParams)
  const total = Number(countResult[0]?.count || 0)

  // --- 3. 获取列表 ---
  const orderBySQL = mapSortOptionToSQL(sortBy || 'source_date_desc')

  const artworksQuery = `
    SELECT
      a.*,
      artist.id as artist_id,
      artist.name as artist_name,
      artist.username as artist_username,
      artist."userId" as artist_userId,
      artist.bio as artist_bio,
      artist.avatar as artist_avatar,
      artist."createdAt" as artist_createdAt,
      artist."updatedAt" as artist_updatedAt
    FROM "Artwork" a
    LEFT JOIN "Artist" artist ON a."artistId" = artist.id
    ${whereSQL}
    ${orderBySQL}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `

  // 关键：这里 sqlParams 的顺序必须和上面 whereSQL 里的占位符完全对应
  // 如果上面没有进入 mediaType 判断，paramIndex 就不会乱跳
  sqlParams.push(pageSize, skip)

  const rawArtworks = await prisma.$queryRawUnsafe<any[]>(artworksQuery, ...sqlParams)

  if (rawArtworks.length === 0) {
    return { items: [], total, page, pageSize }
  }

  // ... 后续组装逻辑保持不变
  const artworkIds = rawArtworks.map((a) => a.id)
  const [allImages, allTags] = await Promise.all([
    prisma.image.findMany({
      where: { artworkId: { in: artworkIds } },
      orderBy: { sortOrder: 'asc' }
    }),
    prisma.artworkTag.findMany({
      where: { artworkId: { in: artworkIds } },
      include: { tag: true }
    })
  ])

  const items = rawArtworks.map((raw) => {
    const artistObj = raw.artist_id
      ? {
          id: raw.artist_id,
          name: raw.artist_name,
          username: raw.artist_username,
          userId: raw.artist_userId,
          bio: raw.artist_bio,
          avatar: raw.artist_avatar,
          createdAt: raw.artist_createdAt,
          updatedAt: raw.artist_updatedAt
        }
      : null

    const artworkImages = allImages.filter((img) => img.artworkId === raw.id)
    const artworkTags = allTags.filter((tag) => tag.artworkId === raw.id)

    const prismaLikeObject = {
      ...raw,
      artist: artistObj,
      images: artworkImages,
      artworkTags: artworkTags,
      imageCount: raw.imageCount,
      _count: { images: raw.imageCount }
    }

    return transformSingleArtwork(prismaLikeObject)
  })

  return { items, total, page, pageSize }
}

// 辅助：SQL 排序映射
function mapSortOptionToSQL(sortBy: string): string {
  switch (sortBy) {
    case 'title_asc':
      return 'ORDER BY a.title ASC'
    case 'title_desc':
      return 'ORDER BY a.title DESC'
    case 'artist_asc':
      return 'ORDER BY artist.name ASC'
    case 'artist_desc':
      return 'ORDER BY artist.name DESC'
    case 'images_desc':
      return 'ORDER BY a."imageCount" DESC'
    case 'images_asc':
      return 'ORDER BY a."imageCount" ASC'
    case 'source_date_asc':
      return 'ORDER BY a."sourceDate" ASC'
    case 'source_date_desc':
    default:
      return 'ORDER BY a."sourceDate" DESC'
  }
}

/**
 * 获取推荐作品
 * 逻辑：随机获取ID -> 查详情 -> 按随机顺序重排 -> 数据清洗
 */
export const getRecommendedArtworks = async (
  options: { pageSize?: number; cursor?: number } = {}
): Promise<EnhancedArtworksResponse & { nextCursor?: number }> => {
  const { pageSize = 10, cursor } = options
  const currentPage = cursor || 1

  // 1. 获取随机作品 ID (调用内部数据访问函数)
  const randomIds = await fetchRandomIds(pageSize)

  if (randomIds.length === 0) {
    return { items: [], total: 0, page: currentPage, pageSize, nextCursor: undefined }
  }

  // 2. 查询完整的作品数据
  const artworks = await prisma.artwork.findMany({
    include: defaultArtworkInclude,
    where: { id: { in: randomIds } }
  })

  // 3. 按随机 ID 的顺序重新排序 (因为 SQL WHERE IN 不保证顺序)
  const orderedArtworks = randomIds
    .map((id) => artworks.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  // 4. 转换数据格式
  const items = orderedArtworks.map(transformSingleArtwork)

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
): Promise<EnhancedArtworksResponse> => {
  const { page = 1, pageSize = 10 } = options
  const skip = (page - 1) * pageSize

  // 1. 并行查询作品数据和总数
  const [artworks, total] = await Promise.all([
    prisma.artwork.findMany({
      include: defaultArtworkInclude,
      orderBy: { sourceDate: 'desc' },
      skip: skip,
      take: pageSize
    }),
    prisma.artwork.count()
  ])

  // 2. 转换数据格式
  const items = artworks.map(transformSingleArtwork)
  return {
    items,
    total,
    page,
    pageSize
  }
}

/**
 * 随机获取单张图片作品的业务逻辑
 */
export async function getRandomArtworks(
  input: RandomArtworksGetSchema & { userId: number }
): Promise<RandomImagesResponse> {
  const { cursor, pageSize, count: maxImageCount, mediaType: mediaTypeParam, userId } = input
  const page = cursor ?? 1
  const skip = (page - 1) * pageSize

  // 构建 Prisma 过滤条件：基于文件扩展名进行过滤
  const buildMediaFilter = (type: EMediaType) => {
    if (type === EMediaType.all) {
      return {}
    }
    const exts = type === EMediaType.video ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS
    return {
      images: {
        some: {
          OR: exts.map((ext) => ({ path: { endsWith: ext, mode: 'insensitive' as const } }))
        }
      }
    }
  }

  // 1. 查询所有符合条件的 Artwork 的 ID
  const allArtworkIds = await prisma.artwork.findMany({
    where: {
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
      id: { in: paginatedIds },
      ...buildMediaFilter(mediaTypeParam)
    },
    include: {
      images: {
        take: maxImageCount,
        orderBy: { sortOrder: 'asc' }
      },
      artist: true,
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
  const items: RandomImageItem[] = sortedArtworks.map((raw) => {
    // 先经过标准转换 (处理 APNG/Video 合并等)
    const transformed = transformSingleArtwork(raw)
    const images = transformed.images.map((img: any) => {
      // 逻辑复刻：如果是视频，加上前缀；如果是图片，保持原样(只是文件名)
      // 注意：ArtworkImageResponseDto 中的 mediaType 已经是 'video' | 'image'
      const url = img.mediaType === 'video' ? combinationApiResource(img.path) : img.path

      return { key: guid(), url }
    })

    const imageUrl = images[0]?.url ?? ''
    const isLike = likeStatusMap[transformed.id] ?? false

    // 检查封面图是否是视频
    // 这里需要小心：imageUrl 可能是 "xxx.jpg" 或 "/api/v1/images/xxx.mp4"
    // isVideoFile check path extension.
    const isCoverVideo = isVideoFile(imageUrl)

    return {
      id: transformed.id,
      key: guid(),
      title: transformed.title,
      description: transformed.description || '',
      imageUrl,
      mediaType: isCoverVideo ? MediaType.VIDEO : MediaType.IMAGE,
      images,
      author: transformed.artist
        ? {
            id: transformed.artist.id,
            userId: transformed.artist.userId || '',
            name: transformed.artist.name,
            avatar: combinationStaticAvatar(transformed.artist.userId, transformed.artist.avatar),
            username: transformed.artist.username || ''
          }
        : null,
      createdAt: transformed.createdAt, // string
      tags: raw.artworkTags.map((tg) => RandomTagDto.parse(tg.tag)), // 现在是对象数组了
      isLike
    }
  })

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
 * 根据 ID 获取单个作品详情
 * 包含：所有图片、完整 Tag 信息、Artist 信息
 */
export async function getArtworkById(id: number): Promise<ArtworkResponseDto | null> {
  const artwork = await prisma.artwork.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      artist: true,
      artworkTags: { include: { tag: true } },
      series: {
        include: {
          seriesArtworks: {
            orderBy: { sortOrder: 'asc' },
            include: { artwork: { select: { id: true, title: true } } }
          }
        }
      }
    }
  })

  // Service 层返回 null，由 Controller 决定是 404 还是其他
  if (!artwork) {
    return null
  }

  const { images: enhancedImages, totalMediaSize, imageCount } = transformImages(artwork.images)

  let seriesData = null
  if (artwork.series) {
    const currentItem = artwork.series.seriesArtworks.find(sa => sa.artworkId === id)
    if (currentItem) {
      const currentIndex = artwork.series.seriesArtworks.indexOf(currentItem)
      const prev = currentIndex > 0 ? artwork.series.seriesArtworks[currentIndex - 1] : null
      const next = currentIndex < artwork.series.seriesArtworks.length - 1 ? artwork.series.seriesArtworks[currentIndex + 1] : null
      
      seriesData = {
        id: artwork.series.id,
        title: artwork.series.title,
        order: currentItem.sortOrder,
        prev: prev ? { id: prev.artwork.id, title: prev.artwork.title } : null,
        next: next ? { id: next.artwork.id, title: next.artwork.title } : null
      }
    }
  }

  return ArtworkResponseDto.parse({
    ...artwork,
    imageCount,
    images: enhancedImages,
    tags: artwork.artworkTags.map(({ tag }) => tag),
    totalMediaSize,
    artist: artwork.artist,
    artworkTags: undefined,
    series: seriesData
  })
}

// ==========================================
// Data Access Helpers (内部私有函数 - 相当于 Repository)
// ==========================================

// 定义通用的 Include 对象，减少重复代码
const defaultArtworkInclude = {
  images: { take: 2, orderBy: { sortOrder: 'asc' } }, // 列表页只取一张图
  artist: true,
  artworkTags: { include: { tag: true } },
  _count: { select: { images: true } }
} as const // as const 提供更好的类型推导
