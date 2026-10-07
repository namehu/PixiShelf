import { apiHandler } from '@/lib/api-handler'
import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { ScanStreamSchema, ScanWebhookJobQuerySchema } from '@/schemas/scan.dto'
import { runBackgroundTaskApi } from '@/services/background-task/api-error-mapping'
import { enqueueCentralScan } from '@/services/media-root-central-service'
import { formatScanUserError } from '@/services/scan-service/scan-errors'
import { NextResponse } from 'next/server'
import 'server-only'
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
  const { type, metadataList } = data
  {
    // Central Dispatcher 下，排队行为是幂等可重试的；scan 直接执行已迁移到中央服务完成，避免本地阻塞超时
    const queued = await runBackgroundTaskApi(() =>
      enqueueCentralScan({
        triggerSource: 'SYSTEM',
        type: type === 'list' ? 'list' : 'all',
        metadataList
      })
    )
    return NextResponse.json({ success: true, queued: true, ...queued }, { status: 202 })
  }
})
