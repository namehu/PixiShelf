import { FastifyInstance } from 'fastify'
import { ArtistsResponse, ArtistsQuery } from '@pixishelf/shared'
import { asApiResponse } from '../types/response'

export default async function artistsRoutes(server: FastifyInstance) {
  // 获取艺术家列表
  server.get<{ Querystring: ArtistsQuery }>('/api/v1/artists', async (request): Promise<ArtistsResponse> => {
    const { page = '1', pageSize = '40', search, sortBy = 'name_asc' } = request.query
    
    // 解析分页参数
    const pageNum = Math.max(1, parseInt(page) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize) || 40))
    const skip = (pageNum - 1) * pageSizeNum
    
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
      server.prisma.artist.count({ where: whereClause }),
      server.prisma.artist.findMany({
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
        take: pageSizeNum
      })
    ])
    
    // 转换数据格式，添加 artworksCount 字段
    const formattedArtists = artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      username: artist.username,
      userId: artist.userId,
      bio: artist.bio,
      artworksCount: artist._count.artworks,
      createdAt: artist.createdAt.toISOString(),
      updatedAt: artist.updatedAt.toISOString()
    }))
    
    return {
      items: asApiResponse(formattedArtists),
      total,
      page: pageNum,
      pageSize: pageSizeNum
    }
  })

  // 获取单个艺术家信息
  server.get<{ Params: { id: string } }>('/api/v1/artists/:id', async (request, reply) => {
    const { id } = request.params
    const artistId = parseInt(id, 10)
    
    if (isNaN(artistId)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid artist ID' })
    }
    
    const artist = await server.prisma.artist.findUnique({
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
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Artist not found' })
    }
    
    const formattedArtist = {
      id: artist.id,
      name: artist.name,
      username: artist.username,
      userId: artist.userId,
      bio: artist.bio,
      artworksCount: artist._count.artworks,
      createdAt: artist.createdAt.toISOString(),
      updatedAt: artist.updatedAt.toISOString()
    }
    
    return asApiResponse(formattedArtist)
  })
}