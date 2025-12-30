import 'server-only'

import path from 'path'
import { EnhancedArtworksResponse } from '@/types'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { ArtworkResponseDto, ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { TImageModel } from '@/schemas/models'
import { isApngFile, isVideoFile } from '../../lib/media'
import type { ArtworksQuerySchema } from '@/schemas/api/artwork'
import { VIDEO_EXTENSIONS } from '../../lib/constant'

// 提取常量
// ==========================================
// Types & Interfaces
// ==========================================

interface GetRecommendedArtworksOptions {
  pageSize?: number
}

interface GetRecentArtworksOptions {
  page?: number
  pageSize?: number
}

// ==========================================
// Public Service Functions (业务逻辑层)
// ==========================================

/**
 * 获取作品列表 (重构版)
 * 使用原生 SQL 处理复杂的过滤、搜索和排序，
 * 同时复用 transformSingleArtwork 确保返回数据格式一致。
 */
export async function getArtworksList(params: ArtworksQuerySchema): Promise<EnhancedArtworksResponse> {
  const { page, pageSize, tags, search, artistId, tagId, sortBy, mediaType } = params
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
  options: GetRecommendedArtworksOptions = {}
): Promise<EnhancedArtworksResponse> => {
  const { pageSize = 10 } = options

  // 1. 获取随机作品 ID (调用内部数据访问函数)
  const randomIds = await fetchRandomIds(pageSize)

  if (randomIds.length === 0) {
    return { items: [], total: 0, page: 1, pageSize }
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
    total: items.length,
    page: 1,
    pageSize
  }
}

/**
 * 获取最新作品
 * 逻辑：并行查询列表和总数 -> 数据清洗
 */
export const getRecentArtworks = async (options: GetRecentArtworksOptions = {}): Promise<EnhancedArtworksResponse> => {
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
 * 根据 ID 获取单个作品详情
 * 包含：所有图片、完整 Tag 信息、Artist 信息
 */
export async function getArtworkById(id: number): Promise<ArtworkResponseDto | null> {
  const artwork = await prisma.artwork.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      artist: true,
      artworkTags: { include: { tag: true } }
    }
  })

  // Service 层返回 null，由 Controller 决定是 404 还是其他
  if (!artwork) {
    return null
  }

  const { images: enhancedImages, totalMediaSize, imageCount } = transformImages(artwork.images)

  return ArtworkResponseDto.parse({
    ...artwork,
    imageCount,
    images: enhancedImages,
    tags: artwork.artworkTags.map(({ tag }) => tag),
    totalMediaSize,
    artist: artwork.artist,
    artworkTags: undefined
  })
}

// ==========================================
// Data Access Helpers (内部私有函数 - 相当于 Repository)
// ==========================================

/**
 * 使用原生 SQL 随机获取作品 ID
 */
async function fetchRandomIds(limit: number): Promise<number[]> {
  const randomIdsResult = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${limit}`
  )
  return randomIdsResult.map((a) => a.id)
}

// 定义通用的 Include 对象，减少重复代码
const defaultArtworkInclude = {
  images: { take: 2, orderBy: { sortOrder: 'asc' } }, // 列表页只取一张图
  artist: true,
  artworkTags: { include: { tag: true } },
  _count: { select: { images: true } }
} as const // as const 提供更好的类型推导

/**
 * 转换单个作品数据
 */
function transformSingleArtwork(artwork: any) {
  const _count = artwork._count?.images || artwork.imageCount || 0
  const { images, totalMediaSize, imageCount } = transformImages(artwork.images, _count)

  // 构建响应对象
  const result = {
    ...artwork,
    images: images,
    tags: artwork.artworkTags?.map((at: any) => at.tag.name) || [],
    imageCount,
    totalMediaSize,
    descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
    artist: artwork.artist
      ? {
          ...artwork.artist,
          artworksCount: 0 // 注意：列表查询通常不包含艺术家的作品总数，除非再联表查
        }
      : null
  }

  // 清理不需要输出到前端的临时字段 (虽然 JS 中 delete 性能一般，但在这里为了通过类型检查或减少 payload 可行)
  delete result.artworkTags
  delete result._count

  return result
}

// 辅助：获取不带后缀的文件名
const getStem = (p: string) => {
  const name = path.basename(p)
  const ext = path.extname(name)
  return name.slice(0, name.length - ext.length)
}

function transformImages(images: TImageModel[], dbImageCount?: number) {
  // 1. 直接转 DTO，保留数据库排序
  const allItems = images.map((image) =>
    ArtworkImageResponseDto.parse({
      ...image,
      mediaType: isVideoFile(image.path) ? 'video' : 'image'
    })
  )

  // 2. 核心逻辑：过滤并挂载
  const finalItems = allItems.filter((item) => {
    // 只有 APNG 需要检查是否要被合并
    if (isApngFile(item.path)) {
      const stem = getStem(item.path)

      // 在列表中寻找是否存在同名的视频文件 (Webm/Mp4)
      // 注意：这里利用了引用传递，找到的 videoOwner 就是数组里的同一个对象
      const videoOwner = allItems.find((i) => i !== item && i.mediaType === 'video' && getStem(i.path) === stem)

      if (videoOwner) {
        // 找到了主人：把自己挂载到视频对象上 (作为原始资源)
        // 你可能需要去扩展一下 TS 类型定义，或者暂时用 (videoOwner as any)
        Object.assign(videoOwner, { raw: item })

        // 返回 false -> 从最终列表中移除这个 APNG
        return false
      }
    }
    // 其他情况（普通图片、视频、无主的APNG）都保留
    return true
  })

  // 3. 统计逻辑（基于合并后的 finalItems）
  const hasVideo = finalItems.some((img) => img.mediaType === 'video')

  // 计算总大小
  const totalMediaSize = finalItems.reduce((sum, img) => sum + (img.size || 0), 0)

  return {
    images: finalItems,
    hasVideo,
    imageCount: hasVideo ? 0 : (dbImageCount ?? finalItems.length),
    totalMediaSize
  }
}
