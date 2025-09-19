import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { Artist } from '@pixishelf/shared'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20'))
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'name_asc'

    // 计算分页参数
    const skip = (page - 1) * pageSize

    // 构建搜索条件
    const whereClause: any = {}
    if (search) {
      whereClause.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          username: {
            contains: search,
            mode: 'insensitive'
          }
        }
      ]
    }

    // 构建排序条件
    let orderBy: any
    switch (sortBy) {
      case 'name_desc':
        orderBy = { name: 'desc' }
        break
      case 'artworks_desc':
        orderBy = { artworks: { _count: 'desc' } }
        break
      case 'artworks_asc':
        orderBy = { artworks: { _count: 'asc' } }
        break
      default:
        orderBy = { name: 'asc' }
    }

    // 查询总数和艺术家列表
    const [total, artists] = await Promise.all([
      prisma.artist.count({ where: whereClause }),
      prisma.artist.findMany({
        where: whereClause,
        include: {
          _count: {
            select: {
              artworks: true
            }
          }
        },
        orderBy,
        skip,
        take: pageSize
      })
    ])

    // 转换数据格式，添加 artworksCount 字段
    const formattedArtists: Artist[] = artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      username: artist.username,
      userId: artist.userId,
      bio: artist.bio,
      artworksCount: artist._count.artworks,
      createdAt: artist.createdAt.toISOString(),
      updatedAt: artist.updatedAt.toISOString()
    }))

    return NextResponse.json({
      items: formattedArtists,
      total,
      page,
      pageSize
    })
  } catch (error) {
    console.error('Error fetching artists:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
