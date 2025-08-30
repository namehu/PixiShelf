import { FastifyInstance } from 'fastify'
import { ScannerService } from '../services/scanner.service'
import { ScanProgress } from '@pixishelf/shared'

export default async function scanRoutes(server: FastifyInstance) {
  server.get('/api/v1/scan/status', async () => ({
    scanning: server.appState.scanning,
    message: server.appState.lastProgressMessage
  }))

  server.post(
    '/api/v1/scan/cancel',
    {
      preHandler: async (request, reply) => {
        // 对于这个接口，我们不需要解析请求体，直接跳过
        if (request.headers['content-type'] === 'application/json' && !request.body) {
          request.body = {}
        }
      }
    },
    async (_req, _reply) => {
      if (!server.appState.scanning) return { success: true, cancelled: false }
      server.appState.cancelRequested = true
      server.appState.lastProgressMessage = '正在取消…'
      return { success: true, cancelled: true }
    }
  )

  server.get('/api/v1/scan/stream', async (req, reply) => {
    const scanPath = await server.settingService.getScanPath()
    if (!scanPath) {
      reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
      return
    }

    const { force } = req.query as { force?: string }
    const forceUpdate = force === 'true'

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`)
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    if (server.appState.scanning) {
      sendEvent('error', { success: false, error: 'Scan already in progress' })
      reply.raw.end()
      return
    }

    server.appState.scanning = true
    server.appState.cancelRequested = false
    server.appState.lastProgressMessage = '初始化…'

    try {
      // 使用统一的元数据扫描功能
      const scanner = new ScannerService(server.prisma, server.log)

      server.log.info('Using unified metadata scanning')

      const result = await scanner.scan({
        scanPath,
        forceUpdate,
        onProgress: (progress: ScanProgress) => {
          server.appState.lastProgressMessage = progress?.message || null
          if (server.appState.cancelRequested) {
            throw new Error('Scan cancelled')
          }
          sendEvent('progress', progress)
        }
      })

      sendEvent('complete', { success: true, result })
    } catch (error: any) {
      if (error?.message === 'Scan cancelled') {
        sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
      } else {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        sendEvent('error', { success: false, error: errorMsg })
      }
    } finally {
      server.appState.scanning = false
      server.appState.lastProgressMessage = null
    }

    reply.raw.end()
  })
}
