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

      // 如果有搜索词，使用原生SQL查询以利用Trigram索引
      let searchWhereClause = ''
      let searchParams: any[] = []
      if (searchTerm) {
        // 使用Trigram索引进行高效模糊搜索
        const searchPattern = `%${searchTerm}%`
        searchWhereClause = `
          AND (
            (a.title || ' ' || COALESCE(a.description, '')) ILIKE $${searchParams.length + 1}
            OR EXISTS (
              SELECT 1 FROM "Artist" artist
              WHERE artist.id = a."artistId"
              AND (artist.name ILIKE $${searchParams.length + 2} OR artist.username ILIKE $${searchParams.length + 3})
            )
          )
        `
        searchParams.push(searchPattern, searchPattern, searchPattern)
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

      let total: number
      let artworks: any[]

      // 如果有搜索词，使用原生SQL查询以利用Trigram索引
      if (searchTerm) {
        // 构建基础WHERE条件
        let baseWhereConditions: string[] = []
        let queryParams: any[] = [...searchParams]

        // 添加标签过滤条件
        if (tagNames.length > 0) {
          const tagConditions = tagNames
            .map((_, index) => {
              queryParams.push(tagNames[index])
              return `EXISTS (
              SELECT 1 FROM "ArtworkTag" at
              JOIN "Tag" t ON at."tagId" = t.id
              WHERE at."artworkId" = "Artwork".id AND t.name = $${queryParams.length}
            )`
            })
            .join(' AND ')
          baseWhereConditions.push(`(${tagConditions})`)
        }

        // 添加艺术家ID过滤条件
        if (artistId && !isNaN(artistId)) {
          queryParams.push(artistId)
          baseWhereConditions.push(`"artistId" = $${queryParams.length}`)
        }

        // 构建WHERE子句
        let whereClause = ''
        if (baseWhereConditions.length > 0 && searchWhereClause) {
          // 有基础条件和搜索条件
          const adjustedSearchWhere = searchWhereClause.replace(/\$\d+/g, (match) => {
            const paramIndex = parseInt(match.substring(1))
            return `$${queryParams.length - searchParams.length + paramIndex}`
          })
          whereClause = `WHERE ${baseWhereConditions.join(' AND ')} ${adjustedSearchWhere}`
        } else if (baseWhereConditions.length > 0) {
          // 只有基础条件
          whereClause = `WHERE ${baseWhereConditions.join(' AND ')}`
        } else if (searchWhereClause) {
          // 只有搜索条件，去掉开头的AND
          const adjustedSearchWhere = searchWhereClause
            .replace(/\$\d+/g, (match) => {
              const paramIndex = parseInt(match.substring(1))
              return `$${queryParams.length - searchParams.length + paramIndex}`
            })
            .replace(/^\s*AND\s*/, '')
          whereClause = `WHERE ${adjustedSearchWhere}`
        }

        // 查询总数
        const countQuery = `
          SELECT COUNT(*) as count
          FROM "Artwork" a
          ${whereClause}
        `
        const countResult = await server.prisma.$queryRawUnsafe(countQuery, ...queryParams)
        total = parseInt((countResult as any)[0].count)

        // 构建排序条件
        const orderByClause = mapSortOption(sortBy)
        let orderBySQL = ''
        if (orderByClause.directoryCreatedAt) {
          orderBySQL = `ORDER BY "directoryCreatedAt" ${orderByClause.directoryCreatedAt}`
        } else if (orderByClause.title) {
          orderBySQL = `ORDER BY title ${orderByClause.title}`
        } else if (orderByClause.imageCount) {
          orderBySQL = `ORDER BY "imageCount" ${orderByClause.imageCount}`
        } else if (orderByClause.sourceDate) {
          orderBySQL = `ORDER BY "sourceDate" ${orderByClause.sourceDate}`
        } else if (orderByClause.artist) {
          const artistOrder =
            typeof orderByClause.artist === 'object' ? orderByClause.artist.name : orderByClause.artist
          orderBySQL = `ORDER BY (SELECT name FROM "Artist" WHERE id = "Artwork"."artistId") ${artistOrder}`
        } else {
          orderBySQL = 'ORDER BY "directoryCreatedAt" DESC'
        }

        // 查询作品列表
        queryParams.push(pageSize, skip)
        const artworksQuery = `
          SELECT
            a.*,
            artist.id as "artist_id",
            artist.name as "artist_name",
            artist.username as "artist_username",
            artist."userId" as "artist_userId",
            artist.bio as "artist_bio",
            artist."createdAt" as "artist_createdAt",
            artist."updatedAt" as "artist_updatedAt"
          FROM "Artwork" a
          LEFT JOIN "Artist" artist ON a."artistId" = artist.id
          ${whereClause}
          ${orderBySQL}
          LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `

        const rawArtworks = await server.prisma.$queryRawUnsafe(artworksQuery, ...queryParams)

        // 转换原生查询结果并获取关联数据
        const artworkIds = (rawArtworks as any[]).map((a) => a.id)

        // 获取图片数据
        const images = await server.prisma.image.findMany({
          where: { artworkId: { in: artworkIds } },
          orderBy: { sortOrder: 'asc' }
        })

        // 获取标签数据
        const artworkTags = await server.prisma.artworkTag.findMany({
          where: { artworkId: { in: artworkIds } },
          include: { tag: true }
        })

        // 获取图片计数
        const imageCounts = await server.prisma.image.groupBy({
          by: ['artworkId'],
          where: { artworkId: { in: artworkIds } },
          _count: { id: true }
        })

        // 组装最终结果
        artworks = (rawArtworks as any[]).map((rawArtwork) => {
          const artworkImages = images.filter((img) => img.artworkId === rawArtwork.id).slice(0, 1)
          const tags = artworkTags.filter((at) => at.artworkId === rawArtwork.id)
          const imageCount = imageCounts.find((ic) => ic.artworkId === rawArtwork.id)?._count.id || 0

          return {
            ...rawArtwork,
            artist: rawArtwork.artist_id
              ? {
                  id: rawArtwork.artist_id,
                  name: rawArtwork.artist_name,
                  username: rawArtwork.artist_username,
                  userId: rawArtwork.artist_userId,
                  bio: rawArtwork.artist_bio,
                  createdAt: rawArtwork.artist_createdAt,
                  updatedAt: rawArtwork.artist_updatedAt
                }
              : null,
            images: artworkImages,
            artworkTags: tags,
            _count: { images: imageCount }
          }
        })
      } else {
        // 没有搜索词时使用标准Prisma查询
        total = await server.prisma.artwork.count({ where: whereClause })

        artworks = await server.prisma.artwork.findMany({
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
      }

      // 转换数据格式，将多对多关系的标签转换为字符串数组，并添加媒体类型信息
      const items = artworks.map((artwork) => {
        // 为每个图片添加mediaType字段
        const enhancedImages: MediaFile[] = artwork.images.map((image: any) => ({
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
      console.error('Error fetching artworks:', error)
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
