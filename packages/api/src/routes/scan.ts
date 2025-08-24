import { FastifyInstance } from 'fastify'
import { FileScanner } from '../services/scanner'
import { ScanStrategyType } from '@pixishelf/shared'

export default async function scanRoutes(server: FastifyInstance) {
  server.get('/api/v1/scan/status', async () => ({
    scanning: server.appState.scanning,
    message: server.appState.lastProgressMessage
  }))

  // 新增：获取扫描策略信息
  server.get('/api/v1/scan/strategies', async (req, reply) => {
    const scanPath = await server.settingService.getScanPath()
    if (!scanPath) {
      reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'SCAN_PATH is not configured' })
      return
    }

    try {
      return {
        supported: ['unified'],
        current: {
          name: 'unified',
          description: 'Unified scan processing metadata and media files together in a pipeline'
        },
        availability: {
          unified: {
            available: true,
            issues: [],
            estimatedDuration: 10000
          }
        },
        recommendation: {
          recommended: 'unified',
          reason: 'Unified scan provides better performance and user experience with continuous processing',
          alternatives: []
        }
      }
    } catch (error) {
      server.log.error({ error }, 'Failed to get strategy information')
      reply
        .code(500)
        .send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to get strategy information' })
    }
  })

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

    const { force, scanType } = req.query as { force?: string; scanType?: string }
    const forceUpdate = force === 'true'
    const selectedScanType = scanType as ScanStrategyType | undefined

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
      // 检查是否启用元数据扫描
      const enableMetadataScanning = selectedScanType === 'unified'

      const scanner = new FileScanner(server.prisma, server.log, {
        enableMetadataScanning
      })

      let result

      if (enableMetadataScanning) {
        // 使用新的元数据扫描功能
        server.log.info({ scanType: selectedScanType }, 'Using metadata scanning')

        result = await scanner.scanWithMetadata({
          scanPath,
          scanType: selectedScanType,
          forceUpdate,
          onProgress: (progress) => {
            server.appState.lastProgressMessage = progress?.message || null
            if (server.appState.cancelRequested) {
              throw new Error('Scan cancelled')
            }
            sendEvent('progress', progress)
          }
        })
      } else {
        // 使用传统扫描功能
        server.log.info('Using legacy scanning')

        result = await scanner.scan({
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
      }

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
