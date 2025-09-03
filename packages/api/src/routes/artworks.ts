import { FastifyInstance } from 'fastify'
import { EnhancedArtworksResponse, MediaFile, getMediaType } from '@pixishelf/shared'
import { asApiResponse, asPaginatedResponse } from '../types/response'
import { mapSortOption, getSafeSortOption } from '../utils/sortMapper'

export default async function artworksRoutes(server: FastifyInstance) {
  // GET /api/v1/artworks - 获取所有作品列表（分页+标签过滤）
  server.get('/api/v1/artworks', async (req, reply) => {
    try {
      const q = req.query as any
      const page = Math.max(1, parseInt(q.page) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20))
      const skip = (page - 1) * pageSize

      // 标签过滤：支持通过 tags 查询参数过滤
      const tagsQuery = q.tags as string
      let tagNames: string[] = []
      if (tagsQuery) {
        tagNames = tagsQuery
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      }

      // 搜索查询：支持通过 search 查询参数进行模糊搜索
      const searchQuery = q.search as string
      const searchTerm = searchQuery?.trim()

      // 艺术家筛选：支持通过 artistId 查询参数筛选特定艺术家的作品
      const artistIdQuery = q.artistId as string
      const artistId = artistIdQuery ? parseInt(artistIdQuery, 10) : null

      // 排序参数：支持通过 sortBy 查询参数排序
      const sortBy = getSafeSortOption(q.sortBy as string)
      const orderBy = mapSortOption(sortBy)

      // 构建查询条件
      const whereClause: any = {}
      const conditions: any[] = []

      // 如果有标签过滤，使用多对多关系查询（包含任一标签）
      if (tagNames.length > 0) {
        conditions.push({
          AND: tagNames.map((name) => ({
            artworkTags: { some: { tag: { name } } }
          }))
        })
      }

      // 如果有搜索词，添加模糊搜索条件
      if (searchTerm) {
        conditions.push({
          OR: [
            // 搜索作品标题
            {
              title: {
                contains: searchTerm,
                mode: 'insensitive'
              }
            },
            // 搜索作品描述
            {
              description: {
                contains: searchTerm,
                mode: 'insensitive'
              }
            },
            // 搜索艺术家名称
            {
              artist: {
                name: {
                  contains: searchTerm,
                  mode: 'insensitive'
                }
              }
            },
            // 搜索艺术家用户名
            {
              artist: {
                username: {
                  contains: searchTerm,
                  mode: 'insensitive'
                }
              }
            }
          ]
        })
      }

      // 如果有艺术家ID筛选，添加艺术家筛选条件
      if (artistId && !isNaN(artistId)) {
        conditions.push({
          artistId: artistId
        })
      }

      // 组合所有条件
      if (conditions.length > 0) {
        whereClause.AND = conditions
      }

      // 查询总数（用于分页）
      const total = await server.prisma.artwork.count({ where: whereClause })

      // 查询作品列表（仅取首张图片，按指定方式排序）
      const artworks = await server.prisma.artwork.findMany({
        where: whereClause,
        include: {
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
          artist: true,
          artworkTags: { include: { tag: true } },
          _count: { select: { images: true } }
        },
        orderBy,
        skip,
        take: pageSize
      })

      // 转换数据格式，将多对多关系的标签转换为字符串数组，并添加媒体类型信息
      const items = artworks.map((artwork) => {
        // 为每个图片添加mediaType字段
        const enhancedImages: MediaFile[] = artwork.images.map((image) => ({
          ...image,
          mediaType: getMediaType(image.path) as 'image' | 'video',
          sortOrder: image.sortOrder || 0,
          createdAt: image.createdAt.toISOString(),
          updatedAt: image.updatedAt.toISOString()
        }))

        // 计算视频统计信息
        const videoCount = enhancedImages.filter((img) => img.mediaType === 'video').length
        const totalMediaSize = videoCount ? enhancedImages.reduce((sum, img) => sum + (img.size || 0), 0) : 0 // 只统计视频大小

        const result = {
          ...artwork,
          images: enhancedImages,
          tags: [],
          imageCount: videoCount > 0 ? 0 : artwork._count.images,
          videoCount,
          totalMediaSize,
          descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
          directoryCreatedAt: artwork.directoryCreatedAt?.toISOString() || null,
          artworkTags: undefined as any,
          _count: undefined as any
        }
        // 删除undefined字段
        delete result.artworkTags
        delete result._count
        return result
      })

      // 使用类型转换辅助函数，实际转换由插件处理
      const response: EnhancedArtworksResponse = asPaginatedResponse({ items, total, page, pageSize })
      return reply.send(response)
    } catch (error) {
      server.log.error({ error }, 'Error fetching artworks')
      return reply.code(500).send({ error: 'Failed to fetch artworks' })
    }
  })

  // GET /api/v1/artworks/:id - 获取单个作品详情
  server.get('/api/v1/artworks/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const artworkId = Number(id)
      if (!Number.isFinite(artworkId)) {
        return reply.code(400).send({ error: 'Invalid artwork ID' })
      }

      const artwork = await server.prisma.artwork.findUnique({
        where: { id: artworkId },
        include: {
          images: { orderBy: { sortOrder: 'asc' } },
          artist: true,
          artworkTags: { include: { tag: true } }
        }
      })

      if (!artwork) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' })
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
        artworkTags: undefined as any
      }
      delete (formattedArtwork as any).artworkTags

      // 使用类型转换辅助函数，实际转换由插件处理
      return reply.send(asApiResponse(formattedArtwork))
    } catch (error) {
      server.log.error({ error }, 'Error fetching artwork')
      return reply.code(500).send({ error: 'Failed to fetch artwork' })
    }
  })
}
