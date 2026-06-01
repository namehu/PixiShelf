import { authProcedure, router } from '@/server/trpc'
import * as JobService from '@/services/job-service'
import { refillMetaSource } from '@/services/scan-service/refill-meta-source'
import { getScanPath } from '@/services/setting.service'
import { TRPCError } from '@trpc/server'
import logger from '@/lib/logger'
import { syncAllMediaDerivedTags } from '@/services/media-derived-tag-service'
import { runWebpAnimationScanJob } from '@/services/webp-animation-scan-service'

export const jobRouter = router({
  startRefillMetaSource: authProcedure.mutation(async () => {
    // 1. 检查是否已有任务在运行
    const activeJob = await JobService.getActiveRefillMetaSourceJob()
    if (activeJob) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A refill meta source job is already running'
      })
    }

    // 2. 获取扫描路径
    const scanPath = await getScanPath()
    if (!scanPath) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Scan path is not configured'
        })
    }

    // 3. 创建任务记录
    const job = await JobService.createRefillMetaSourceJob()

    // 4. 异步执行任务 (Fire-and-forget)
    // 注意：不要 await 这个 Promise，否则会阻塞请求
    ;(async () => {
      try {
        await refillMetaSource({
            scanPath,
            checkCancelled: async () => {
                const current = await JobService.getJob(job.id)
                // 检查是否为 CANCELLING 状态
                return current?.status === 'CANCELLING'
            },
            onProgress: async (progress) => {
                // 更新数据库进度
                await JobService.updateProgress(job.id, progress.percentage, progress.message)
            }
        })
        // 任务成功完成
        await JobService.completeJob(job.id, { success: true })
      } catch (error) {
        logger.error('Refill meta source job failed', { error })
        
        // 检查当前状态，如果是 CANCELLING，则标记为 CANCELLED
        // 或者如果错误消息明确是 Task cancelled
        const current = await JobService.getJob(job.id)
        if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
            await JobService.markAsCancelled(job.id)
        } else {
            await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
        }
      }
    })()

    return { jobId: job.id }
  }),

  getRefillMetaSourceStatus: authProcedure.query(async () => {
    return await JobService.getActiveRefillMetaSourceJob()
  }),
  
  cancelRefillMetaSource: authProcedure.mutation(async () => {
    const activeJob = await JobService.getActiveRefillMetaSourceJob()
    if (activeJob) {
        await JobService.cancelJob(activeJob.id)
        return { success: true }
    }
    return { success: false, message: 'No active job' }
  }),

  startMediaDerivedTagSync: authProcedure.mutation(async () => {
    const activeJob = await JobService.getLatestMediaDerivedTagSyncJob()
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Media derived tag sync job is already running'
      })
    }

    const job = await JobService.createMediaDerivedTagSyncJob()

    ;(async () => {
      try {
        const result = await syncAllMediaDerivedTags({
          onProgress: async (progress) => {
            await JobService.updateProgress(job.id, progress.percentage, progress.message)
          }
        })
        await JobService.completeJob(job.id, result)
      } catch (error) {
        logger.error('Media derived tag sync job failed', { error })
        await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
      }
    })()

    return { jobId: job.id }
  }),

  getMediaDerivedTagSyncStatus: authProcedure.query(async () => {
    return await JobService.getLatestMediaDerivedTagSyncJob()
  }),

  startWebpAnimationScan: authProcedure.mutation(async () => {
    const activeJob = await JobService.getLatestWebpAnimationScanJob()
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'WebP animation scan job is already running'
      })
    }

    const scanPath = await getScanPath()
    if (!scanPath) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Scan path is not configured'
      })
    }

    const job = await JobService.createWebpAnimationScanJob()

    ;(async () => {
      try {
        const result = await runWebpAnimationScanJob({
          scanPath,
          checkCancelled: async () => {
            const current = await JobService.getJob(job.id)
            return current?.status === 'CANCELLING'
          },
          onProgress: async (progress) => {
            await JobService.updateProgress(job.id, progress.percentage, progress.message)
          }
        })
        await JobService.completeJob(job.id, result)
      } catch (error) {
        logger.error('WebP animation scan job failed', { error })

        const current = await JobService.getJob(job.id)
        if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
          await JobService.markAsCancelled(job.id)
        } else {
          await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
        }
      }
    })()

    return { jobId: job.id }
  }),

  getWebpAnimationScanStatus: authProcedure.query(async () => {
    return await JobService.getLatestWebpAnimationScanJob()
  })
})
