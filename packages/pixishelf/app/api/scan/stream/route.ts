import 'server-only'

import { NextResponse } from 'next/server'
import { scan } from '@/services/scan-service'
import { ScanProgress } from '@/types'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus, ScanRunMode, ScanRunType } from '@prisma/client'
import {
  cancelScanRun,
  completeScanRun,
  createScanRunItemBuffer,
  failScanRun,
  startScanRun
} from '@/services/scan-run-service'
import { apiHandler, ApiError } from '@/lib/api-handler'
import { ScanStreamSchema } from '@/schemas/scan.dto'
import { formatScanUserError, getRawErrorMessage, isScanCancelledError } from '@/services/scan-service/scan-errors'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { enqueueCentralScan } from '@/services/media-root-central-service'
import { queuedSseResponse } from '@/services/background-task/queued-sse-response'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import {
  FULL_SCAN_RETIRED_MESSAGE,
  FULL_SCAN_RETIRED_REASON,
  isRetiredDirectoryFullScan
} from '@/services/scan-source-policy'

/**
 * SSE 事件发送器：将事件名与负载格式化为 SSE 原始文本分块发送
 */
function createEventSender(controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  return (event: string, data: any) => {
    const safeData = data === undefined ? {} : data
    const message = `event: ${event}\ndata: ${JSON.stringify(safeData)}\n\n`
    controller.enqueue(encoder.encode(message))
  }
}

/**
 * POST /api/scan/stream
 * 统一扫描流式入口，支持增量/全量/列表扫描
 */
export const POST = apiHandler(ScanStreamSchema, async (req, data) => {
  const { type, force, metadataList } = data
  const { userId } = await requireAdminRequest(req)

  if (isRetiredDirectoryFullScan({ type, force })) {
    throw new ApiError(FULL_SCAN_RETIRED_MESSAGE, 410, { reason: FULL_SCAN_RETIRED_REASON })
  }

  if (isCentralDispatcherCutoverEnabled()) {
    const queued = await runBackgroundTaskApi(() =>
      enqueueCentralScan({
        requestedByUserId: userId,
        type: type === 'list' ? 'list' : 'all',
        force,
        metadataList
      })
    )
    return queuedSseResponse(queued)
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ error: formatScanUserError('SCAN_PATH is not configured') }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = createEventSender(controller, encoder)
      let currentJobId: string | null = null
      let currentScanRunId: string | null = null
      let auditBuffer: ReturnType<typeof createScanRunItemBuffer> | null = null
      let pingInterval: NodeJS.Timeout | null = null

      try {
        // 每 15 秒发送一次心跳，避免反向代理中断长连接
        pingInterval = setInterval(() => {
          try {
            const message = `event: ping\ndata: {}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (_e) {
            // 流控制器可能已关闭（例如客户端断开）
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // 建立扫描任务锁，确保同一扫描会话可追踪与可取消
        const job = await JobService.createScanJob()
        currentJobId = job.id
        const scanRun = await startScanRun({
          systemJobId: job.id,
          type: ScanRunType.PIXIV,
          mode: type === 'list' ? ScanRunMode.CLIENT_LIST : ScanRunMode.INCREMENTAL
        })
        currentScanRunId = scanRun.id
        auditBuffer = createScanRunItemBuffer(scanRun.id)
        logger.info(`Scan job created: ${job.id}`)

        sendEvent('connection', { success: true, result: '连接成功，开始扫描' })

        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000

        const result = await scan({
          scanPath,
          forceUpdate: force,
          metadataRelativePaths: type === 'list' ? metadataList : undefined,
          audit: {
            recordItems: auditBuffer.recordItems
          },
          checkCancelled: async () => {
            if (!currentJobId) return false
            const job = await JobService.getJob(currentJobId)
            return job?.status === JobStatus.CANCELLING
          },
          onProgress: (progress: ScanProgress) => {
            sendEvent('progress', progress)
            const now = Date.now()
            if (now - lastDbUpdate > DB_UPDATE_INTERVAL && currentJobId) {
              JobService.updateProgress(currentJobId, progress.percentage || 0, progress.message || '').catch((err) =>
                logger.error('Failed to update job progress', err)
              )
              lastDbUpdate = now
            }
          }
        })

        if (result.errors.some(isScanCancelledError)) {
          await auditBuffer.flush()
          if (currentJobId) {
            await JobService.markAsCancelled(currentJobId)
          }
          if (currentScanRunId) {
            await cancelScanRun(currentScanRunId, result)
          }
          sendEvent('cancelled', { success: false, error: formatScanUserError('Scan cancelled') })
          return
        }

        await auditBuffer.flush()
        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        if (currentScanRunId) {
          await completeScanRun(currentScanRunId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        logger.error('Scan stream error:', error)
        const errorMsg = getRawErrorMessage(error)
        const userErrorMsg = formatScanUserError(error)

        if (isScanCancelledError(error)) {
          await auditBuffer?.flush()
          if (currentJobId) {
            await JobService.markAsCancelled(currentJobId)
          }
          if (currentScanRunId) {
            await cancelScanRun(currentScanRunId)
          }
          sendEvent('cancelled', { success: false, error: userErrorMsg })
        } else {
          await auditBuffer?.flush()
          if (currentJobId) {
            await JobService.failJob(currentJobId, errorMsg)
          }
          if (currentScanRunId) {
            await failScanRun(currentScanRunId, errorMsg)
          }
          sendEvent('error', { success: false, error: userErrorMsg })
        }
      } finally {
        if (pingInterval) clearInterval(pingInterval)
        try {
          controller.close()
        } catch (_e) {
          // 忽略关闭阶段可能出现的错误（如客户端断开连接）
        }
      }
    },
    cancel() {
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
})
