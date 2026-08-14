import { adminProcedure, authProcedure, router } from '@/server/trpc'
import * as JobService from '@/services/job-service'
import { refillMetaSource } from '@/services/scan-service/refill-meta-source'
import { getScanPath } from '@/services/setting.service'
import { TRPCError } from '@trpc/server'
import logger from '@/lib/logger'
import { syncAllMediaDerivedTags } from '@/services/media-derived-tag-service'
import { listScheduledTasks, triggerScheduledTaskNow, updateScheduledTask } from '@/services/scheduled-task-service'
import { reprobeVideoMediaByImageId, resolveVideoImageForReprobePath } from '@/services/video-media-probe-service'
import {
  cancelCentralVideoMediaProbe,
  enqueueCentralVideoMediaReprobe
} from '@/services/video-media-central-service'
import { cancelVideoOptimization, enqueueVideoOptimization } from '@/services/video-streaming-optimization-queue'
import { cancelActiveCentralVideoChapterPreview } from '@/services/video-processing-central-service'
import {
  controlVideoKeyframeJob,
  enqueueSingleVideoKeyframe,
  enqueueVideoKeyframeBatch,
  getLatestVideoKeyframeJobsByImageIds,
  getVideoKeyframeDetails,
  listVideoKeyframeQueue,
  retryFailedVideoKeyframeJobs,
  retryVideoKeyframeJob,
  selectVideoKeyframePoster
} from '@/services/video-keyframe-queue'
import {
  controlCentralVideoKeyframeJob,
  enqueueCentralVideoKeyframeDiscovery,
  enqueueCentralVideoKeyframeGeneration,
  retryCentralVideoKeyframeJob,
  retryFailedCentralVideoKeyframes
} from '@/services/video-keyframe-central-service'
import { z } from 'zod'
import type { JobDto } from '@pixishelf/job-contracts'
import {
  assertLegacyBackgroundExecutionAllowed,
  BackgroundTaskError,
  cancelJobCommand,
  changeJobPriorityCommand,
  changeJobPriorityInputSchema,
  enqueueJob,
  enqueueSingletonManualJob,
  getJobById,
  getJobDashboard,
  incrementalJobEventsInputSchema,
  jobIdInputSchema,
  listIncrementalJobEvents,
  listJobs,
  listJobsInputSchema,
  manualEnqueueJobRequestSchema,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '@/services/background-task'
import { toJobDto, type SystemJobWireRecord } from '@/services/background-task/job-serialization'
import {
  isCentralDispatcherCutoverEnabled,
  LegacyBackgroundExecutionDisabledError
} from '@/services/background-task/dispatcher-cutover'

const videoKeyframeFilterSchema = z.object({
  minDuration: z.number().nonnegative().nullable().default(null),
  maxDuration: z.number().nonnegative().nullable().default(null),
  includePaths: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  excludePaths: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  statuses: z
    .array(z.enum(['MISSING', 'STALE', 'FAILED']))
    .min(1)
    .max(3)
    .default(['MISSING', 'STALE', 'FAILED'])
})

const CENTRAL_MAINTENANCE_ACTIVE_STATUSES = [
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'CANCELLING'
] as const

async function getActiveCentralMaintenanceJob(
  type: 'REFILL_META_SOURCE' | 'MEDIA_DERIVED_TAG_SYNC'
): Promise<JobDto | null> {
  const page = await listJobs({ types: [type], statuses: [...CENTRAL_MAINTENANCE_ACTIVE_STATUSES], limit: 1 })
  return page.items[0] ?? null
}

async function runBackgroundTaskCommand<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command()
  } catch (error) {
    if (error instanceof BackgroundTaskError) {
      throw new TRPCError({
        code: error.code === 'JOB_NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
        message: error.message
      })
    }
    throw error
  }
}

function assertLegacyRouterExecutionAllowed(operation: string) {
  try {
    assertLegacyBackgroundExecutionAllowed(operation)
  } catch (error) {
    if (error instanceof LegacyBackgroundExecutionDisabledError) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
    }
    throw error
  }
}

/**
 * 后台任务路由：主要承载异步作业触发与状态查询，不包含可直接返回最终结果的长耗时流程。
 */
export const jobRouter = router({
  /**
   * 启动元数据补全任务（异步投递）。
   * central 模式在事务 advisory lock 内复用等价活跃任务；不同语义明确返回 CONFLICT。
   */
  startRefillMetaSource: adminProcedure.mutation(async ({ ctx }) => {
    if (isCentralDispatcherCutoverEnabled()) {
      const scanPath = await getScanPath()
      if (!scanPath) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
      }
      const job = await runBackgroundTaskCommand(() =>
        enqueueSingletonManualJob({
          type: 'REFILL_META_SOURCE',
          triggerSource: 'MANUAL',
          requestedByUserId: ctx.userId,
          priority: 10,
          maxAttempts: 3,
          payload: {}
        })
      )
      return { jobId: job.id }
    }

    assertLegacyRouterExecutionAllowed('REFILL_META_SOURCE')
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

    // 4. 异步执行任务（不 await，避免阻塞请求）。上方 cutover 守卫必须先通过，central=true 禁止启动此 IIFE。
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
    if (isCentralDispatcherCutoverEnabled()) return getActiveCentralMaintenanceJob('REFILL_META_SOURCE')
    const job = await JobService.getActiveRefillMetaSourceJob()
    return job ? toJobDto(job as SystemJobWireRecord) : null
  }),

  cancelRefillMetaSource: adminProcedure.mutation(async () => {
    if (isCentralDispatcherCutoverEnabled()) {
      const activeJob = await getActiveCentralMaintenanceJob('REFILL_META_SOURCE')
      if (!activeJob) return { success: false, message: 'No active job' }
      await runBackgroundTaskCommand(() => cancelJobCommand({ jobId: activeJob.id }))
      return { success: true }
    }

    assertLegacyRouterExecutionAllowed('CANCEL_REFILL_META_SOURCE')
    const activeJob = await JobService.getActiveRefillMetaSourceJob()
    if (activeJob) {
      await JobService.cancelJob(activeJob.id)
      return { success: true }
    }
    return { success: false, message: 'No active job' }
  }),

  /**
   * 标签派生同步同样是异步作业；central 模式使用同一事务 singleton 边界避免检查后创建竞态。
   */
  startMediaDerivedTagSync: adminProcedure.mutation(async ({ ctx }) => {
    if (isCentralDispatcherCutoverEnabled()) {
      const job = await runBackgroundTaskCommand(() =>
        enqueueSingletonManualJob({
          type: 'MEDIA_DERIVED_TAG_SYNC',
          triggerSource: 'MANUAL',
          requestedByUserId: ctx.userId,
          priority: 10,
          maxAttempts: 3,
          payload: {}
        })
      )
      return { jobId: job.id }
    }

    assertLegacyRouterExecutionAllowed('MEDIA_DERIVED_TAG_SYNC')
    const activeJob = await JobService.getLatestMediaDerivedTagSyncJob()
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Media derived tag sync job is already running'
      })
    }

    const job = await JobService.createMediaDerivedTagSyncJob()

    // cutover 守卫必须先通过，central=true 禁止启动此 IIFE，避免 Next 与独立 Worker 双消费。
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
    if (isCentralDispatcherCutoverEnabled()) {
      const jobs = await listJobs({ types: ['MEDIA_DERIVED_TAG_SYNC'], limit: 1 })
      return jobs.items[0] ?? null
    }
    const job = await JobService.getLatestMediaDerivedTagSyncJob()
    return job ? toJobDto(job as SystemJobWireRecord) : null
  }),

  startWebpAnimationScan: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await runBackgroundTaskCommand(() =>
        triggerScheduledTaskNow('webp_animation_scan', { requestedByUserId: ctx.userId })
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('already running')) {
        throw new TRPCError({ code: 'CONFLICT', message: error.message })
      }
      if (error instanceof Error && error.message.includes('Scan path')) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
      }
      throw error
    }
  }),

  getWebpAnimationScanStatus: authProcedure.query(async () => {
    return await JobService.getLatestWebpAnimationScanJob()
  }),

  startVideoMediaProbe: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await runBackgroundTaskCommand(() =>
        triggerScheduledTaskNow('video_media_probe', { requestedByUserId: ctx.userId })
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('already running')) {
        throw new TRPCError({ code: 'CONFLICT', message: error.message })
      }
      if (error instanceof Error && error.message.includes('Scan path')) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
      }
      throw error
    }
  }),

  getVideoMediaProbeStatus: authProcedure.query(async () => {
    return await JobService.getLatestVideoMediaProbeJob()
  }),

  getVideoChapterPreviewGenerationStatus: authProcedure.query(async () => {
    return await JobService.getLatestVideoChapterPreviewGenerationJob()
  }),

  cancelVideoMediaProbe: adminProcedure.mutation(async () => {
    if (isCentralDispatcherCutoverEnabled()) {
      const active = await listJobs({
        types: ['VIDEO_MEDIA_PROBE'],
        statuses: [...CENTRAL_MAINTENANCE_ACTIVE_STATUSES],
        limit: 1
      })
      const job = active.items[0]
      if (!job) return { success: false, message: 'No active job' }
      await runBackgroundTaskCommand(() => cancelCentralVideoMediaProbe(job.id))
      return { success: true }
    }
    assertLegacyRouterExecutionAllowed('CANCEL_VIDEO_MEDIA_PROBE')
    const activeJob = await JobService.getActiveJobByType('VIDEO_MEDIA_PROBE')
    if (activeJob) {
      await JobService.cancelJob(activeJob.id)
      await JobService.markAsCancelled(activeJob.id)
      return { success: true }
    }
    return { success: false, message: 'No active job' }
  }),

  cancelVideoChapterPreviewGeneration: adminProcedure.mutation(async () => {
    if (isCentralDispatcherCutoverEnabled()) {
      const cancelled = await runBackgroundTaskCommand(() => cancelActiveCentralVideoChapterPreview())
      return cancelled ? { success: true } : { success: false, message: 'No active job' }
    }
    assertLegacyRouterExecutionAllowed('CANCEL_VIDEO_CHAPTER_PREVIEW_GENERATION')
    const activeJob = await JobService.getActiveJobByType('VIDEO_CHAPTER_PREVIEW_GENERATION')
    if (activeJob) {
      await JobService.cancelJob(activeJob.id)
      return { success: true }
    }
    return { success: false, message: 'No active job' }
  }),

  reprobeVideoMediaByPath: adminProcedure
    .input(
      z.object({
        path: z.string().trim().min(1, '路径不能为空')
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 通过 resolveVideoImageForReprobePath 校验路径可访问性（含是否为视频、是否在 scan root）后再重探测。
      const scanPath = await getScanPath()
      if (!scanPath) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
      }

      try {
        const image = await resolveVideoImageForReprobePath(input.path, scanPath)
        if (isCentralDispatcherCutoverEnabled()) {
          const queued = await enqueueCentralVideoMediaReprobe({ imageId: image.id, requestedByUserId: ctx.userId })
          return { mode: 'QUEUED' as const, ...queued }
        }
        assertLegacyRouterExecutionAllowed('VIDEO_MEDIA_REPROBE')
        const metadata = await reprobeVideoMediaByImageId(image.id, scanPath)
        return { mode: 'COMPLETED' as const, metadata }
      } catch (error) {
        if (error instanceof BackgroundTaskError && error.code === 'ACTIVE_JOB_CONFLICT') {
          throw new TRPCError({ code: 'CONFLICT', message: error.message })
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message === 'Video image not found' || message === 'Image not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message })
        }
        if (
          message === 'Image is not a video' ||
          message.startsWith('Path escapes scan root') ||
          message === 'Path is required'
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }
    }),

  startVideoStreamingOptimization: adminProcedure
    .input(
      z.object({
        imageId: z.number().int().positive()
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await enqueueVideoOptimization(input.imageId, ctx.userId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message === 'Scan path is not configured') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message })
        }
        if (message.startsWith('Video optimization queue is full')) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message })
        }
        if (message === 'Image not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message })
        }
        if (
          message === 'Image is not a video' ||
          message === 'Only MP4 videos can be optimized' ||
          message === 'Video path is not a file' ||
          message.startsWith('Video directory is read-only') ||
          message.startsWith('Path escapes scan root') ||
          message === 'Path is required'
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }
    }),

  getVideoStreamingOptimizationStatus: authProcedure.query(async () => {
    return await JobService.getLatestVideoStreamingOptimizationJob()
  }),

  getVideoStreamingOptimizationStatuses: authProcedure
    .input(
      z.object({
        imageIds: z.array(z.number().int().positive()).max(1000)
      })
    )
    .query(async ({ input }) => {
      // 去重 imageIds 后查询“每张图片最近一次任务”，确保前端即使带重复 id 也返回单行状态。
      return await JobService.getLatestVideoStreamingOptimizationJobsByImageIds([...new Set(input.imageIds)])
    }),

  getVideoStreamingOptimizationQueue: authProcedure.query(async () => {
    return await JobService.listVideoStreamingOptimizationQueue()
  }),

  cancelVideoStreamingOptimization: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await cancelVideoOptimization(input.jobId)
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Video optimization job not found' })
      }
      return { success: result.changed, status: result.job.status }
    }),

  startVideoKeyframeGeneration: adminProcedure
    .input(z.object({ imageId: z.number().int().positive(), force: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (isCentralDispatcherCutoverEnabled()) {
          return await enqueueCentralVideoKeyframeGeneration({ ...input, requestedByUserId: ctx.userId })
        }
        assertLegacyRouterExecutionAllowed('VIDEO_KEYFRAME_GENERATION')
        const result = await enqueueSingleVideoKeyframe(input.imageId, input.force)
        return { jobId: result.job.id, status: result.job.status, reused: result.reused }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message === 'Image not found') throw new TRPCError({ code: 'NOT_FOUND', message })
        if (message === 'Image is not a video') throw new TRPCError({ code: 'BAD_REQUEST', message })
        if (message.startsWith('Video keyframe queue is full')) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }
    }),

  /**
   * 批量触发 keyframe 时，未启用 previewOnly 且未传 imageIds 会在验证阶段直接拒绝；
   * 否则透传到服务层构造触发策略（manual/force/previewOnly）。
   */
  startVideoKeyframeBatch: adminProcedure
    .input(
      z
        .object({
          imageIds: z.array(z.number().int().positive()).min(1).max(1000).optional(),
          force: z.boolean().default(false),
          previewOnly: z.boolean().default(false),
          filter: videoKeyframeFilterSchema.optional()
        })
        .superRefine((value, context) => {
          if (!value.previewOnly && !value.imageIds?.length) {
            context.addIssue({
              code: 'custom',
              path: ['imageIds'],
              message: '请先预览并选择要处理的视频'
            })
          }
        })
    )
    .mutation(async ({ input, ctx }) => {
      if (isCentralDispatcherCutoverEnabled()) {
        return enqueueCentralVideoKeyframeDiscovery({
          force: input.force,
          previewOnly: input.previewOnly,
          imageIds: input.imageIds,
          filter: input.filter,
          requestedByUserId: ctx.userId
        })
      }
      assertLegacyRouterExecutionAllowed('VIDEO_KEYFRAME_BATCH')
      return enqueueVideoKeyframeBatch({
        trigger: 'manual',
        force: input.force,
        previewOnly: input.previewOnly,
        imageIds: input.imageIds,
        filter: input.filter
      })
    }),

  /**
   * 关键帧队列视图为纯查询 API，仅返回全局容量、活跃队列与最近任务。
   */
  getVideoKeyframeQueue: authProcedure.query(() => listVideoKeyframeQueue()),

  getVideoKeyframeStatuses: authProcedure
    .input(z.object({ imageIds: z.array(z.number().int().positive()).max(1000) }))
    .query(({ input }) => getLatestVideoKeyframeJobsByImageIds([...new Set(input.imageIds)])),

  getVideoKeyframeDetails: authProcedure
    .input(z.object({ imageId: z.number().int().positive() }))
    .query(({ input }) => getVideoKeyframeDetails(input.imageId)),

  controlVideoKeyframe: adminProcedure
    .input(z.object({ jobId: z.string().min(1), action: z.enum(['pause', 'resume', 'cancel']) }))
    .mutation(async ({ input }) => {
      let job
      if (isCentralDispatcherCutoverEnabled()) {
        job = await runBackgroundTaskCommand(() => controlCentralVideoKeyframeJob(input.jobId, input.action))
      } else {
        assertLegacyRouterExecutionAllowed('VIDEO_KEYFRAME_CONTROL')
        job = await controlVideoKeyframeJob(input.jobId, input.action)
      }
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Video keyframe job not found' })
      return { jobId: job.id, status: job.status }
    }),

  retryVideoKeyframe: adminProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    let job
    if (isCentralDispatcherCutoverEnabled()) {
      job = await runBackgroundTaskCommand(() => retryCentralVideoKeyframeJob(input.jobId, ctx.userId))
    } else {
      assertLegacyRouterExecutionAllowed('VIDEO_KEYFRAME_RETRY')
      job = await retryVideoKeyframeJob(input.jobId)
    }
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Video keyframe job not found' })
    return { jobId: job.id, status: job.status }
  }),

  retryFailedVideoKeyframes: adminProcedure
    .input(z.object({ filter: videoKeyframeFilterSchema.optional() }))
    .mutation(({ input, ctx }) => {
      if (isCentralDispatcherCutoverEnabled()) {
        return runBackgroundTaskCommand(() =>
          retryFailedCentralVideoKeyframes({ filter: input.filter, requestedByUserId: ctx.userId })
        )
      }
      assertLegacyRouterExecutionAllowed('VIDEO_KEYFRAME_RETRY_FAILED')
      return retryFailedVideoKeyframeJobs(input.filter)
    }),

  selectVideoKeyframePoster: adminProcedure
    .input(z.object({ imageId: z.number().int().positive(), frameId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await selectVideoKeyframePoster(input.imageId, input.frameId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message === 'Published keyframe not found') throw new TRPCError({ code: 'NOT_FOUND', message })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
      }
    }),

  listScheduledTasks: authProcedure.query(async () => {
    return listScheduledTasks()
  }),

  updateScheduledTask: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        enabled: z.boolean().optional(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        priority: z.number().int().min(0).max(1000).optional(),
        config: videoKeyframeFilterSchema.optional()
      })
    )
    .mutation(async ({ input }) => {
      await updateScheduledTask(input)
      return { success: true }
    }),

  /**
   * 触发调度任务接口会透传任务 key 到服务层；
   * 常见失败分支为任务已运行（返回 CONFLICT）和环境依赖缺失（返回 PRECONDITION_FAILED）。
   */
  triggerScheduledTaskNow: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        chapterPreviewMode: z.enum(['FULL', 'INCREMENTAL']).optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await runBackgroundTaskCommand(() =>
          triggerScheduledTaskNow(input.key, {
            chapterPreviewMode: input.chapterPreviewMode,
            requestedByUserId: ctx.userId
          })
        )
      } catch (error) {
        if (error instanceof Error && error.message.includes('already running')) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message })
        }
        if (error instanceof Error && error.message.includes('Scan path')) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
        }
        throw error
      }
    }),

  backgroundDashboard: adminProcedure.query(() => getJobDashboard()),

  backgroundList: adminProcedure.input(listJobsInputSchema).query(({ input }) => listJobs(input)),

  backgroundDetail: adminProcedure.input(jobIdInputSchema).query(({ input }) => getJobById(input.jobId)),

  backgroundEvents: adminProcedure
    .input(incrementalJobEventsInputSchema)
    .query(({ input }) => listIncrementalJobEvents(input)),

  enqueueBackgroundJob: adminProcedure
    .input(manualEnqueueJobRequestSchema)
    .mutation(({ input, ctx }) => enqueueJob({ ...input, requestedByUserId: ctx.userId })),

  cancelBackgroundJob: adminProcedure
    .input(jobIdInputSchema)
    .mutation(({ input }) => runBackgroundTaskCommand(() => cancelJobCommand(input))),

  pauseBackgroundJob: adminProcedure
    .input(jobIdInputSchema)
    .mutation(({ input }) => runBackgroundTaskCommand(() => pauseJobCommand(input))),

  resumeBackgroundJob: adminProcedure
    .input(jobIdInputSchema)
    .mutation(({ input }) => runBackgroundTaskCommand(() => resumeJobCommand(input))),

  retryBackgroundJob: adminProcedure
    .input(jobIdInputSchema)
    .mutation(({ input, ctx }) =>
      runBackgroundTaskCommand(() => retryJobCommand({ ...input, requestedByUserId: ctx.userId }))
    ),

  changeBackgroundJobPriority: adminProcedure
    .input(changeJobPriorityInputSchema)
    .mutation(({ input }) => runBackgroundTaskCommand(() => changeJobPriorityCommand(input)))
})
