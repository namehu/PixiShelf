import 'server-only'

import { NextResponse } from 'next/server'
import { scan } from '@/services/scan-service'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus } from '@prisma/client'
import { apiHandler } from '@/lib/api-handler'
import { ScanStreamSchema } from '@/schemas/scan.dto'
import logger from '@/lib/logger'

function validateWebhookAuth(req: Request) {
  const authHeader = req.headers.get('Authorization')
  const expectedToken = process.env.SCAN_WEBHOOK_TOKEN

  if (!expectedToken) {
    logger.warn('Webhook scan attempted but SCAN_WEBHOOK_TOKEN is not set')
    return NextResponse.json(
      { success: false, error: 'Webhook service is not configured (SCAN_WEBHOOK_TOKEN missing)' },
      { status: 503 }
    )
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

export async function GET(req: Request) {
  const authError = validateWebhookAuth(req)
  if (authError) return authError

  return NextResponse.json({
    success: true,
    data: {
      status: 'ok'
    }
  })
}

export async function HEAD(req: Request) {
  const authError = validateWebhookAuth(req)
  if (authError) return authError

  return new NextResponse(null, { status: 204 })
}

/**
 * POST /api/webhooks/scan
 * 使用 Bearer Token 认证通过 Webhook 触发扫描
 */
export const POST = apiHandler(ScanStreamSchema, async (req, data) => {
  const authError = validateWebhookAuth(req)
  if (authError) return authError

  const { type, force, metadataList } = data

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json({ success: false, error: 'SCAN_PATH is not configured' }, { status: 400 })
  }

  let job: Awaited<ReturnType<typeof JobService.createScanJob>>
  try {
    job = await JobService.createScanJob()
  } catch (error) {
    if (error instanceof Error && error.message === 'Scan already in progress') {
      return NextResponse.json({ success: false, error: 'Scan already in progress' }, { status: 409 })
    }
    throw error
  }
  logger.info(`Webhook scan job started: ${job.id} (type: ${type})`)
  const pendingProgressWrites = new Set<Promise<void>>()
  const flushProgressWrites = async () => {
    if (pendingProgressWrites.size === 0) return
    await Promise.allSettled(Array.from(pendingProgressWrites))
  }

  try {
    let lastDbUpdate = 0
    const DB_UPDATE_INTERVAL = 2000 // Webhook 场景下减少数据库更新频率

    // 3. 执行扫描（阻塞式）
    // 注意：Vercel/Serverless 函数存在超时限制（通常 10-60 秒）。
    // 若扫描耗时更长，可能会触发超时；大规模扫描建议改为异步处理。
    const result = await scan({
      scanPath,
      forceUpdate: force,
      // 当 type 为 'list' 时，使用传入的 metadataList
      metadataRelativePaths: type === 'list' ? metadataList : undefined,
      checkCancelled: async () => {
        const currentJob = await JobService.getJob(job.id)
        return currentJob?.status === JobStatus.CANCELLING
      },
      onProgress: (progress) => {
        const now = Date.now()
        // 定时将任务进度更新到数据库
        if (now - lastDbUpdate > DB_UPDATE_INTERVAL) {
          let progressWrite: Promise<void>
          progressWrite = JobService.updateProgress(job.id, progress.percentage || 0, progress.message || '')
            .catch((err) => {
              logger.error('Failed to update job progress', err)
            })
            .finally(() => {
              pendingProgressWrites.delete(progressWrite)
            })
          pendingProgressWrites.add(progressWrite)
          lastDbUpdate = now
        }
      }
    })

    const isCancelled = result.errors.includes('Scan cancelled')
    if (isCancelled) {
      await flushProgressWrites()
      await JobService.markAsCancelled(job.id)
      return NextResponse.json(
        {
          success: false,
          jobId: job.id,
          error: 'Scan cancelled'
        },
        { status: 409 }
      )
    }

    await flushProgressWrites()
    await JobService.completeJob(job.id, result)

    return NextResponse.json({
      success: true,
      jobId: job.id,
      data: result
    })
  } catch (error: any) {
    logger.error('Webhook scan error:', error)
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'

    if (errorMsg === 'Scan cancelled') {
      await flushProgressWrites()
      await JobService.markAsCancelled(job.id)
      return NextResponse.json(
        {
          success: false,
          jobId: job.id,
          error: 'Scan cancelled'
        },
        { status: 409 }
      )
    }

    await flushProgressWrites()
    await JobService.failJob(job.id, errorMsg)

    return NextResponse.json(
      {
        success: false,
        jobId: job.id,
        error: errorMsg
      },
      { status: 500 }
    )
  }
})
