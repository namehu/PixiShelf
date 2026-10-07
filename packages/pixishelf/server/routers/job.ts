import { prisma } from '@/lib/prisma'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import { archiveModule } from '@/services/archive/archive-module'
import {
  acknowledgeJobFailureCommand,
  acknowledgeJobFailuresCommand,
  acknowledgeJobFailuresRequestSchema,
  BackgroundTaskError,
  cancelJobCommand,
  changeJobPriorityCommand,
  changeJobPriorityInputSchema,
  enqueueJob,
  enqueueSingletonManualJob,
  getBackgroundJobDetail,
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
import {
  backgroundDiagnosticItemsInputSchema,
  backgroundDiagnosticReportsInputSchema,
  listBackgroundDiagnosticItems,
  listBackgroundDiagnosticReports
} from '@/services/background-task/job-diagnostic-service'
import {
  backgroundFailuresInputSchema,
  backgroundHistoryInputSchema,
  backgroundHistorySnapshotsInputSchema,
  getBackgroundHistorySnapshots,
  listBackgroundFailures,
  listBackgroundHistory
} from '@/services/background-task/job-history-service'
import * as JobService from '@/services/job-service'
import {
  cancelPixivAiDerivedTagSync,
  getLatestPixivAiDerivedTagSyncJob,
  startPixivAiDerivedTagSync
} from '@/services/pixiv-ai-derived-tag-service'
import { cancelPixivArtistEnrichment } from '@/services/pixiv-artist-enrichment-service'
import { cancelPixivArtworkEnrichment } from '@/services/pixiv-artwork-enrichment-service'
import { cancelPixivSeriesReconciliation } from '@/services/pixiv-series-reconciliation-service'
import { cancelPixivTagEnrichment } from '@/services/pixiv-tag-enrichment-service'
import { listScheduledTasks, triggerScheduledTaskNow, updateScheduledTask } from '@/services/scheduled-task-service'
import { getScanPath } from '@/services/setting.service'
import {
  controlCentralVideoKeyframeJob,
  enqueueCentralVideoKeyframeDiscovery,
  enqueueCentralVideoKeyframeGeneration,
  retryCentralVideoKeyframeJob,
  retryFailedCentralVideoKeyframes
} from '@/services/video-keyframe-central-service'
import {
  getLatestVideoKeyframeJobsByImageIds,
  getVideoKeyframeDetails,
  listVideoKeyframeQueue,
  selectVideoKeyframePoster
} from '@/services/video-keyframe-queue'
import { cancelCentralVideoMediaProbe, enqueueCentralVideoMediaReprobe } from '@/services/video-media-central-service'
import { resolveVideoImageForReprobePath } from '@/services/video-media-probe-service'
import { cancelActiveCentralVideoChapterPreview } from '@/services/video-processing-central-service'
import { cancelVideoOptimization, enqueueVideoOptimization } from '@/services/video-streaming-optimization-queue'
import { Prisma, retryAnimationDurationFailures } from '@pixishelf/db'
import type { JobDto } from '@pixishelf/job-contracts'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { runArchiveOperation } from './archive'
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
/**
 * 后台任务路由：主要承载异步作业触发与状态查询，不包含可直接返回最终结果的长耗时流程。
 */
export const jobRouter = router({
  /**
   * 启动元数据补全任务（异步投递）。
   * central 模式在事务 advisory lock 内复用等价活跃任务；不同语义明确返回 CONFLICT。
   */
  startRefillMetaSource: adminProcedure.mutation(async ({ ctx }) => {
    {
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
  }),
  getRefillMetaSourceStatus: authProcedure.query(async () => {
    return getActiveCentralMaintenanceJob('REFILL_META_SOURCE')
  }),
  cancelRefillMetaSource: adminProcedure.mutation(async () => {
    {
      const activeJob = await getActiveCentralMaintenanceJob('REFILL_META_SOURCE')
      if (!activeJob) return { success: false, message: 'No active job' }
      await runBackgroundTaskCommand(() => cancelJobCommand({ jobId: activeJob.id }))
      return { success: true }
    }
  }),
  /**
   * 标签派生同步同样是异步作业；central 模式使用同一事务 singleton 边界避免检查后创建竞态。
   */
  startMediaDerivedTagSync: adminProcedure.mutation(async ({ ctx }) => {
    {
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
  }),
  getMediaDerivedTagSyncStatus: authProcedure.query(async () => {
    {
      const jobs = await listJobs({ types: ['MEDIA_DERIVED_TAG_SYNC'], limit: 1 })
      return jobs.items[0] ?? null
    }
  }),
  startPixivAiDerivedTagSync: adminProcedure
    .input(z.object({ dryRun: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await startPixivAiDerivedTagSync(ctx.userId, input)
      return { jobId: result.job.id, reused: result.reused }
    }),
  getPixivAiDerivedTagSyncStatus: authProcedure.query(async () => {
    return getLatestPixivAiDerivedTagSyncJob()
  }),
  cancelPixivAiDerivedTagSync: adminProcedure.mutation(async () => {
    return cancelPixivAiDerivedTagSync()
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
  getAnimationDurationProbeStatus: authProcedure.query(async () => {
    const jobs = await listJobs({ types: ['ANIMATION_DURATION_PROBE'], limit: 1 })
    return jobs.items[0] ?? null
  }),
  retryAnimationDurationFailures: adminProcedure
    .input(z.object({ imageIds: z.array(z.number().int().positive()).max(100).optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      const retried = await prisma.$transaction((tx) =>
        retryAnimationDurationFailures(tx as unknown as Prisma.TransactionClient, input)
      )
      if (retried === 0) return { retried, jobId: null }
      const job = await runBackgroundTaskCommand(() =>
        triggerScheduledTaskNow('animation_duration_probe', { requestedByUserId: ctx.userId })
      )
      return { retried, jobId: job.jobId }
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
    {
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
  }),
  cancelVideoChapterPreviewGeneration: adminProcedure.mutation(async () => {
    {
      const cancelled = await runBackgroundTaskCommand(() => cancelActiveCentralVideoChapterPreview())
      return cancelled ? { success: true } : { success: false, message: 'No active job' }
    }
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
        {
          const queued = await enqueueCentralVideoMediaReprobe({ imageId: image.id, requestedByUserId: ctx.userId })
          return { mode: 'QUEUED' as const, ...queued }
        }
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
        {
          return await enqueueCentralVideoKeyframeGeneration({ ...input, requestedByUserId: ctx.userId })
        }
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
      {
        return enqueueCentralVideoKeyframeDiscovery({
          force: input.force,
          previewOnly: input.previewOnly,
          imageIds: input.imageIds,
          filter: input.filter,
          requestedByUserId: ctx.userId
        })
      }
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
      {
        job = await runBackgroundTaskCommand(() => controlCentralVideoKeyframeJob(input.jobId, input.action))
      }
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Video keyframe job not found' })
      return { jobId: job.id, status: job.status }
    }),
  retryVideoKeyframe: adminProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    let job
    {
      job = await runBackgroundTaskCommand(() => retryCentralVideoKeyframeJob(input.jobId, ctx.userId))
    }
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Video keyframe job not found' })
    return { jobId: job.id, status: job.status }
  }),
  retryFailedVideoKeyframes: adminProcedure
    .input(z.object({ filter: videoKeyframeFilterSchema.optional() }))
    .mutation(({ input, ctx }) => {
      {
        return runBackgroundTaskCommand(() =>
          retryFailedCentralVideoKeyframes({ filter: input.filter, requestedByUserId: ctx.userId })
        )
      }
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
      z
        .object({
          key: z.string().min(1),
          enabled: z.boolean().optional(),
          priority: z.number().int().min(0).max(999).optional(),
          config: videoKeyframeFilterSchema.optional()
        })
        .strict()
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
        chapterPreviewMode: z.enum(['FULL', 'INCREMENTAL']).optional(),
        videoProbeMode: z.enum(['INCREMENTAL', 'RECHECK_HAS_AUDIO']).optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await runBackgroundTaskCommand(() =>
          triggerScheduledTaskNow(input.key, {
            chapterPreviewMode: input.chapterPreviewMode,
            videoProbeMode: input.videoProbeMode,
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
  backgroundHistory: adminProcedure
    .input(backgroundHistoryInputSchema)
    .query(({ input }) => listBackgroundHistory(input)),
  backgroundHistorySnapshots: adminProcedure
    .input(backgroundHistorySnapshotsInputSchema)
    .query(({ input }) => getBackgroundHistorySnapshots(input)),
  backgroundList: adminProcedure.input(listJobsInputSchema).query(({ input }) => listJobs(input)),
  backgroundFailures: adminProcedure
    .input(backgroundFailuresInputSchema)
    .query(({ input }) => listBackgroundFailures(input)),
  backgroundDetail: adminProcedure.input(jobIdInputSchema).query(({ input }) => getBackgroundJobDetail(input.jobId)),
  backgroundDiagnosticReports: adminProcedure
    .input(backgroundDiagnosticReportsInputSchema)
    .query(({ input }) => listBackgroundDiagnosticReports(input)),
  backgroundDiagnosticItems: adminProcedure
    .input(backgroundDiagnosticItemsInputSchema)
    .query(({ input }) => listBackgroundDiagnosticItems(input)),
  backgroundEvents: adminProcedure
    .input(incrementalJobEventsInputSchema)
    .query(({ input }) => listIncrementalJobEvents(input)),
  enqueueBackgroundJob: adminProcedure
    .input(manualEnqueueJobRequestSchema)
    .mutation(({ input, ctx }) => enqueueJob({ ...input, requestedByUserId: ctx.userId })),
  cancelBackgroundJob: adminProcedure.input(jobIdInputSchema).mutation(({ input, ctx }) =>
    runBackgroundTaskCommand(async () => {
      const job = await getJobById(input.jobId)
      if (job?.type === 'ARCHIVE_IMPORT') return controlArchiveJob(input.jobId, 'CANCEL', ctx.userId)
      if (job?.type === 'PIXIV_ARTWORK_ENRICHMENT') {
        const cancelled = await cancelPixivArtworkEnrichment(input.jobId)
        if (!cancelled.job) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job not found')
        return cancelled.job
      }
      if (job?.type === 'PIXIV_ARTIST_ENRICHMENT') {
        const cancelled = await cancelPixivArtistEnrichment(input.jobId)
        if (!cancelled.job) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job not found')
        return cancelled.job
      }
      if (job?.type === 'PIXIV_SERIES_RECONCILIATION') {
        const cancelled = await cancelPixivSeriesReconciliation(input.jobId)
        if (!cancelled.job) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job not found')
        return cancelled.job
      }
      if (job?.type !== 'PIXIV_TAG_ENRICHMENT') return cancelJobCommand(input)
      const cancelled = await cancelPixivTagEnrichment(input.jobId)
      if (!cancelled.job) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job not found')
      return cancelled.job
    })
  ),
  pauseBackgroundJob: adminProcedure.input(jobIdInputSchema).mutation(({ input, ctx }) =>
    runBackgroundTaskCommand(async () => {
      const job = await getJobById(input.jobId)
      if (job?.type === 'ARCHIVE_IMPORT') return controlArchiveJob(input.jobId, 'PAUSE', ctx.userId)
      return pauseJobCommand(input)
    })
  ),
  resumeBackgroundJob: adminProcedure.input(jobIdInputSchema).mutation(({ input, ctx }) =>
    runBackgroundTaskCommand(async () => {
      const job = await getJobById(input.jobId)
      if (job?.type === 'ARCHIVE_IMPORT') return controlArchiveJob(input.jobId, 'RESUME', ctx.userId)
      return resumeJobCommand(input)
    })
  ),
  retryBackgroundJob: adminProcedure.input(jobIdInputSchema).mutation(({ input, ctx }) =>
    runBackgroundTaskCommand(async () => {
      const job = await getJobById(input.jobId)
      if (job?.type === 'ARCHIVE_IMPORT') return controlArchiveJob(input.jobId, 'RETRY', ctx.userId)
      return retryJobCommand({ ...input, requestedByUserId: ctx.userId })
    })
  ),
  acknowledgeBackgroundJobFailure: adminProcedure
    .input(jobIdInputSchema)
    .mutation(({ input, ctx }) =>
      runBackgroundTaskCommand(() => acknowledgeJobFailureCommand({ ...input, requestedByUserId: ctx.userId }))
    ),
  acknowledgeBackgroundJobFailures: adminProcedure
    .input(acknowledgeJobFailuresRequestSchema)
    .mutation(({ input, ctx }) => runBackgroundTaskCommand(() => acknowledgeJobFailuresCommand(input, ctx.userId))),
  changeBackgroundJobPriority: adminProcedure
    .input(changeJobPriorityInputSchema)
    .mutation(({ input }) => runBackgroundTaskCommand(() => changeJobPriorityCommand(input)))
})
async function controlArchiveJob(jobId: string, action: 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY', userId: string) {
  const result = await runArchiveOperation(() => archiveModule.requestJobAction(jobId, action, userId))
  const task = await prisma.archiveImport.findUniqueOrThrow({
    where: { id: result.taskId },
    select: { systemJobId: true }
  })
  const job = await getJobById(task.systemJobId)
  if (!job) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job not found')
  return job
}
