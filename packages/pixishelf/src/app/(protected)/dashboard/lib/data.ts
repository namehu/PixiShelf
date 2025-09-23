import { prisma } from '@/lib/prisma'
import { EnhancedArtworksResponse, ArtistsResponse, getMediaType, MediaFile } from '@/types'
import { Prisma } from '@prisma/client'

/**
 * 获取推荐作品数据
 */
export async function getRecommendedArtworks(): Promise<EnhancedArtworksResponse> {
  try {
    const pageSize = 10

    // 使用原生 SQL 随机获取作品 ID
    type ArtworkId = {
      id: number
    }

    const randomIdsResult = await prisma.$queryRaw<ArtworkId[]>(
      Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${pageSize}`
    )

    const randomIds = randomIdsResult.map((artwork) => artwork.id)

    if (randomIds.length === 0) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize
      }
    }

    // 查询完整的作品数据
    const artworks = await prisma.artwork.findMany({
      where: {
        id: {
          in: randomIds
        }
      },
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } },
        _count: { select: { images: true } }
      }
    })

    // 按随机 ID 的顺序重新排序
    const orderedArtworks = randomIds.map((id) => artworks.find((a) => a.id === id)).filter(Boolean) as typeof artworks

    // 转换数据格式
    const items = orderedArtworks.map((artwork) => {
      const enhancedImages: MediaFile[] = artwork.images.map((image: any) => ({
        ...image,
        mediaType: getMediaType(image.path) as 'image' | 'video',
        sortOrder: image.sortOrder || 0,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString()
      }))

      const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
      const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0

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
      pageSize: 10
    }
  }
}

/**
 * 获取最新作品数据
 */
export async function getRecentArtworks(): Promise<EnhancedArtworksResponse> {
  try {
    const page = 1
    const pageSize = 10
    const skip = (page - 1) * pageSize

    const [artworks, total] = await Promise.all([
      prisma.artwork.findMany({
        include: {
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
          artist: true,
          artworkTags: { include: { tag: true } },
          _count: { select: { images: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.artwork.count()
    ])

    // 转换数据格式
    const items = artworks.map((artwork) => {
      const enhancedImages: MediaFile[] = artwork.images.map((image: any) => ({
        ...image,
        mediaType: getMediaType(image.path) as 'image' | 'video',
        sortOrder: image.sortOrder || 0,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString()
      }))

      const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
      const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0

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
      page: 1,
      pageSize: 10
    }
  }
}

/**
 * 获取热门艺术家数据
 */
export async function getRecentArtists(): Promise<ArtistsResponse> {
  try {
    const page = 1
    const pageSize = 10
    const skip = (page - 1) * pageSize

    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        include: {
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
    const items = artists.map((artist) => ({
      ...artist,
      artworksCount: artist._count.artworks,
      createdAt: artist.createdAt?.toISOString(),
      updatedAt: artist.updatedAt?.toISOString()
    }))

    return {
      items,
      total,
      page,
      pageSize
    }
  } catch (error) {
    console.error('Error fetching recent artists:', error)
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: 10
    }
  }
}