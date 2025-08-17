import { FastifyInstance } from 'fastify'
import { FileScanner } from '../services/scanner'
import { config } from '../config'

export default async function scanRoutes(server: FastifyInstance) {
  server.get('/api/v1/scan/status', async () => ({
    scanning: server.appState.scanning,
    message: server.appState.lastProgressMessage
  }))

  server.post('/api/v1/scan', async (req, reply) => {
    const scanPath = await server.settingService.getScanPath()
    if (!scanPath) {
      reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
      return
    }

    if (server.appState.scanning) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Scan already in progress' })
    }
    server.appState.cancelRequested = false
    server.appState.scanning = true
    server.appState.lastProgressMessage = '初始化…'
    try {
      const body = req.body as { force?: boolean }
      const forceUpdate = body?.force === true

      const scanner = new FileScanner(server.prisma, server.log)
      const result = await scanner.scan({
        scanPath,
        forceUpdate,
        onProgress: (p) => {
          server.appState.lastProgressMessage = p?.message || null
          if (server.appState.cancelRequested) {
            throw new Error('Scan cancelled')
          }

          // 添加性能监控
          const metrics = scanner.getPerformanceMetrics()
          server.log.debug(
            {
              p,
              metrics: {
                throughput: metrics.throughput,
                memoryUsage: metrics.memoryUsage.heapUsed,
                concurrency: scanner.getConcurrencyStatus()
              }
            },
            'Scan progress with metrics'
          )
        }
      })

      const metrics = scanner.getPerformanceMetrics()
      const cacheStats = scanner.getCacheStats()
      console.log('性能报告:', { metrics, cacheStats })
      return { success: true, result }
    } catch (err: any) {
      if (err?.message === 'Scan cancelled') {
        return reply.code(499).send({ statusCode: 499, error: 'Client Closed Request', message: 'Scan cancelled' })
      }
      throw err
    } finally {
      server.appState.scanning = false
      server.appState.lastProgressMessage = null
    }
  })

  server.post('/api/v1/scan/cancel', async (_req, _reply) => {
    if (!server.appState.scanning) return { success: true, cancelled: false }
    server.appState.cancelRequested = true
    server.appState.lastProgressMessage = '正在取消…'
    return { success: true, cancelled: true }
  })

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
      const scanner = new FileScanner(server.prisma, server.log)

      const result = await scanner.scan({
        scanPath,
        forceUpdate,
        onProgress: (progress) => {
          server.appState.lastProgressMessage = progress?.message || null
          if (server.appState.cancelRequested) {
            throw new Error('Scan cancelled')
          }
          sendEvent('progress', progress)

          // 添加性能监控
          const metrics = scanner.getPerformanceMetrics()
          server.log.debug(
            {
              progress,
              metrics: {
                throughput: metrics.throughput,
                memoryUsage: metrics.memoryUsage.heapUsed,
                concurrency: scanner.getConcurrencyStatus()
              }
            },
            'Scan progress with metrics'
          )
        }
      })

      sendEvent('complete', { success: true, result })

      const metrics = scanner.getPerformanceMetrics()
      const cacheStats = scanner.getCacheStats()
      console.log('性能报告:', { metrics, cacheStats })
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
