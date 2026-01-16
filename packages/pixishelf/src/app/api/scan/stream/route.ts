import { NextResponse } from 'next/server'
import { getScannerService } from '@/lib/services/scanner'
import { ScanProgress } from '@/types'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus } from '@prisma/client'
import { apiHandler } from '@/lib/api-handler'
import { ScanStreamSchema } from '@/schemas/scan.dto'

/**
 * Helper: Create SSE event sender
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
 * Unified scan stream endpoint
 */
export const POST = apiHandler(ScanStreamSchema, async (req, data) => {
  const { type, force, metadataList } = data

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ error: 'SCAN_PATH is not configured' }, { status: 400 })
  }

  const scannerService = getScannerService()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = createEventSender(controller, encoder)
      let currentJobId: string | null = null
      let pingInterval: NodeJS.Timeout | null = null

      try {
        // Setup heartbeat (every 15s) to prevent proxy timeout
        pingInterval = setInterval(() => {
          try {
            const message = `event: ping\ndata: {}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (e) {
            // Controller might be closed
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // Create job lock
        const job = await JobService.createScanJob()
        currentJobId = job.id
        logger.info(`Scan job created: ${job.id}`)

        sendEvent('connection', { success: true, result: '连接成功，开始扫描' })

        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000

        const result = await scannerService.scan({
          scanPath,
          forceUpdate: force,
          metadataRelativePaths: type === 'list' ? metadataList : undefined,
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

        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        logger.error('Scan stream error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'

        if (errorMsg === 'Scan cancelled') {
          if (currentJobId) {
            await JobService.markAsCancelled(currentJobId)
          }
          sendEvent('cancelled', { success: false, error: 'Scan cancelled' })
        } else {
          if (currentJobId) {
            await JobService.failJob(currentJobId, errorMsg)
          }
          sendEvent('error', { success: false, error: errorMsg })
        }
      } finally {
        if (pingInterval) clearInterval(pingInterval)
        try {
          controller.close()
        } catch (e) {
          // Ignore close errors (e.g. client disconnected)
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
