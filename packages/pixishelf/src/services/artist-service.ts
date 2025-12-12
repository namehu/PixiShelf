import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ArtistsResponse, ArtistsQuery } from '@/types'
import { Artist } from '@/types/core'
import { combinationStaticArtistBg, combinationStaticAvatar } from '@/utils/combinationStatic'

/**
 * 艺术家服务层 - 业务逻辑封装
 * 职责：封装艺术家相关的业务逻辑，数据验证和转换
 */
export const artistService = {
  /**
   * 获取艺术家列表
   * @param options 查询选项
   * @returns 艺术家列表响应
   */
  async getArtists(
    options: {
      page?: number
      pageSize?: number
      search?: string
      sortBy?: 'name_asc' | 'name_desc' | 'artworks_desc' | 'artworks_asc'
    } = {}
  ): Promise<ArtistsResponse> {
    try {
      const { page = 1, pageSize = 20, search = '', sortBy = 'name_asc' } = options

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
          include: {
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
      const items = transformArtists(artists)

      return {
        items,
        total,
        page,
        pageSize: limitedPageSize
      }
    } catch (error) {
      logger.error('Error fetching artists:', error)
      return {
        items: [],
        total: 0,
        page: options.page || 1,
        pageSize: options.pageSize || 20
      }
    }
  },

  /**
   * 获取热门艺术家（按作品数量排序）
   * @param options 查询选项
   * @returns 热门艺术家响应
   */
  async getRecentArtists(
    options: {
      page?: number
      pageSize?: number
    } = {}
  ): Promise<ArtistsResponse> {
    try {
      const { page = 1, pageSize = 10 } = options
      const skip = (page - 1) * pageSize

      // 并行查询艺术家数据和总数
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
      const items = transformArtists(artists)

      return {
        items,
        total,
        page,
        pageSize
      }
    } catch (error) {
      logger.error('Error fetching recent artists:', error)
      return {
        items: [],
        total: 0,
        page: options.page || 1,
        pageSize: options.pageSize || 10
      }
    }
  },

  /**
   * 根据 ID 获取单个艺术家
   * @param id 艺术家 ID
   * @returns 艺术家数据或 null
   */
  async getArtistById(id: number): Promise<Artist | null> {
    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            artworks: true
          }
        }
      }
    })

    return !artist ? null : transformArtist(artist)
  },

  /**
   * 验证艺术家查询参数
   * @param query 查询参数
   * @returns 验证后的查询参数
   */
  validateArtistsQuery(query: ArtistsQuery): {
    page: number
    pageSize: number
    search: string
    sortBy: 'name_asc' | 'name_desc' | 'artworks_desc' | 'artworks_asc'
  } {
    const page = Math.max(1, parseInt(query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20', 10)))
    const search = (query.search || '').trim()
    const sortBy = ['name_asc', 'name_desc', 'artworks_desc', 'artworks_asc'].includes(query.sortBy || '')
      ? (query.sortBy as 'name_asc' | 'name_desc' | 'artworks_desc' | 'artworks_asc')
      : 'name_asc'

    return {
      page,
      pageSize,
      search,
      sortBy
    }
  }
}

export type ArtistService = typeof artistService

/**
 * 转换艺术家数据格式以匹配前端需求
 * @param artists 原始艺术家数据
 * @returns 转换后的艺术家数据
 */
export function transformArtists(artists: any[]): Artist[] {
  return artists.map(transformArtist)
}

/**
 * 转换单个艺术家数据格式以匹配前端需求
 * @param artists 原始艺术家数据
 * @returns 转换后的艺术家数据
 */
export function transformArtist(artist: any): Artist {
  const { _count, userId, createdAt, updatedAt, avatar, backgroundImg, ...rest } = artist
  return {
    ...rest,
    userId,
    avatar: combinationStaticAvatar(userId, avatar),
    backgroundImg: combinationStaticArtistBg(userId, backgroundImg),
    artworksCount: _count?.artworks || 0,
    createdAt: createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: updatedAt?.toISOString() || new Date().toISOString()
  }
}
