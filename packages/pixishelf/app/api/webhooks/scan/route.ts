import 'server-only'

import { NextResponse } from 'next/server'
import { scan } from '@/services/scan-service'
import { prisma } from '@/lib/prisma'
import { getScanPath } from '@/services/setting.service'
import * as JobService from '@/services/job-service'
import { JobStatus, ScanRunMode, ScanRunType } from '@prisma/client'
import { apiHandler, ApiError } from '@/lib/api-handler'
import { ScanStreamSchema, ScanWebhookJobQuerySchema } from '@/schemas/scan.dto'
import logger from '@/lib/logger'
import { formatScanUserError, getRawErrorMessage, isScanCancelledError } from '@/services/scan-service/scan-errors'
import {
  cancelScanRun,
  completeScanRun,
  createScanRunItemBuffer,
  failScanRun,
  startScanRun
} from '@/services/scan-run-service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { enqueueCentralScan } from '@/services/media-root-central-service'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import {
  FULL_SCAN_RETIRED_MESSAGE,
  FULL_SCAN_RETIRED_REASON,
  isRetiredDirectoryFullScan
} from '@/services/scan-source-policy'

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

  const url = new URL(req.url)
  // 同一条 GET 接口通过是否带 jobId 区分：带 jobId 才做状态查询，不带则返回 webhook 可达性健康检查
  if (url.searchParams.has('jobId')) {
    const query = ScanWebhookJobQuerySchema.safeParse({ jobId: url.searchParams.get('jobId') })
    if (!query.success) {
      return NextResponse.json({ success: false, error: 'Invalid jobId' }, { status: 400 })
    }

    const job = await prisma.systemJob.findFirst({
      where: {
        id: query.data.jobId,
        // 仅允许查询 SYSTEM 触发的 SCAN 类型任务，防止外部凭证读取其他管理动作任务
        type: 'SCAN',
        triggerSource: 'SYSTEM',
        // definitionVersion >= 1 约束与新版任务定义对齐，避免返回过旧/不兼容记录
        definitionVersion: { gte: 1 }
      },
      select: {
        id: true,
        status: true,
        progress: true,
        message: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        scanRun: {
          select: {
            id: true,
            totalArtworks: true,
            processedArtworks: true,
            succeededArtworks: true,
            skippedArtworks: true,
            failedArtworks: true,
            newImages: true,
            durationMs: true,
            walkedEntries: true,
            metadataCandidates: true,
            inventoryUnchanged: true,
            contentHashed: true,
            contentChanged: true,
            parsedInputs: true,
            publishedInputs: true,
            failedInputs: true,
            discoveryDurationMs: true,
            hashDurationMs: true,
            publishDurationMs: true
          }
        }
      }
    })

    if (!job?.scanRun) {
      return NextResponse.json({ success: false, error: 'Scan job not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      scanRunId: job.scanRun.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      error: job.error ? formatScanUserError(job.error) : null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      data: {
        // 仅返回 webhook 端需要的统计面板字段，避免把可写字段或内部控制字段扩散到 webhook 响应契约
        totalArtworks: job.scanRun.totalArtworks,
        processedArtworks: job.scanRun.processedArtworks,
        succeededArtworks: job.scanRun.succeededArtworks,
        skippedArtworks: job.scanRun.skippedArtworks,
        failedArtworks: job.scanRun.failedArtworks,
        newImages: job.scanRun.newImages,
        durationMs: job.scanRun.durationMs,
        walkedEntries: job.scanRun.walkedEntries,
        metadataCandidates: job.scanRun.metadataCandidates,
        inventoryUnchanged: job.scanRun.inventoryUnchanged,
        contentHashed: job.scanRun.contentHashed,
        contentChanged: job.scanRun.contentChanged,
        parsedInputs: job.scanRun.parsedInputs,
        publishedInputs: job.scanRun.publishedInputs,
        failedInputs: job.scanRun.failedInputs,
        discoveryDurationMs: job.scanRun.discoveryDurationMs,
        hashDurationMs: job.scanRun.hashDurationMs,
        publishDurationMs: job.scanRun.publishDurationMs
      }
    })
  }

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
 * 在中央调度切换开启时，保持 202 入队语义：本接口只确认提交成功，不代表扫描已执行完成
 */
export const POST = apiHandler(ScanStreamSchema, async (req, data) => {
  const authError = validateWebhookAuth(req)
  if (authError) return authError

  const { type, force, metadataList } = data

  if (isRetiredDirectoryFullScan({ type, force })) {
    throw new ApiError(FULL_SCAN_RETIRED_MESSAGE, 410, { reason: FULL_SCAN_RETIRED_REASON })
  }

  if (isCentralDispatcherCutoverEnabled()) {
    // Central Dispatcher 下，排队行为是幂等可重试的；scan 直接执行已迁移到中央服务完成，避免本地阻塞超时
    const queued = await runBackgroundTaskApi(() =>
      enqueueCentralScan({
        triggerSource: 'SYSTEM',
        type: type === 'list' ? 'list' : 'all',
        force,
        metadataList
      })
    )
    return NextResponse.json({ success: true, queued: true, ...queued }, { status: 202 })
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    return NextResponse.json(
      { success: false, error: formatScanUserError('SCAN_PATH is not configured') },
      { status: 400 }
    )
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
  const scanRun = await startScanRun({
    systemJobId: job.id,
    type: ScanRunType.PIXIV,
    mode: type === 'list' ? ScanRunMode.CLIENT_LIST : force ? ScanRunMode.FULL : ScanRunMode.INCREMENTAL
  })
  const auditBuffer = createScanRunItemBuffer(scanRun.id)
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
      audit: {
        recordItems: auditBuffer.recordItems
      },
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
              // 进度写库为 best-effort：失败只会影响外部展示状态，不应导致扫描本体失败或中断
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

    const isCancelled = result.errors.some(isScanCancelledError)
    if (isCancelled) {
      await auditBuffer.flush()
      await flushProgressWrites()
      await JobService.markAsCancelled(job.id)
      await cancelScanRun(scanRun.id, result)
      return NextResponse.json(
        {
          success: false,
          jobId: job.id,
          error: formatScanUserError('Scan cancelled')
        },
        { status: 409 }
      )
    }

    await auditBuffer.flush()
    await flushProgressWrites()
    await JobService.completeJob(job.id, result)
    await completeScanRun(scanRun.id, result)

    return NextResponse.json({
      success: true,
      jobId: job.id,
      data: result
    })
  } catch (error: any) {
    logger.error('Webhook scan error:', error)
    const errorMsg = getRawErrorMessage(error)

    if (isScanCancelledError(error)) {
      await auditBuffer.flush()
      await flushProgressWrites()
      await JobService.markAsCancelled(job.id)
      await cancelScanRun(scanRun.id)
      return NextResponse.json(
        {
          success: false,
          jobId: job.id,
          error: formatScanUserError(error)
        },
        { status: 409 }
      )
    }

    await auditBuffer.flush()
    await flushProgressWrites()
    await JobService.failJob(job.id, errorMsg)
    await failScanRun(scanRun.id, errorMsg)

    return NextResponse.json(
      {
        success: false,
        jobId: job.id,
        error: formatScanUserError(error)
      },
      { status: 500 }
    )
  }
})
