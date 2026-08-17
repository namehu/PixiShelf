import 'server-only'
import { NextResponse } from 'next/server'
import { rescanArtwork, rescanLocalArtwork } from '@/services/scan-service'
import { ScanProgress } from '@/types'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { apiHandler } from '@/lib/api-handler'
import { ScanRescanSchema } from '@/schemas/scan.dto'
import { prisma } from '@/lib/prisma'
import { determineArtworkRelDir } from '@/services/artwork-service/utils'
import { isLocalDirectoryArtworkSource } from '@/utils/artwork/artwork-source'
import { formatScanUserError, getRawErrorMessage } from '@/services/scan-service/scan-errors'
import { ScanRunMode } from '@prisma/client'
import {
  completeScanRun,
  createScanRunItemBuffer,
  failScanRun,
  getScanRunTypeForArtworkSource,
  startScanRun
} from '@/services/scan-run-service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { requireAdminRequest } from '@/services/background-task/request-auth'
import { enqueueCentralArtworkRescan } from '@/services/media-root-central-service'
import { queuedSseResponse } from '@/services/background-task/queued-sse-response'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'

/**
 * SSE 事件发送器：统一封装 heartbeat 与连接关闭后的失败判定
 */
function createEventSender(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  streamState: { closed: boolean }
) {
  return (event: string, data: any) => {
    if (streamState.closed) return false
    const safeData = data === undefined ? {} : data
    const message = `event: ${event}\ndata: ${JSON.stringify(safeData)}\n\n`
    try {
      controller.enqueue(encoder.encode(message))
      return true
    } catch (error) {
      logger.warn('Failed to send rescan SSE event; client stream is likely closed', {
        event,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      streamState.closed = true
      return false
    }
  }
}

/**
 * POST /api/scan/rescan
 * 按作品重扫：优先按本地目录作品来源走本地重扫，兜底按历史 Pixiv 引用重扫
 */
export const POST = apiHandler(ScanRescanSchema, async (req, data) => {
  const { artworkId, externalId } = data
  const { userId } = await requireAdminRequest(req)

  if (isCentralDispatcherCutoverEnabled()) {
    const target = await prisma.artwork.findUnique({
      where: artworkId !== undefined ? { id: artworkId } : { externalId: externalId! },
      select: { id: true }
    })
    if (!target) return NextResponse.json({ error: 'Artwork not found' }, { status: 404 })
    const queued = await runBackgroundTaskApi(() =>
      enqueueCentralArtworkRescan({ artworkId: target.id, requestedByUserId: userId })
    )
    return queuedSseResponse(queued)
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ error: formatScanUserError('SCAN_PATH is not configured') }, { status: 400 })
  }

  // 服务端查询获取相对路径，防止路径穿透
  const artwork = await prisma.artwork.findUnique({
    where: artworkId !== undefined ? { id: artworkId } : { externalId: externalId! },
    include: {
      artist: true,
      externalRefs: { where: { providerKey: 'pixiv' }, take: 1 },
      images: {
        orderBy: { sortOrder: 'asc' },
        take: 1
      }
    }
  })

  if (!artwork) {
    return NextResponse.json({ error: 'Artwork not found' }, { status: 404 })
  }

  const relativePath = determineArtworkRelDir(artwork)
  if (!relativePath) {
    return NextResponse.json({ error: 'Cannot determine artwork path' }, { status: 400 })
  }

  // 简单的安全检查：确保路径不包含 ..
  if (relativePath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path detected' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let currentJobId: string | null = null
      let currentScanRunId: string | null = null
      let auditBuffer: ReturnType<typeof createScanRunItemBuffer> | null = null
      let pingInterval: NodeJS.Timeout | null = null
      const streamState = { closed: false }
      const sendEvent = createEventSender(controller, encoder, streamState)

      try {
        // 每 15 秒发一次 ping，保持长连接活跃
        pingInterval = setInterval(() => {
          if (!sendEvent('ping', {})) {
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // 建立扫描任务锁，用于前端取消/日志及任务完成状态更新
        const job = await JobService.createScanJob()
        currentJobId = job.id
        const scanRun = await startScanRun({
          systemJobId: job.id,
          type: getScanRunTypeForArtworkSource(artwork.source),
          mode: isLocalDirectoryArtworkSource(artwork.source) ? ScanRunMode.LOCAL_RESCAN : ScanRunMode.RESCAN
        })
        currentScanRunId = scanRun.id
        auditBuffer = createScanRunItemBuffer(scanRun.id)
        logger.info(`Rescan job created: ${job.id} for artwork ${artwork.id} ${artwork.title} ${relativePath}`)

        sendEvent('connection', { success: true, result: '连接成功，开始重新扫描' })

        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000

        const scanOptions = {
          scanPath,
          forceUpdate: false,
          audit: {
            recordItems: auditBuffer.recordItems
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
        }

        const pixivReference = artwork.externalRefs[0]
        const result = isLocalDirectoryArtworkSource(artwork.source)
          ? await rescanLocalArtwork(scanOptions, artwork.id, relativePath)
          : pixivReference
            ? await rescanArtwork(scanOptions, pixivReference.externalId, relativePath)
            : (() => {
                throw new Error('作品没有 Pixiv Source Reference，拒绝按历史 externalId 猜测来源')
              })()

        await auditBuffer.flush()
        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        if (currentScanRunId) {
          await completeScanRun(currentScanRunId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        logger.error('Rescan stream error:', error)
        const errorMsg = getRawErrorMessage(error)
        const userErrorMsg = formatScanUserError(error)

        await auditBuffer?.flush()
        if (currentJobId) {
          await JobService.failJob(currentJobId, errorMsg)
        }
        if (currentScanRunId) {
          await failScanRun(currentScanRunId, errorMsg)
        }
        sendEvent('error', { success: false, error: userErrorMsg })
      } finally {
        if (pingInterval) clearInterval(pingInterval)
        if (!streamState.closed) {
          try {
            controller.close()
          } catch (_e) {
            // 忽略关闭阶段可能出现的错误
          }
        }
      }
    },
    cancel() {
      logger.info('Client disconnected from rescan stream')
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
