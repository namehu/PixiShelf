import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ARTIST_SELECT } from '@/schemas/models/artists'
import { ArtistsGetSchema } from '@/schemas/artist.dto'
import { ArtistResponseDto } from '@/schemas/artist.dto'
import { PaginationResponseData } from '@/types'

/**
 * 根据 ID 获取单个艺术家
 * @param id 艺术家 ID
 * @returns 艺术家数据或 null
 */
export async function getArtistById(id: number): Promise<ArtistResponseDto | null> {
  const artist = await prisma.artist.findUnique({
    where: { id },
    select: {
      ...ARTIST_SELECT,
      _count: {
        select: {
          artworks: true
        }
      }
    }
  })

  return !artist ? null : ArtistResponseDto.parse(artist)
}

/**
 * 获取艺术家列表
 * @param options 查询选项
 * @returns 艺术家列表响应
 */
export async function getArtists(options: ArtistsGetSchema): Promise<PaginationResponseData<ArtistResponseDto>> {
  try {
    const { page, pageSize, search, sortBy } = options

    // 限制页面大小，防止过大的查询
    const limitedPageSize = Math.min(100, pageSize)
    const skip = (page - 1) * limitedPageSize

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

    // 并行查询艺术家数据和总数
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: whereClause,
        select: {
          ...ARTIST_SELECT,
          _count: {
            select: {
              artworks: true
            }
          }
        },
        orderBy,
        skip,
        take: limitedPageSize
      }),
      prisma.artist.count({ where: whereClause })
    ])

    // 转换数据格式
    const data = artists.map((artist) => ArtistResponseDto.parse(artist))

    return {
      data,
      pagination: {
        page,
        pageSize: limitedPageSize,
        total,
        totalPages: Math.ceil(total / limitedPageSize),
        hasNextPage: page * limitedPageSize < total,
        hasPrevPage: page > 1
      }
    }
  } catch (error) {
    logger.error('Error fetching artists:', error)
    return {
      data: [],
      pagination: {
        page: options.page || 1,
        pageSize: options.pageSize || 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      }
    }
  }
}

/**
 * 获取热门艺术家（按作品数量排序）
 * @param options 查询选项
 * @returns 热门艺术家响应
 */
export async function getRecentArtists(
  options: {
    page?: number
    pageSize?: number
  } = {}
): Promise<PaginationResponseData<ArtistResponseDto>> {
  try {
    const { page = 1, pageSize = 10 } = options
    const skip = (page - 1) * pageSize

    // 并行查询艺术家数据和总数
    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        select: {
          ...ARTIST_SELECT,
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
    const items = artists.map((artist) => ArtistResponseDto.parse(artist))

    return {
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNextPage: page * pageSize < total,
        hasPrevPage: page > 1
      }
    }
  } catch (error) {
    logger.error('Error fetching recent artists:', error)
    return {
      data: [],
      pagination: {
        page: options.page || 1,
        pageSize: options.pageSize || 10,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      }
    }
  }
}
