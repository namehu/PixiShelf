import { FastifyInstance } from 'fastify'

export default async function artworksRoutes(server: FastifyInstance) {
  server.get('/api/v1/artworks', async (req) => {
    const { page = '1', pageSize = '20' } = req.query as Record<string, string>
    const skip = (parseInt(page) - 1) * parseInt(pageSize)
    const take = parseInt(pageSize)
    const [items, total] = await Promise.all([
      server.prisma.artwork.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          images: {
            take: 1,
            orderBy: { id: 'asc' },
          },
          artist: true,
          _count: { select: { images: true } },
        },
      }),
      server.prisma.artwork.count(),
    ])
    return { items, total, page: Number(page), pageSize: Number(pageSize) }
  })

  server.get('/api/v1/artworks/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const artwork = await server.prisma.artwork.findUnique({
      where: { id: Number(id) },
      include: { images: true, artist: true },
    })
    if (!artwork) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Artwork not found' })
    return artwork
  })
}