import { NextRequest, NextResponse } from 'next/server'
import { getScannerService } from '@/lib/services/scanner'
import { ScanProgress } from '@/types'
import logger from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus } from '@prisma/client'

/**
 * Request body for scan stream
 */
interface ScanRequestBody {
  type: 'full' | 'list'
  force?: boolean
  metadataList?: string[]
}

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
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: ScanRequestBody
  try {
    body = await request.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type = 'full', force = false, metadataList = [] } = body

  // Validate inputs
  if (type === 'list' && (!Array.isArray(metadataList) || metadataList.length === 0)) {
    return NextResponse.json({ error: 'metadataList is required for list scan' }, { status: 400 })
  }

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

      try {
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
        controller.close()
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
}
