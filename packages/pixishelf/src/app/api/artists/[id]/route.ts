import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Artist } from '@/types'

/**
 * 获取艺术家详情接口
 * GET /api/artists/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<Artist | { error: string }>> {
  try {
    const { id } = await params
    const artistId = parseInt(id, 10)

    if (isNaN(artistId)) {
      return NextResponse.json({ error: 'Invalid artist ID' }, { status: 400 })
    }

    // 查询艺术家详情
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      include: {
        _count: {
          select: {
            artworks: true
          }
        }
      }
    })

    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

    // 转换数据格式
    const response: Artist = {
      id: artist.id,
      name: artist.name,
      userId: artist.userId,
      username: artist.username,
      bio: artist.bio,
      artworksCount: artist._count.artworks,
      createdAt: artist.createdAt.toISOString(),
      updatedAt: artist.updatedAt.toISOString()
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get artist:', error)
    return NextResponse.json({ error: 'Failed to get artist' }, { status: 500 })
  }
}
