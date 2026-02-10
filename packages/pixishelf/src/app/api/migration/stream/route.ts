import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-handler'
import { runMigrationJob, MigrationStats } from '@/services/migration-service'
import { migrationLogger } from '@/lib/logger'
import * as JobService from '@/services/job-service'
import { JobStatus } from '@prisma/client'

// 定义 Schema，支持 targetIds
const MigrationSchema = z.object({
  targetIds: z.array(z.number()).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
  search: z.string().nullish().optional(),
  artistName: z.string().nullish().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullish(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullish(),
  externalId: z.string().nullish().optional(),
  exactMatch: z.boolean().optional(),
  transferMode: z.enum(['move', 'copy']).optional(),
  verifyAfterCopy: z.boolean().optional(),
  cleanupSource: z.boolean().optional()
})

function createEventSender(controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  return (event: string, data: any) => {
    const safeData = data === undefined ? {} : data
    const message = `event: ${event}\ndata: ${JSON.stringify(safeData)}\n\n`
    controller.enqueue(encoder.encode(message))
  }
}

export const POST = apiHandler(MigrationSchema, async (req, data) => {
  const { targetIds, batchSize, concurrency } = data
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = createEventSender(controller, encoder)
      let currentJobId: string | null = null
      let pingInterval: NodeJS.Timeout | null = null

      try {
        // 心跳包 (防止连接超时)
        pingInterval = setInterval(() => {
          try {
            const message = `event: ping\ndata: {}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (e) {
            if (pingInterval) clearInterval(pingInterval)
          }
        }, 15000)

        // 创建任务
        const job = await JobService.createMigrationJob()
        currentJobId = job.id
        migrationLogger.info(`Migration job created: ${job.id}`)

        sendEvent('connection', { success: true, result: '连接成功，开始迁移' })

        let lastDbUpdate = 0
        const DB_UPDATE_INTERVAL = 1000

        const result = await runMigrationJob(
          (stats: MigrationStats, msg: string[]) => {
            const progress = stats.total > 0 ? Math.floor((stats.processed / stats.total) * 100) : 0

            // 发送给前端
            sendEvent('progress', {
              progress,
              message: msg,
              stats
            })

            // 更新数据库
            const now = Date.now()
            if (now - lastDbUpdate > DB_UPDATE_INTERVAL && currentJobId) {
              JobService.updateProgress(currentJobId, progress, msg.join('\n')).catch((err) =>
                migrationLogger.error('Failed to update job progress', err)
              )
              lastDbUpdate = now
            }
          },
          // checkCancelled
          async () => {
            if (!currentJobId) return false
            const job = await JobService.getJob(currentJobId)
            return job?.status === JobStatus.CANCELLING
          },
          async () => {
            if (!currentJobId) return false
            const job = await JobService.getJob(currentJobId)
            return job?.status === JobStatus.PAUSED
          },
          (state) => {
            sendEvent(state === 'PAUSED' ? 'paused' : 'resumed', { state })
          },
          {
            targetIds,
            batchSize,
            concurrency,
            filters: {
              search: data.search ?? null,
              artistName: data.artistName ?? null,
              startDate: data.startDate ?? null,
              endDate: data.endDate ?? null,
              externalId: data.externalId ?? null,
              exactMatch: data.exactMatch ?? false
            },
            safety: {
              transferMode: data.transferMode,
              verifyAfterCopy: data.verifyAfterCopy,
              cleanupSource: data.cleanupSource
            }
          }
        )

        if (currentJobId) {
          await JobService.completeJob(currentJobId, result)
        }
        sendEvent('complete', { success: true, result })
      } catch (error: any) {
        migrationLogger.error('Migration stream error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'

        if (errorMsg === 'Migration cancelled') {
          if (currentJobId) {
            await JobService.markAsCancelled(currentJobId)
          }
          sendEvent('cancelled', { success: false, error: 'Migration cancelled' })
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
        } catch (e) {}
      }
    },
    cancel() {
      migrationLogger.info('Client disconnected from migration stream')
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
