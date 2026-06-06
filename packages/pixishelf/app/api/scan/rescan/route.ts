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

/**
 * Helper: Create SSE event sender
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
 * 根据作品 externalId 重新扫描该作品
 */
export const POST = apiHandler(ScanRescanSchema, async (req, data) => {
  const { externalId } = data

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ error: 'SCAN_PATH is not configured' }, { status: 400 })
  }

  // 服务端查询获取相对路径，防止路径穿透
  const artwork = await prisma.artwork.findUnique({
    where: { externalId },
    include: {
      artist: true,
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
      let pingInterval: NodeJS.Timeout | null = null
      const streamState = { closed: false }
      const sendEvent = createEventSender(controller, encoder, streamState)

      try {
        // Setup heartbeat (every 15s)
        pingInterval = setInterval(() => {
          if (!sendEvent('ping', {})) {
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // Create job lock
        const job = await JobService.createScanJob()
        currentJobId = job.id
        logger.info(`Rescan job created: ${job.id} for artwork ${artwork.id} ${artwork.title} ${relativePath}`)

        sendEvent('connection', { success: true, result: '连接成功，开始重新扫描' })

        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000

        const scanOptions = {
          scanPath,
          forceUpdate: false,
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

        const result =
          artwork.source === 'LOCAL_CREATED'
            ? await rescanLocalArtwork(scanOptions, artwork.id, relativePath)
            : await rescanArtwork(scanOptions, artwork.externalId!, relativePath)

        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        logger.error('Rescan stream error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'

        if (currentJobId) {
          await JobService.failJob(currentJobId, errorMsg)
        }
        sendEvent('error', { success: false, error: errorMsg })
      } finally {
        if (pingInterval) clearInterval(pingInterval)
        if (!streamState.closed) {
          try {
            controller.close()
          } catch (_e) {
            // Ignore
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
