import {
  JOB_DEFINITION_VERSION,
  videoKeyframeDiscoveryPayloadSchema,
  videoKeyframeGenerationPayloadSchema,
  type JobErrorCode
} from '@pixishelf/job-contracts'
import type {
  ExecutionContext,
  EnqueuedChildJob,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { discoverVideoKeyframes, type VideoKeyframeDiscoveryPayload } from './discovery.js'
import { generateVideoKeyframes, type VideoKeyframeGenerationPayload } from './generation.js'
import type { VideoKeyframeDatabase, VideoKeyframeRuntimeConfig, VideoKeyframeTransaction } from './types.js'
import { VideoKeyframePermanentError, VideoKeyframeProcessError } from './types.js'

export interface VideoKeyframeExecutorDependencies {
  database: VideoKeyframeDatabase
  config: VideoKeyframeRuntimeConfig
  now?: () => Date
}

export function createVideoKeyframeExecutorRegistrations(
  dependencies: VideoKeyframeExecutorDependencies
): ExecutorDefinition[] {
  assertConfig(dependencies.config)
  const discovery: ExecutorDefinition<VideoKeyframeDiscoveryPayload> = {
    jobType: 'VIDEO_KEYFRAME_DISCOVERY',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => videoKeyframeDiscoveryPayloadSchema.parse(payload),
    execute: (context) => executeDiscovery(context, dependencies)
  }
  const generation: ExecutorDefinition<VideoKeyframeGenerationPayload> = {
    jobType: 'VIDEO_KEYFRAME_GENERATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => videoKeyframeGenerationPayloadSchema.parse(payload),
    execute: (context) => executeGeneration(context, dependencies)
  }
  return [discovery as ExecutorDefinition, generation as ExecutorDefinition]
}

async function executeDiscovery(
  context: ExecutionContext<VideoKeyframeDiscoveryPayload, EnqueuedChildJob>,
  dependencies: VideoKeyframeExecutorDependencies
): Promise<JobExecutionOutcome> {
  try {
    const result = await discoverVideoKeyframes({
      jobId: context.job.id,
      payload: context.payload,
      database: dependencies.database,
      config: dependencies.config,
      signal: context.signal,
      progress: (update) =>
        context.progress({
          progress: update.percentage,
          stage: update.stage,
          message: update.message,
          ...(update.data ? { data: update.data } : {})
        }),
      enqueueChild: (request) => context.enqueueChild(request)
    })
    return { kind: 'completed', result, message: discoveryMessage(result) }
  } catch (error) {
    if (context.signal.aborted) throw error
    return retryOrFail(context, dependencies, error)
  }
}

async function executeGeneration(
  context: ExecutionContext<VideoKeyframeGenerationPayload, EnqueuedChildJob>,
  dependencies: VideoKeyframeExecutorDependencies
): Promise<JobExecutionOutcome> {
  try {
    const prepared = await generateVideoKeyframes({
      jobId: context.job.id,
      payload: context.payload,
      database: dependencies.database,
      config: dependencies.config,
      signal: context.signal,
      progress: (update) =>
        context.progress({
          progress: update.percentage,
          stage: update.stage,
          message: update.message,
          ...(update.data ? { data: update.data } : {})
        }),
      mutate: <T>(operation: (transaction: VideoKeyframeTransaction) => Promise<T>) =>
        context.mutateInTransaction<VideoKeyframeTransaction & QueueSqlExecutor, T>((transaction) =>
          operation(transaction)
        )
    })
    return context.finalizeInTransaction<VideoKeyframeTransaction & QueueSqlExecutor>(async (scope) => {
      if (await finalizeGenerationControl(scope, context.job.id)) return
      await prepared.publish(scope.transaction)
      await scope.complete({ result: prepared.result, message: '视频代表帧生成完成' })
    })
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<VideoKeyframeTransaction & QueueSqlExecutor>(async (scope) => {
        if (await finalizeGenerationControl(scope, context.job.id)) return
        await scope.release('视频代表帧 Worker 已停止，保留生成检查点等待恢复')
      })
    }
    const failure = classifyError(error)
    const retryable = !(error instanceof VideoKeyframePermanentError) && context.job.attempt < context.job.maxAttempts
    if (retryable) {
      return {
        kind: 'retry',
        availableAt: retryAt(context.payload.mode, context.job.attempt, dependencies.now?.() ?? new Date()),
        errorCode: failure.errorCode,
        error: failure.message,
        message: '视频代表帧生成失败，等待重试'
      }
    }
    return context.finalizeInTransaction<VideoKeyframeTransaction & QueueSqlExecutor>(async (scope) => {
      if (await finalizeGenerationControl(scope, context.job.id)) return
      await scope.transaction.mediaVideoKeyframeSet.updateMany({
        where: { systemJobId: context.job.id, status: 'STAGING' },
        data: { status: 'FAILED', error: failure.message }
      })
      await scope.fail({ errorCode: failure.errorCode, error: failure.message, message: '视频代表帧生成失败' })
    })
  }
}

async function finalizeGenerationControl(
  scope: FencedExecutionTransaction<VideoKeyframeTransaction & QueueSqlExecutor>,
  jobId: string
): Promise<boolean> {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: '视频代表帧生成已暂停，保留生成检查点' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.transaction.mediaVideoKeyframeSet.updateMany({
      where: { systemJobId: jobId, status: 'STAGING' },
      data: { status: 'FAILED', error: '视频代表帧生成已取消；派生文件等待后续 GC' }
    })
    await scope.cancel('视频代表帧生成已取消')
    return true
  }
  return false
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: VideoKeyframeExecutorDependencies,
  error: unknown
): JobExecutionOutcome {
  const failure = classifyError(error)
  if (error instanceof VideoKeyframePermanentError || context.job.attempt >= context.job.maxAttempts) {
    return { kind: 'failed', errorCode: failure.errorCode, error: failure.message, message: '视频代表帧发现失败' }
  }
  return {
    kind: 'retry',
    availableAt: retryAt('AUTO_INCREMENTAL', context.job.attempt, dependencies.now?.() ?? new Date()),
    errorCode: failure.errorCode,
    error: failure.message,
    message: '视频代表帧发现失败，等待重试'
  }
}

function classifyError(error: unknown): { errorCode: JobErrorCode; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown video keyframe failure'
  if (error instanceof VideoKeyframeProcessError) return { errorCode: error.code, message }
  if (error instanceof VideoKeyframePermanentError) {
    if (error.code === 'PATH_OUTSIDE_ALLOWED_ROOT') return { errorCode: 'PATH_OUTSIDE_ALLOWED_ROOT', message }
    if (error.code === 'IMAGE_NOT_FOUND') return { errorCode: 'SOURCE_NOT_FOUND', message }
    return { errorCode: 'PRECONDITION_FAILED', message }
  }
  if (isFileError(error, 'ENOENT')) return { errorCode: 'SOURCE_NOT_FOUND', message }
  if (isFileError(error, 'EACCES') || isFileError(error, 'EPERM')) {
    return { errorCode: 'FILESYSTEM_PERMISSION_DENIED', message }
  }
  return { errorCode: 'INTERNAL_ERROR', message }
}

function retryAt(mode: string, attempt: number, now: Date) {
  const base = mode === 'AUTO_INCREMENTAL' ? 5 * 60_000 : 15_000
  return new Date(now.getTime() + Math.min(60 * 60_000, base * 2 ** Math.max(0, attempt - 1)))
}

function discoveryMessage(result: { matched: number; enqueued: number; inaccessible: number }) {
  return `发现完成：匹配 ${result.matched} 个视频，创建 ${result.enqueued} 个生成任务${
    result.inaccessible > 0 ? `，${result.inaccessible} 个不可访问` : ''
  }`
}

function isFileError(error: unknown, code: string) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

function assertConfig(config: VideoKeyframeRuntimeConfig) {
  if (!config.scanRoot.trim()) throw new Error('Video keyframe scanRoot is required')
  if (!config.keyframeStorageRoot.trim()) throw new Error('Video keyframe keyframeStorageRoot is required')
  if (!Number.isInteger(config.ffmpegThreads) || config.ffmpegThreads < 1 || config.ffmpegThreads > 8) {
    throw new Error('Video keyframe ffmpegThreads must be an integer between 1 and 8')
  }
}
