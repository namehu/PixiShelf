import {
  JOB_DEFINITION_VERSION,
  videoChapterPreviewPayloadSchema,
  videoStreamingOptimizationPayloadSchema,
  type JobErrorCode
} from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { generateVideoChapterPreviews } from './chapter-preview.ts'
import { runVideoProcess } from './process-runner.ts'
import { prepareVideoStreamingOptimization, type PreparedVideoStreamingOptimization } from './streaming-optimization.ts'
import type {
  VideoProcessingDatabase,
  VideoProcessingRuntimeConfig,
  VideoProcessingTransaction,
  VideoProcessRunner
} from './types.ts'
import { VideoProcessingPermanentError, VideoProcessingProcessError, VideoProcessingRecoveryError } from './types.ts'

export interface VideoProcessingExecutorDependencies {
  database: VideoProcessingDatabase
  config: VideoProcessingRuntimeConfig
  processRunner?: VideoProcessRunner
  now?: () => Date
}

type ChapterPayload = ReturnType<typeof videoChapterPreviewPayloadSchema.parse>
type StreamingPayload = ReturnType<typeof videoStreamingOptimizationPayloadSchema.parse>
type VideoExecutionContext<T> = ExecutionContext<T, EnqueuedChildJob>
type VideoFencedScope = FencedExecutionTransaction<VideoProcessingTransaction & QueueSqlExecutor>

export function createVideoProcessingExecutorRegistrations(
  dependencies: VideoProcessingExecutorDependencies
): ExecutorDefinition[] {
  assertConfig(dependencies.config)
  const chapter: ExecutorDefinition<ChapterPayload> = {
    jobType: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => videoChapterPreviewPayloadSchema.parse(payload),
    execute: (context) => executeChapterPreview(context, dependencies)
  }
  const streaming: ExecutorDefinition<StreamingPayload> = {
    jobType: 'VIDEO_STREAMING_OPTIMIZATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => videoStreamingOptimizationPayloadSchema.parse(payload),
    execute: (context) => executeStreamingOptimization(context, dependencies)
  }
  return [chapter as ExecutorDefinition, streaming as ExecutorDefinition]
}

async function executeChapterPreview(
  context: VideoExecutionContext<ChapterPayload>,
  dependencies: VideoProcessingExecutorDependencies
): Promise<JobExecutionOutcome> {
  let finalizationStarted = false
  try {
    const result = await generateVideoChapterPreviews({
      jobId: context.job.id,
      systemJobId: context.job.id,
      attempt: context.job.attempt,
      mode: context.payload.mode,
      database: dependencies.database,
      config: dependencies.config,
      processRunner: dependencies.processRunner ?? runVideoProcess,
      signal: context.signal,
      progress: (update) =>
        context.progress({
          progress: update.percentage,
          stage: update.stage,
          message: update.message,
          ...(update.data ? { data: update.data } : {})
        }),
      mutate: <T>(operation: (transaction: VideoProcessingTransaction) => Promise<T>) =>
        context.mutateInTransaction<VideoProcessingTransaction & QueueSqlExecutor, T>((transaction) =>
          operation(transaction)
        )
    })
    finalizationStarted = true
    return await context.finalizeInTransaction<VideoProcessingTransaction & QueueSqlExecutor>(async (scope) => {
      if (await finalizeControl(scope, context.signal.aborted)) return
      await scope.complete({ result, message: '视频章节预览生成完成' })
    })
  } catch (error) {
    // Once a domain finalization transaction has started, the Worker must own
    // settlement. Retrying a generic release/cancel here can falsely report a
    // second terminal outcome after the final fence check rejected the first.
    if (finalizationStarted) throw error
    if (error instanceof VideoProcessingRecoveryError) return finalizeRecoveryAction(context, error)
    if (context.signal.aborted) {
      return context.finalizeInTransaction<VideoProcessingTransaction & QueueSqlExecutor>(async (scope) => {
        if (!(await finalizeControl(scope, true))) await scope.release('视频章节预览 Worker 已停止')
      })
    }
    return retryOrFail(context, dependencies, error, '视频章节预览生成失败')
  }
}

async function executeStreamingOptimization(
  context: VideoExecutionContext<StreamingPayload>,
  dependencies: VideoProcessingExecutorDependencies
): Promise<JobExecutionOutcome> {
  let prepared: PreparedVideoStreamingOptimization | undefined
  let finalizationStarted = false
  try {
    prepared = await prepareVideoStreamingOptimization({
      jobId: context.job.id,
      systemJobId: context.job.id,
      attempt: context.job.attempt,
      imageId: context.payload.imageId,
      relativePath: context.payload.relativePath,
      database: dependencies.database,
      config: dependencies.config,
      processRunner: dependencies.processRunner ?? runVideoProcess,
      signal: context.signal,
      progress: (update) =>
        context.progress({
          progress: update.percentage,
          stage: update.stage,
          message: update.message,
          ...(update.data ? { data: update.data } : {})
        }),
      mutate: <T>(operation: (transaction: VideoProcessingTransaction) => Promise<T>) =>
        context.mutateInTransaction<VideoProcessingTransaction & QueueSqlExecutor, T>((transaction) =>
          operation(transaction)
        ),
      ...(dependencies.now ? { now: dependencies.now } : {})
    })
    finalizationStarted = true
    const outcome = await context.finalizeInTransaction<VideoProcessingTransaction & QueueSqlExecutor>(
      async (scope) => {
        if (scope.executionStatus === 'PAUSING') {
          await prepared!.discard()
          await scope.pause({ reason: 'USER_REQUESTED', message: '视频流优化已暂停，可安全重试' })
          return
        }
        if (scope.executionStatus === 'CANCELLING') {
          await prepared!.discard()
          await scope.cancel('视频流优化已取消，原视频未变更')
          return
        }
        if (context.signal.aborted) {
          await prepared!.discard()
          await scope.release('视频流优化 Worker 已停止，原视频未变更')
          return
        }
        await prepared!.publish(scope.transaction)
        await scope.complete({ result: prepared!.result, message: '视频流优化完成' })
      }
    )
    return outcome
  } catch (error) {
    let terminalError = error
    if (prepared) {
      try {
        await prepared.rollback()
      } catch (recoveryError) {
        terminalError =
          recoveryError instanceof VideoProcessingRecoveryError
            ? recoveryError
            : new VideoProcessingRecoveryError(
                'Streaming execution failed and rollback could not restore the original video; manual action is required',
                error,
                recoveryError
              )
      }
    }
    if (finalizationStarted) {
      if (terminalError instanceof VideoProcessingRecoveryError) {
        context.logger.error('video.streaming_recovery_failed_after_domain_finalization', terminalError, {
          jobId: context.job.id,
          attempt: context.job.attempt,
          action: 'leave_for_lease_recovery'
        })
      }
      // The Worker records that domain finalization started and deliberately
      // leaves an unsuccessful transaction for lease recovery. A second finalizer
      // would be rejected and could falsely report ACTION_REQUIRED as committed.
      throw terminalError
    }
    if (terminalError instanceof VideoProcessingRecoveryError) {
      return finalizeRecoveryAction(context, terminalError)
    }
    if (context.signal.aborted) {
      return context.finalizeInTransaction<VideoProcessingTransaction & QueueSqlExecutor>(async (scope) => {
        if (!(await finalizeControl(scope, true))) await scope.release('视频流优化 Worker 已停止')
      })
    }
    return retryOrFail(context, dependencies, terminalError, '视频流优化失败')
  }
}

function finalizeRecoveryAction(
  context: VideoExecutionContext<unknown>,
  error: VideoProcessingRecoveryError
): Promise<JobExecutionOutcome> {
  return context.finalizeInTransaction<VideoProcessingTransaction & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel(`视频任务已取消，但文件恢复失败，需要人工检查：${error.message}`)
      return
    }
    await scope.pause({
      reason: scope.executionStatus === 'PAUSING' ? 'USER_REQUESTED' : 'ACTION_REQUIRED',
      message: `文件恢复失败，需要人工检查：${error.message}`,
      data: { errorCode: 'FILESYSTEM_RECOVERY_FAILED' }
    })
  })
}

async function finalizeControl(scope: VideoFencedScope, shutdown: boolean) {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: '视频任务已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.cancel('视频任务已取消')
    return true
  }
  if (shutdown) {
    await scope.release('视频 Worker 已停止')
    return true
  }
  return false
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: VideoProcessingExecutorDependencies,
  error: unknown,
  message: string
): JobExecutionOutcome {
  const failure = classifyError(error)
  if (error instanceof VideoProcessingPermanentError || context.job.attempt >= context.job.maxAttempts) {
    return { kind: 'failed', errorCode: failure.errorCode, error: failure.message, message }
  }
  const now = dependencies.now?.() ?? new Date()
  return {
    kind: 'retry',
    availableAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, context.job.attempt - 1))),
    errorCode: failure.errorCode,
    error: failure.message,
    message: `${message}，等待重试`
  }
}

function classifyError(error: unknown): { errorCode: JobErrorCode; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown video processing failure'
  if (error instanceof VideoProcessingProcessError) return { errorCode: error.code, message }
  if (error instanceof VideoProcessingPermanentError) {
    if (error.code === 'IMAGE_NOT_FOUND') return { errorCode: 'SOURCE_NOT_FOUND', message }
    if (error.code === 'PATH_OUTSIDE_ALLOWED_ROOT') return { errorCode: 'PATH_OUTSIDE_ALLOWED_ROOT', message }
    if (error.code === 'READ_ONLY_SOURCE') return { errorCode: 'FILESYSTEM_PERMISSION_DENIED', message }
    return { errorCode: 'PRECONDITION_FAILED', message }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return { errorCode: 'SOURCE_NOT_FOUND', message }
  if (code === 'EACCES' || code === 'EPERM') return { errorCode: 'FILESYSTEM_PERMISSION_DENIED', message }
  return { errorCode: 'INTERNAL_ERROR', message }
}

function assertConfig(config: VideoProcessingRuntimeConfig) {
  if (!config.scanRoot.trim()) throw new Error('Video processing scanRoot is required')
  if (!config.chapterPreviewRoot.trim()) throw new Error('Video processing chapterPreviewRoot is required')
  if (!Number.isInteger(config.ffmpegThreads) || config.ffmpegThreads < 1 || config.ffmpegThreads > 8) {
    throw new Error('Video processing ffmpegThreads must be an integer between 1 and 8')
  }
  if (
    config.chapterPageSize !== undefined &&
    (!Number.isInteger(config.chapterPageSize) || config.chapterPageSize < 1 || config.chapterPageSize > 200)
  ) {
    throw new Error('Video processing chapterPageSize must be an integer between 1 and 200')
  }
}
