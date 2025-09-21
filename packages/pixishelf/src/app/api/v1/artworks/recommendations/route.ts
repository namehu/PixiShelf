// /api/v1/artworks/recommendations/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { EnhancedArtworksResponse, getMediaType, MediaFile } from '@/types'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * 获取推荐作品接口 (已为 PostgreSQL 优化)
 * GET /api/v1/artworks/recommendations
 */
export async function GET(request: NextRequest): Promise<NextResponse<EnhancedArtworksResponse>> {
  try {
    // 2. 定义返回数量
    const pageSize = 10

    // 3. 使用原生 SQL 高效地随机获取 10 个作品的 ID
    type ArtworkId = {
      id: number // 如果 ID 是 string 类型 (CUID/UUID), 请修改此处
    }

    const randomIdsResult = await prisma.$queryRaw<ArtworkId[]>(
      Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${pageSize}`
    )

    // 提取纯粹的 ID 数组
    const randomIds = randomIdsResult.map((artwork) => artwork.id)

    // 如果数据库为空或未找到作品，返回空数组
    if (randomIds.length === 0) {
      const response: EnhancedArtworksResponse = {
        items: [],
        total: 0,
        page: 1,
        pageSize
      }
      return NextResponse.json(response)
    }

    // 4. 使用获取到的随机 ID，通过 Prisma ORM 查询完整的作品数据
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

    // 5. (推荐) 手动按随机 ID 的顺序重新排序结果，因为 `where in` 不保证顺序
    const orderedArtworks = randomIds.map((id) => artworks.find((a) => a.id === id)).filter(Boolean) as typeof artworks

    // 6. 转换数据格式以匹配前端需求
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

      // 清理不再需要的临时字段
      delete (result as any).artworkTags
      delete (result as any)._count
      return result
    })

    // 7. 构造并返回最终响应
    const response: EnhancedArtworksResponse = {
      items,
      total: items.length,
      page: 1,
      pageSize
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching recommended artworks:', error)
    return NextResponse.json({ error: 'Failed to fetch recommended artworks' } as any, { status: 500 })
  }
}
