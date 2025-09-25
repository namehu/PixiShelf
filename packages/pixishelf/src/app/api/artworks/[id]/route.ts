import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMediaType, MediaFile } from '@/types'

/**
 * 获取单个作品详情接口
 * GET /api/artworks/:id
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params
    const artworkId = Number(id)

    if (!Number.isFinite(artworkId)) {
      return NextResponse.json({ error: 'Invalid artwork ID' }, { status: 400 })
    }

    const artwork = await prisma.artwork.findUnique({
      where: { id: artworkId },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } }
      }
    })

    if (!artwork) {
      return NextResponse.json({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' }, { status: 404 })
    }

    // 转换数据格式，将多对多关系的标签转换为字符串数组，并添加媒体类型信息
    const enhancedImages: MediaFile[] = artwork.images.map((image) => ({
      ...image,
      mediaType: getMediaType(image.path) as 'image' | 'video',
      sortOrder: image.sortOrder || 0,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString()
    }))

    // 计算视频统计信息
    const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
    const totalMediaSize = enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0)

    const formattedArtwork = {
      ...artwork,
      images: enhancedImages,
      tags: artwork.artworkTags.map((at) => at.tag.name),
      videoCount,
      totalMediaSize,
      createdAt: artwork.createdAt.toISOString(),
      updatedAt: artwork.updatedAt.toISOString(),
      directoryCreatedAt: artwork.directoryCreatedAt?.toISOString() || null,
      artist: artwork.artist
        ? {
            ...artwork.artist,
            artworksCount: 0, // 这里可以根据需要查询实际数量
            createdAt: artwork.artist.createdAt.toISOString(),
            updatedAt: artwork.artist.updatedAt.toISOString()
          }
        : null,
      artworkTags: undefined as any
    }
    delete (formattedArtwork as any).artworkTags

    return NextResponse.json(formattedArtwork)
  } catch (error) {
    console.error('Error fetching artwork:', error)
    return NextResponse.json({ error: 'Failed to fetch artwork' }, { status: 500 })
  }
}
