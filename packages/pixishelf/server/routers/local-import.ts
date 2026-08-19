import { TRPCError } from '@trpc/server'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
  assertLegacyBackgroundExecutionAllowed,
  LegacyBackgroundExecutionDisabledError
} from '@/services/background-task/dispatcher-cutover'
import { saveLocalImportArtistMappingsSchema, startLocalImportSchema } from '@/schemas/local-import.dto'
import { getScanPath, getSystemSettings } from '@/services/setting.service'
import { discoverLocalImports, runLocalImport, saveLocalImportArtistMappings } from '@/services/local-import-service'
import * as JobService from '@/services/job-service'
import logger from '@/lib/logger'
import { ScanRunMode, ScanRunType } from '@prisma/client'
import {
  cancelScanRun,
  completeScanRunSummary,
  createScanRunItemBuffer,
  failScanRun,
  startScanRun
} from '@/services/scan-run-service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { enqueueCentralLocalDirectoryImport } from '@/services/media-root-central-service'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { classifyBackgroundTaskTransportError } from '@/services/background-task/transport-error'

async function requireScanPath() {
  // 本地导入要求必须先有可用扫描根路径；未配置时直接阻断整个流程，避免写入到未知目录。
  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  }
  return scanPath
}

function assertLegacyLocalImportAllowed() {
  try {
    assertLegacyBackgroundExecutionAllowed('LOCAL_DIRECTORY_IMPORT')
  } catch (error) {
    if (error instanceof LegacyBackgroundExecutionDisabledError) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
    }
    throw error
  }
}

/**
 * 本地目录导入路由：
 * - 预览仅扫描目录结构，不会触发写库；
 * - start 会创建本地导入作业并异步执行，返回 jobId 后立即返回；
 * - 运行期间通过扫描任务记录与作业进度持久化每一步状态，便于前端轮询。
 */
export const localImportRouter = router({
  preview: authProcedure.query(async () => {
    const scanPath = await requireScanPath()
    return discoverLocalImports({ scanPath })
  }),

  saveMappings: adminProcedure.input(saveLocalImportArtistMappingsSchema).mutation(async ({ input }) => {
    return saveLocalImportArtistMappings(input)
  }),

  start: adminProcedure.input(startLocalImportSchema).mutation(async ({ input, ctx }) => {
    if (isCentralDispatcherCutoverEnabled()) {
      try {
        const queued = await enqueueCentralLocalDirectoryImport({
          requestedByUserId: ctx.userId!,
          storagePaths: input.storagePaths
        })
        return { jobId: queued.jobId, queued: true, scanRunId: queued.scanRunId }
      } catch (error) {
        const classified = classifyBackgroundTaskTransportError(error)
        if (classified) throw new TRPCError({ code: classified.trpcCode, message: classified.message })
        throw error
      }
    }
    assertLegacyLocalImportAllowed()
    const scanPath = await requireScanPath()
    const systemSettings = await getSystemSettings()
    let job
    try {
      job = await JobService.createLocalDirectoryImportJob()
    } catch (error) {
      if (error instanceof Error && error.message.includes('already in progress')) {
        throw new TRPCError({ code: 'CONFLICT', message: error.message })
      }
      throw error
    }
    const scanRun = await startScanRun({
      systemJobId: job.id,
      type: ScanRunType.LOCAL_IMPORT,
      mode: ScanRunMode.LOCAL_DIRECTORY_IMPORT
    })
    const auditBuffer = createScanRunItemBuffer(scanRun.id)

    void (async () => {
      try {
        // 采用缓冲器批量记录扫描项，成功/失败路径都需要 flush，避免扫描被中断时丢失状态。
        const result = await runLocalImport({
          scanPath,
          defaultTagIds: systemSettings.local_import_default_tag_ids,
          audit: {
            recordItems: auditBuffer.recordItems
          },
          checkCancelled: async () => {
            const current = await JobService.getJob(job.id)
            return current?.status === 'CANCELLING'
          },
          onProgress: async ({ current, total, artistDirectory, relativeDirectory, status }) => {
            const percentage = total > 0 ? Math.round(5 + (current / total) * 90) : 95
            await JobService.updateProgress(job.id, percentage, `${artistDirectory}/${relativeDirectory}: ${status}`)
          }
        })
        await auditBuffer.flush()
        await JobService.completeJob(job.id, result)
        // 导入结果摘要用于 scan run 历史页展示；错误信息最多保留前 5 条作为前端可读反馈。
        await completeScanRunSummary(scanRun.id, {
          totalArtworks: result.total,
          skippedArtworks: result.skipped,
          newImages: result.newImages,
          durationMs: result.processingTime,
          errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('\n') : null
        })
      } catch (error) {
        logger.error('Local directory import failed', { error, jobId: job.id })
        const current = await JobService.getJob(job.id)
        await auditBuffer.flush()
        if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
          await JobService.markAsCancelled(job.id)
          await cancelScanRun(scanRun.id)
        } else {
          const message = error instanceof Error ? error.message : 'Unknown error'
          await JobService.failJob(job.id, message)
          await failScanRun(scanRun.id, message)
        }
      }
    })()

    return { jobId: job.id }
  }),

  status: authProcedure.query(async () => {
    const [job, activity] = await Promise.all([
      JobService.getLatestLocalDirectoryImportJob(),
      JobService.getMediaScanActivity()
    ])
    return { job, activity }
  }),

  cancel: adminProcedure.mutation(async () => {
    const job = await JobService.getActiveLocalDirectoryImportJob()
    if (!job) return { success: false }
    if (isCentralDispatcherCutoverEnabled()) {
      await cancelJobCommand({ jobId: job.id })
      return { success: true }
    }
    assertLegacyLocalImportAllowed()
    await JobService.cancelJob(job.id)
    return { success: true }
  })
})
