import { FastifyInstance } from 'fastify'

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
        tagNames = tagsQuery.split(',').map((tag) => tag.trim()).filter(Boolean)
      }

      // 构建查询条件
      const whereClause: any = {}

      // 如果有标签过滤，使用多对多关系查询（包含任一标签）
      if (tagNames.length > 0) {
        whereClause.AND = tagNames.map((name) => ({
          artworkTags: { some: { tag: { name } } }
        }))
      }

      // 查询总数（用于分页）
      const total = await server.prisma.artwork.count({ where: whereClause })

      // 查询作品列表（仅取首张图片，同时获取图片总数）
      const artworks = await server.prisma.artwork.findMany({
        where: whereClause,
        include: {
          images: { take: 1, orderBy: { id: 'asc' } },
          artist: true,
          artworkTags: { include: { tag: true } },
          _count: { select: { images: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      })

      // 转换数据格式，将多对多关系的标签转换为字符串数组，并添加图片总数
      const items = artworks.map((artwork) => {
        const result = {
          ...artwork,
          tags: artwork.artworkTags.map((at) => at.tag.name),
          imageCount: artwork._count?.images || 0,
          artworkTags: undefined as any,
          _count: undefined as any
        }
        // 删除undefined字段
        delete result.artworkTags
        delete result._count
        return result
      })

      return reply.send({ items, total, page, pageSize })
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
          images: true,
          artist: true,
          artworkTags: { include: { tag: true } }
        }
      })

      if (!artwork) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' })
      }

      // 转换数据格式，将多对多关系的标签转换为字符串数组
      const formattedArtwork = {
        ...artwork,
        tags: artwork.artworkTags.map((at) => at.tag.name),
        artworkTags: undefined as any
      }

      return reply.send(formattedArtwork)
    } catch (error) {
      server.log.error({ error }, 'Error fetching artwork')
      return reply.code(500).send({ error: 'Failed to fetch artwork' })
    }
  })
}