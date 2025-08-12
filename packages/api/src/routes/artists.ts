import { FastifyInstance } from 'fastify'
import { ArtistsResponse } from '@pixishelf/shared'
import { asApiResponse } from '../types/response'

export default async function artistsRoutes(server: FastifyInstance) {
  server.get('/api/v1/artists', async (): Promise<ArtistsResponse> => {
    const artists = await server.prisma.artist.findMany({ orderBy: { name: 'asc' } })
    
    // 使用类型转换辅助函数，实际转换由插件处理
    return { items: asApiResponse(artists) }
  })
}