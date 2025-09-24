import { artworkRepository } from '@/lib/repositories/artworkRepository'
import { EnhancedArtworksResponse, getMediaType, MediaFile } from '@/types'

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
  async getRecommendedArtworks(options: {
    pageSize?: number
  } = {}): Promise<EnhancedArtworksResponse> {
    try {
      const { pageSize = 10 } = options

      // 1. 获取随机作品 ID
      const randomIds = await artworkRepository.findRandomIds(pageSize)

      // 2. 如果没有作品，返回空结果
      if (randomIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: 1,
          pageSize
        }
      }

      // 3. 查询完整的作品数据
      const artworks = await artworkRepository.findManyByIds(randomIds)

      // 4. 按随机 ID 的顺序重新排序
      const orderedArtworks = randomIds
        .map((id) => artworks.find((a) => a.id === id))
        .filter(Boolean) as typeof artworks

      // 5. 转换数据格式
      const items = this.transformArtworksToResponse(orderedArtworks)

      return {
        items,
        total: items.length,
        page: 1,
        pageSize
      }
    } catch (error) {
      console.error('Error fetching recommended artworks:', error)
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: options.pageSize || 10
      }
    }
  },

  /**
   * 获取最新作品
   * @param options 查询选项
   * @returns 最新作品响应
   */
  async getRecentArtworks(options: {
    page?: number
    pageSize?: number
  } = {}): Promise<EnhancedArtworksResponse> {
    try {
      const { page = 1, pageSize = 10 } = options
      const skip = (page - 1) * pageSize

      // 1. 并行查询作品数据和总数
      const [artworks, total] = await Promise.all([
        artworkRepository.findRecent({ skip, take: pageSize }),
        artworkRepository.count()
      ])

      // 2. 转换数据格式
      const items = this.transformArtworksToResponse(artworks)

      return {
        items,
        total,
        page,
        pageSize
      }
    } catch (error) {
      console.error('Error fetching recent artworks:', error)
      return {
        items: [],
        total: 0,
        page: options.page || 1,
        pageSize: options.pageSize || 10
      }
    }
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
      const totalMediaSize = videoCount 
        ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) 
        : 0

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
      console.error('Error fetching artwork by id:', error)
      return null
    }
  }
}

export type ArtworkService = typeof artworkService