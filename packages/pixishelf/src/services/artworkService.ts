import logger from '@/lib/logger'
import { EnhancedArtworksResponse, getMediaType, MediaFile } from '@/types'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

interface ArtworkId {
  id: number
}

/**
 * 作品数据访问层 - Repository 模式
 * 职责：封装所有作品相关的数据库查询操作
 */
const artworkRepository = {
  /**
   * 使用原生 SQL 随机获取作品 ID
   * @param limit 获取数量限制
   * @returns 随机作品 ID 数组
   */
  async findRandomIds(limit: number): Promise<number[]> {
    const randomIdsResult = await prisma.$queryRaw<ArtworkId[]>(
      Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${limit}`
    )

    return randomIdsResult.map((artwork) => artwork.id)
  },

  /**
   * 根据 ID 数组查询完整的作品数据
   * @param ids 作品 ID 数组
   * @returns 作品数据数组
   */
  async findManyByIds(ids: number[]) {
    return prisma.artwork.findMany({
      where: {
        id: {
          in: ids
        }
      },
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } },
        _count: { select: { images: true } }
      }
    })
  },

  /**
   * 查询最新作品
   * @param options 查询选项
   * @returns 作品数据数组
   */
  async findRecent(options: { skip: number; take: number }) {
    return prisma.artwork.findMany({
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } },
        _count: { select: { images: true } }
      },
      orderBy: { directoryCreatedAt: 'desc' },
      skip: options.skip,
      take: options.take
    })
  },

  /**
   * 获取作品总数
   * @returns 作品总数
   */
  async count(): Promise<number> {
    return prisma.artwork.count()
  },

  /**
   * 通用查询方法
   * @param options Prisma 查询选项
   * @returns 作品数据数组
   */
  async findMany(options: Prisma.ArtworkFindManyArgs) {
    return prisma.artwork.findMany(options)
  },

  /**
   * 根据 ID 查询单个作品
   * @param id 作品 ID
   * @returns 作品数据或 null
   */
  async findById(id: number) {
    return prisma.artwork.findUnique({
      where: { id },
      include: {
        artist: true,
        artworkTags: {
          include: { tag: true }
        },
        images: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    })
  },

  /**
   * 创建新作品
   * @param data 作品数据
   * @returns 创建的作品
   */
  async create(data: Prisma.ArtworkCreateInput) {
    return prisma.artwork.create({ data })
  },

  /**
   * 更新作品
   * @param id 作品 ID
   * @param data 更新数据
   * @returns 更新后的作品
   */
  async update(id: number, data: Prisma.ArtworkUpdateInput) {
    return prisma.artwork.update({
      where: { id },
      data
    })
  },

  /**
   * 删除作品
   * @param id 作品 ID
   * @returns 删除的作品
   */
  async delete(id: number) {
    return prisma.artwork.delete({ where: { id } })
  }
}

interface GetRecommendedArtworksOptions {
  pageSize?: number
}

interface GetRecentArtworksOptions {
  page?: number
  pageSize?: number
}

/**
 * 作品服务层 - 业务逻辑封装
 * 职责：封装作品相关的业务逻辑，数据验证和转换
 */
export const artworkService = {
  /**
   * 获取推荐作品
   * @param options 查询选项
   * @returns 推荐作品响应
   */
  async getRecommendedArtworks(options: GetRecommendedArtworksOptions) {
    const { pageSize = 10 } = options ?? {}
    const result: EnhancedArtworksResponse = { items: [], total: 0, page: 1, pageSize }
    try {
      // 1. 获取随机作品 ID
      const randomIds = await artworkRepository.findRandomIds(pageSize)
      // 2. 如果没有作品，返回空结果
      if (randomIds.length === 0) {
        return result
      }

      // 3. 查询完整的作品数据
      const artworks = await artworkRepository.findManyByIds(randomIds)

      // 4. 按随机 ID 的顺序重新排序
      const orderedArtworks = randomIds
        .map((id) => artworks.find((a) => a.id === id))
        .filter(Boolean) as typeof artworks

      // 5. 转换数据格式
      const items = this.transformArtworksToResponse(orderedArtworks)

      result.items = items
      result.total = items.length
    } catch (error) {
      logger.error('Error fetching recommended artworks:', error)
    }

    return result
  },

  /**
   * 获取最新作品
   * @param options 查询选项
   * @returns 最新作品响应
   */
  async getRecentArtworks(options: GetRecentArtworksOptions = {}) {
    const { page = 1, pageSize = 10 } = options
    const skip = (page - 1) * pageSize

    const result: EnhancedArtworksResponse = { items: [], total: 0, page, pageSize }
    try {
      // 1. 并行查询作品数据和总数
      const [artworks, total] = await Promise.all([
        artworkRepository.findRecent({ skip, take: pageSize }),
        artworkRepository.count()
      ])

      // 2. 转换数据格式
      result.items = this.transformArtworksToResponse(artworks)
      result.total = total
    } catch (error) {
      logger.error('Error fetching recent artworks:', error)
    }

    return result
  },

  /**
   * 转换作品数据格式以匹配前端需求
   * @param artworks 原始作品数据
   * @returns 转换后的作品数据
   */
  transformArtworksToResponse(artworks: any[]) {
    return artworks.map((artwork) => {
      // 处理图片数据
      const enhancedImages: MediaFile[] = artwork.images.map((image: any) => ({
        ...image,
        mediaType: getMediaType(image.path) as 'image' | 'video',
        sortOrder: image.sortOrder || 0,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString()
      }))

      // 计算视频相关统计
      const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
      const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0

      // 构建响应对象
      const result = {
        ...artwork,
        images: enhancedImages,
        tags: artwork.artworkTags?.map((at: any) => at.tag.name) || [],
        imageCount: videoCount > 0 ? 0 : artwork._count?.images || artwork.imageCount || 0,
        videoCount,
        totalMediaSize,
        descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
        directoryCreatedAt: artwork.directoryCreatedAt?.toISOString() || null,
        createdAt: artwork.createdAt.toISOString(),
        updatedAt: artwork.updatedAt.toISOString(),
        artist: artwork.artist
          ? {
              ...artwork.artist,
              artworksCount: 0,
              createdAt: artwork.artist.createdAt?.toISOString(),
              updatedAt: artwork.artist.updatedAt?.toISOString()
            }
          : null
      }

      // 清理临时字段
      delete (result as any).artworkTags
      delete (result as any)._count

      return result
    })
  },

  /**
   * 根据 ID 获取单个作品
   * @param id 作品 ID
   * @returns 作品数据或 null
   */
  async getArtworkById(id: number) {
    try {
      const artwork = await artworkRepository.findById(id)
      if (!artwork) {
        return null
      }

      const [transformedArtwork] = this.transformArtworksToResponse([artwork])
      return transformedArtwork
    } catch (error) {
      logger.error('Error fetching artwork by id:', error)
      return null
    }
  }
}
