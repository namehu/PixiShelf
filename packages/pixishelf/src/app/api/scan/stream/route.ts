import { NextRequest, NextResponse } from 'next/server'
import { getScannerService } from '@/lib/services/scanner'
import { ScanProgress } from '@/types'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus } from '@prisma/client'

/**
 * 辅助函数：创建 SSE 事件发送器
 */
function createEventSender(controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  return (event: string, data: any) => {
    // 确保数据是对象或字符串，避免 undefined/null
    const safeData = data === undefined ? {} : data
    const message = `event: ${event}\ndata: ${JSON.stringify(safeData)}\n\n`
    controller.enqueue(encoder.encode(message))
  }
}

/**
 * 扫描 SSE 流处理逻辑
 * 支持 GET (全量扫描) 和 POST (指定列表扫描)
 */
async function handleScanStream(
  request: NextRequest,
  scanType: 'full' | 'list',
  metadataList?: string[]
): Promise<NextResponse> {
  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ error: 'SCAN_PATH is not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === 'true'
  const scannerService = getScannerService()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = createEventSender(controller, encoder)
      let currentJobId: string | null = null

      try {
        // 1. 尝试创建任务锁
        const job = await JobService.createScanJob()
        currentJobId = job.id
        logger.info(`Scan job created: ${job.id}`)

        // ==================== 执行者模式 ====================
        sendEvent('connection', { success: true, result: '连接成功，开始扫描' })

        // 节流控制：避免频繁写库
        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000 // 1秒

        const result = await scannerService.scan({
          scanPath,
          forceUpdate: force,
          metadataRelativePaths: scanType === 'list' ? metadataList : undefined,

          // 检查取消状态
          checkCancelled: async () => {
            if (!currentJobId) return false
            const job = await JobService.getJob(currentJobId)
            return job?.status === JobStatus.CANCELLING
          },

          // 进度回调
          onProgress: (progress: ScanProgress) => {
            // 1. 实时推送 SSE
            sendEvent('progress', progress)

            // 2. 节流写库
            const now = Date.now()
            if (now - lastDbUpdate > DB_UPDATE_INTERVAL && currentJobId) {
              JobService.updateProgress(currentJobId, progress.percentage || 0, progress.message || '').catch((err) =>
                logger.error('Failed to update job progress', err)
              )
              lastDbUpdate = now
            }
          }
        })

        // 任务完成
        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        logger.error('Scan stream error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'

        // 如果是取消错误，特殊处理
        if (errorMsg === 'Scan cancelled') {
          if (currentJobId) {
            await JobService.markAsCancelled(currentJobId)
          }
          sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
        } else {
          // 如果是因为"Scan already in progress"报错，不记录为任务失败（因为任务根本没创建成功）
          // 而是直接返回错误给客户端
          if (currentJobId) {
            await JobService.failJob(currentJobId, errorMsg)
          }
          sendEvent('error', { success: false, error: errorMsg })
        }
      } finally {
        controller.close()
      }
    },
    cancel() {
      // 客户端断开连接时的处理
      logger.info('Client disconnected from scan stream')
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  })
}

/**
 * GET /api/scan/stream
 * 全量扫描
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleScanStream(request, 'full')
}

/**
 * POST /api/scan/stream
 * 指定列表扫描
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: any = null
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const metadataList = Array.isArray(body?.metadataList) ? body.metadataList : []
  if (!metadataList?.length) {
    return NextResponse.json({ error: 'metadataList is required' }, { status: 400 })
  }

  return handleScanStream(request, 'list', metadataList)
}
