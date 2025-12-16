import 'server-only'

import { EnhancedArtworksResponse, getMediaType } from '@/types'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { transformArtist } from './artist-service'
import { ArtworkResponse, ArtworkResponseDto } from '@/schemas/artwork.dto'
import { IImageModel } from '@/schemas/models'
import { isApngFile } from '../../lib/media'

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
  const artworks = await fetchManyByIds(randomIds)

  // 3. 按随机 ID 的顺序重新排序 (因为 SQL WHERE IN 不保证顺序)
  const orderedArtworks = randomIds
    .map((id) => artworks.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  // 4. 转换数据格式
  const items = transformArtworksList(orderedArtworks)

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
  const [artworks, total] = await Promise.all([fetchRecentRaw({ skip, take: pageSize }), countArtworks()])

  // 2. 转换数据格式
  return {
    items: transformArtworksList(artworks),
    total,
    page,
    pageSize
  }
}

/**
 * 根据 ID 获取单个作品详情
 * 包含：所有图片、完整 Tag 信息、Artist 信息
 */
export async function getArtworkById(id: number) {
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

  const { enhancedImages, apng, videoCount, totalMediaSize } = transformImages(artwork.images)

  // 3. 艺术家处理 (简单内联处理，或者调用 artistService 的 helper)
  const formattedArtist = artwork.artist ? transformArtist(artwork.artist) : null

  return ArtworkResponseDto.parse({
    ...artwork,
    images: enhancedImages,
    apng,
    tags: artwork.artworkTags.map(({ tag }) => tag),
    videoCount,
    totalMediaSize,
    artist: formattedArtist,
    artworkTags: undefined
  }) as ArtworkResponse
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

/**
 * 根据 ID 数组查询完整的作品数据
 */
async function fetchManyByIds(ids: number[]) {
  return prisma.artwork.findMany({
    where: { id: { in: ids } },
    include: defaultArtworkInclude
  })
}

/**
 * 查询最新作品原始数据
 */
async function fetchRecentRaw(options: { skip: number; take: number }) {
  return prisma.artwork.findMany({
    include: defaultArtworkInclude,
    orderBy: { directoryCreatedAt: 'desc' },
    skip: options.skip,
    take: options.take
  })
}

async function countArtworks(): Promise<number> {
  return prisma.artwork.count()
}

// 定义通用的 Include 对象，减少重复代码
const defaultArtworkInclude = {
  images: { take: 1, orderBy: { sortOrder: 'asc' } }, // 列表页只取一张图
  artist: true,
  artworkTags: { include: { tag: true } },
  _count: { select: { images: true } }
} as const // as const 提供更好的类型推导

/**
 * 转换作品数据格式以匹配前端需求 (批量)
 */
function transformArtworksList(artworks: any[]) {
  return artworks.map(transformSingleArtwork)
}

/**
 * 转换单个作品数据
 */
function transformSingleArtwork(artwork: any) {
  const _count = artwork._count?.images || artwork.imageCount || 0
  const { enhancedImages, videoCount, totalMediaSize, imageCount } = transformImages(artwork.images, _count)

  // 构建响应对象
  const result = {
    ...artwork,
    images: enhancedImages,
    tags: artwork.artworkTags?.map((at: any) => at.tag.name) || [],
    // 优先使用计算出的 videoCount，否则使用数据库计数
    imageCount: imageCount,
    videoCount,
    totalMediaSize,
    descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
    artist: artwork.artist
      ? {
          ...artwork.artist,
          artworksCount: 0, // 注意：列表查询通常不包含艺术家的作品总数，除非再联表查
          createdAt: artwork.artist.createdAt?.toISOString(),
          updatedAt: artwork.artist.updatedAt?.toISOString()
        }
      : null
  }

  // 清理不需要输出到前端的临时字段 (虽然 JS 中 delete 性能一般，但在这里为了通过类型检查或减少 payload 可行)
  delete result.artworkTags
  delete result._count

  return result
}

function transformImages(images: IImageModel[], imageCount?: number) {
  // 先处理 sortOrder，确保后续操作基于正确的顺序
  const _images = images.map((image) => ({
    ...image,
    mediaType: getMediaType(image.path) as 'image' | 'video',
    sortOrder: image.sortOrder || 0
  }))
  //  防止只有apng
  const enhancedImages = _images.length > 1 ? _images.filter((img) => !isApngFile(img.path)) : _images
  // 分离 apng 图片
  const apng = _images.find((img) => isApngFile(img.path)) || undefined
  // 计算视频相关统计
  const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
  const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0

  return {
    apng,
    enhancedImages,
    videoCount,
    imageCount: videoCount > 0 ? 0 : (imageCount ?? enhancedImages.length),
    totalMediaSize
  }
}
