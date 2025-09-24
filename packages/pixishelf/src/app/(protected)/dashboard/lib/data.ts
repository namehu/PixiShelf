import { artworkService } from '@/services/artworkService'
import { prisma } from '@/lib/prisma'
import { ArtistsResponse } from '@/types'
import type { EnhancedArtworksResponse } from '@/types'

/**
 * 获取推荐作品数据
 */
export async function getRecommendedArtworks(): Promise<EnhancedArtworksResponse> {
  // 直接调用 Service 层，避免代码重复
  return artworkService.getRecommendedArtworks({ pageSize: 10 })
}

/**
 * 获取最新作品数据
 */
export async function getRecentArtworks(): Promise<EnhancedArtworksResponse> {
  // 直接调用 Service 层，避免代码重复
  return artworkService.getRecentArtworks({ page: 1, pageSize: 10 })
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