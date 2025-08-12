import { FastifyInstance } from 'fastify'
import { ScanPathRequest, ScanPathResponse, SettingsUpdateResponse } from '@pixishelf/shared'

export default async function settingsRoutes(server: FastifyInstance) {
  server.get('/api/v1/settings/scan-path', async (): Promise<ScanPathResponse> => {
    const value = await server.settingService.getScanPath()
    return { scanPath: value }
  })

  server.put('/api/v1/settings/scan-path', async (req, reply) => {
    const body = req.body as ScanPathRequest
    const scanPath = body?.scanPath?.trim()
    if (!scanPath) return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'scanPath is required' })
    await server.settingService.setScanPath(scanPath)
    const response: SettingsUpdateResponse = { success: true }
    return response
  })
}