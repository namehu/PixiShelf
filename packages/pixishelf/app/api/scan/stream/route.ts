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
import { apiHandler } from '@/lib/api-handler'
import { ScanStreamSchema } from '@/schemas/scan.dto'
import { formatScanUserError, getRawErrorMessage, isScanCancelledError } from '@/services/scan-service/scan-errors'

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
        // Setup heartbeat (every 15s) to prevent proxy timeout
        pingInterval = setInterval(() => {
          try {
            const message = `event: ping\ndata: {}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (_e) {
            // Controller might be closed
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // Create job lock
        const job = await JobService.createScanJob()
        currentJobId = job.id
        const scanRun = await startScanRun({
          systemJobId: job.id,
          type: ScanRunType.PIXIV,
          mode: type === 'list' ? ScanRunMode.CLIENT_LIST : force ? ScanRunMode.FULL : ScanRunMode.INCREMENTAL
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
