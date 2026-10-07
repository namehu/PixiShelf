import { saveLocalImportArtistMappingsSchema, startLocalImportSchema } from '@/schemas/local-import.dto'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { classifyBackgroundTaskTransportError } from '@/services/background-task/transport-error'
import * as JobService from '@/services/job-service'
import {
  discoverLocalImports,
  LocalImportDiscoveryLimitError,
  saveLocalImportArtistMappings
} from '@/services/local-import-service'
import { enqueueCentralLocalDirectoryImport } from '@/services/media-root-central-service'
import { getScanPath } from '@/services/setting.service'
import { TRPCError } from '@trpc/server'
async function requireScanPath() {
  // 本地导入要求必须先有可用扫描根路径；未配置时直接阻断整个流程，避免写入到未知目录。
  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  }
  return scanPath
}
/**
 * 本地目录导入路由：
 * - 预览仅扫描目录结构，不会触发写库；
 * - start 会创建本地导入作业并异步执行，返回 jobId 后立即返回；
 * - 运行期间通过扫描任务记录与作业进度持久化每一步状态，便于前端轮询。
 */
export const localImportRouter = router({
  preview: authProcedure.query(async ({ signal }) => {
    const scanPath = await requireScanPath()
    try {
      return await discoverLocalImports({ scanPath }, { signal })
    } catch (error) {
      if (error instanceof LocalImportDiscoveryLimitError) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
      }
      throw error
    }
  }),
  saveMappings: adminProcedure.input(saveLocalImportArtistMappingsSchema).mutation(async ({ input }) => {
    return saveLocalImportArtistMappings(input)
  }),
  start: adminProcedure.input(startLocalImportSchema).mutation(async ({ input, ctx }) => {
    {
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
    {
      await cancelJobCommand({ jobId: job.id })
      return { success: true }
    }
  })
})
