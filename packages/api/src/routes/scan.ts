import { FastifyInstance } from 'fastify'
import { FileScanner } from '../services/scanner'
import { config } from '../config'
import { ScanStrategyType } from '@pixishelf/shared'
import { StrategyValidator, UnsupportedStrategyError } from '../services/scanner/StrategyValidator'
import { ConfigMigrator } from '../services/scanner/ConfigMigrator'

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
      const scanner = new FileScanner(server.prisma, server.log, {
        enableMetadataScanning: true
      })

      const [availability, recommendation] = await Promise.all([
        scanner.checkStrategyAvailability({ scanPath }),
        scanner.getRecommendedStrategy({ scanPath })
      ])

      return {
        supported: scanner.getSupportedStrategies(),
        current: scanner.getCurrentStrategy(),
        availability,
        recommendation
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
    
    // 策略验证和迁移
    let selectedScanType: ScanStrategyType | undefined
    if (scanType) {
      try {
        selectedScanType = StrategyValidator.validate(scanType)
      } catch (error) {
        if (error instanceof UnsupportedStrategyError) {
          const errorResponse = StrategyValidator.getStrategyError(scanType)
          reply.code(400).send(errorResponse)
          return
        }
        throw error
      }
    } else {
      // 如果没有指定策略，使用默认策略
      selectedScanType = StrategyValidator.getDefault()
    }

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
      // 添加API版本标识
      reply.raw.write(`event: version\n`)
      reply.raw.write(`data: ${JSON.stringify({ apiVersion: '2.0', supportedStrategies: StrategyValidator.getValidStrategies() })}\n\n`)
      
      const scanner = new FileScanner(server.prisma, server.log, {
        enableMetadataScanning: true // 统一启用元数据扫描
      })

      let result

      if (selectedScanType === 'unified') {
        // 使用统一扫描策略
        server.log.info({ scanType: selectedScanType }, 'Using unified scanning strategy')

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
      } else if (selectedScanType === 'legacy') {
        // 使用传统扫描策略
        server.log.info({ scanType: selectedScanType }, 'Using legacy scanning strategy')

        result = await scanner.scan({
          scanPath,
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
          // 理论上不应该到达这里，因为策略验证已经确保只有valid策略
          throw new Error(`Unsupported strategy: ${selectedScanType}`)
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
