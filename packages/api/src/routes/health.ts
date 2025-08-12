import { FastifyInstance } from 'fastify'
import { HealthResponse } from '@pixishelf/shared'

export default async function healthRoutes(server: FastifyInstance) {
  server.get('/api/v1/health', async (): Promise<HealthResponse> => {
    const scanPath = await server.settingService.getScanPath()
    return { status: 'ok', scanPath }
  })
}