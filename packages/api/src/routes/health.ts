import { FastifyInstance } from 'fastify'

export default async function healthRoutes(server: FastifyInstance) {
  server.get('/api/v1/health', async () => ({ status: 'ok', scanPath: await server.settingService.getScanPath() }))
}