import { FastifyInstance } from 'fastify'

export default async function artistsRoutes(server: FastifyInstance) {
  server.get('/api/v1/artists', async () => {
    const artists = await server.prisma.artist.findMany({ orderBy: { name: 'asc' } })
    return { items: artists }
  })
}