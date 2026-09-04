import 'server-only'

import logger from '@/lib/logger'
import * as JobService from '@/services/job-service'
import { getScanPath } from '@/services/setting.service'
import { cleanupScanRunHistory } from '@/services/scan-run-service'
import { cleanupTriggerLogs, TRIGGER_LOG_RETENTION_DAYS } from '@/services/trigger-log-service'
import { ARCHIVE_INTAKE_RETENTION_DAYS } from '@pixishelf/job-executors'
import { runVideoMediaProbeJob } from '@/services/video-media-probe-service'
import {
  runVideoChapterPreviewGenerationJob,
  type VideoChapterPreviewGenerationMode
} from '@/services/video-chapter-preview-service'
import { runVideoPosterGenerationJob } from '@/services/video-poster-service'
import { enqueueVideoKeyframeBatch } from '@/services/video-keyframe-queue'
import { runWebpAnimationScanJob } from '@/services/webp-animation-scan-service'

export const SCHEDULED_TASK_TYPES = {
  WEBP_ANIMATION_SCAN: 'WEBP_ANIMATION_SCAN',
  VIDEO_MEDIA_PROBE: 'VIDEO_MEDIA_PROBE',
  VIDEO_CHAPTER_PREVIEW_GENERATION: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
  VIDEO_KEYFRAME_DISCOVERY: 'VIDEO_KEYFRAME_DISCOVERY',
  DERIVED_MEDIA_GC: 'DERIVED_MEDIA_GC',
  ARCHIVE_MAINTENANCE: 'ARCHIVE_MAINTENANCE',
  ARCHIVE_INTAKE_RETENTION_CLEANUP: 'ARCHIVE_INTAKE_RETENTION_CLEANUP',
  SCAN_RUN_RETENTION_CLEANUP: 'SCAN_RUN_RETENTION_CLEANUP',
  TRIGGER_LOG_RETENTION_CLEANUP: 'TRIGGER_LOG_RETENTION_CLEANUP',
  JOB_EVENT_RETENTION_CLEANUP: 'JOB_EVENT_RETENTION_CLEANUP'
} as const

export type ScheduledTaskType = (typeof SCHEDULED_TASK_TYPES)[keyof typeof SCHEDULED_TASK_TYPES]

export interface ScheduledTaskDefinition {
  key: string
  type: ScheduledTaskType
  name: string
  description: string
  defaultTime: string
  defaultTimezone: string
  defaultPriority: number
  defaultEnabled: boolean
  mutexKey: string | null
  defaultConfig?: unknown
}

export const SCHEDULED_TASK_DEFINITIONS: ScheduledTaskDefinition[] = [
  {
    key: 'trigger_log_retention_cleanup',
    type: SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP,
    name: '清理触发器日志',
    description: `删除超过 ${TRIGGER_LOG_RETENTION_DAYS} 天的触发器维护日志。`,
    defaultTime: '02:00',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 10,
    defaultEnabled: true,
    mutexKey: 'audit-maintenance'
  },
  {
    key: 'archive_maintenance_reconcile',
    type: SCHEDULED_TASK_TYPES.ARCHIVE_MAINTENANCE,
    name: '修复归档维护状态',
    description: '发现到期暂存清理、孤立归档回收/恢复意图和到期回收站，并为每个目标幂等创建维护任务。',
    defaultTime: '02:05',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 12,
    defaultEnabled: true,
    mutexKey: 'audit-maintenance'
  },
  {
    key: 'archive_intake_retention_cleanup',
    type: SCHEDULED_TASK_TYPES.ARCHIVE_INTAKE_RETENTION_CLEANUP,
    name: '清理归档收件历史',
    description: `删除超过 ${ARCHIVE_INTAKE_RETENTION_DAYS} 天的终态收件记录和已完成批量操作，并清理过期预览会话；不会删除归档作品或媒体。`,
    defaultTime: '02:15',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 15,
    defaultEnabled: true,
    mutexKey: 'audit-maintenance'
  },
  {
    key: 'job_event_retention_cleanup',
    type: SCHEDULED_TASK_TYPES.JOB_EVENT_RETENTION_CLEANUP,
    name: '清理后台任务事件',
    description: '进度事件保留 7 天，阶段、警告、控制和终态事件保留 90 天；每批最多删除 5,000 条。',
    defaultTime: '02:20',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 18,
    defaultEnabled: false,
    mutexKey: 'audit-maintenance'
  },
  {
    key: 'scan_run_retention_cleanup',
    type: SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP,
    name: '清理扫描历史',
    description: '删除超过保留策略的扫描审计历史：终态记录保留 180 天，并按类型保留最近 100 条。',
    defaultTime: '02:30',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 20,
    defaultEnabled: false,
    mutexKey: 'audit-maintenance'
  },
  {
    key: 'webp_animation_scan',
    type: SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN,
    name: '识别图片动画',
    description: '按内容识别 WebP、GIF、PNG/APNG 的静态或动画类型，并纠正 mediaType。',
    defaultTime: '03:30',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 30,
    defaultEnabled: false,
    mutexKey: 'media-maintenance'
  },
  {
    key: 'video_media_probe',
    type: SCHEDULED_TASK_TYPES.VIDEO_MEDIA_PROBE,
    name: '视频媒体探测与封面生成',
    description: '分类未识别媒体，探测视频音频、编码、时长和帧率，并生成缺失的视频封面。',
    defaultTime: '04:00',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 40,
    defaultEnabled: false,
    mutexKey: 'media-maintenance'
  },
  {
    key: 'video_chapter_preview_generation',
    type: SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION,
    name: '生成视频章节截图',
    description: '每日增量补齐缺失章节截图，也可手动执行全量校验与重新生成。',
    defaultTime: '04:30',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 50,
    defaultEnabled: false,
    mutexKey: 'media-maintenance'
  },
  {
    key: 'video_keyframe_generation',
    type: SCHEDULED_TASK_TYPES.VIDEO_KEYFRAME_DISCOVERY,
    name: '生成视频代表帧',
    description: '增量发现缺失或源文件已变化的视频，并交由持久 Worker 生成代表帧。',
    defaultTime: '05:00',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 60,
    defaultEnabled: false,
    mutexKey: 'media-maintenance',
    defaultConfig: {
      minDuration: null,
      maxDuration: null,
      includePaths: [],
      excludePaths: [],
      statuses: ['MISSING', 'STALE', 'FAILED']
    }
  },
  {
    key: 'derived_media_gc',
    type: SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC,
    name: '清理派生媒体',
    description: '删除已登记、无引用且已到期的派生媒体文件；不会扫描或删除未登记文件。',
    defaultTime: '05:30',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 70,
    defaultEnabled: false,
    mutexKey: 'media-maintenance'
  },
  {
    key: 'derived_media_gc_reconciliation',
    type: SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC,
    name: '核对派生媒体目录',
    description: '每周一在上海调度窗口中有界扫描派生媒体目录，只读核对并输出差异，不删除文件。',
    defaultTime: '05:45',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 71,
    defaultEnabled: false,
    mutexKey: 'media-maintenance'
  }
]

export interface StartScheduledTaskOptions {
  trigger: 'manual' | 'schedule'
  chapterPreviewMode?: VideoChapterPreviewGenerationMode
  videoProbeMode?: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  taskConfig?: unknown
}

export interface StartScheduledTaskResult {
  jobId: string
}

type ScheduledTaskHandler = {
  start: (options: StartScheduledTaskOptions) => Promise<StartScheduledTaskResult>
}

export const SCHEDULED_TASK_HANDLERS: Record<ScheduledTaskType, ScheduledTaskHandler> = {
  [SCHEDULED_TASK_TYPES.ARCHIVE_MAINTENANCE]: {
    start: startArchiveMaintenanceReconcileTask
  },
  [SCHEDULED_TASK_TYPES.ARCHIVE_INTAKE_RETENTION_CLEANUP]: {
    start: startArchiveIntakeRetentionCleanupTask
  },
  [SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP]: {
    start: startTriggerLogRetentionCleanupTask
  },
  [SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP]: {
    start: startScanRunRetentionCleanupTask
  },
  [SCHEDULED_TASK_TYPES.JOB_EVENT_RETENTION_CLEANUP]: {
    start: async () => {
      throw new Error('Job event retention cleanup requires central dispatcher cutover')
    }
  },
  [SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN]: {
    start: startWebpAnimationScanTask
  },
  [SCHEDULED_TASK_TYPES.VIDEO_MEDIA_PROBE]: {
    start: startVideoMediaProbeTask
  },
  [SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION]: {
    start: startVideoChapterPreviewGenerationTask
  },
  [SCHEDULED_TASK_TYPES.VIDEO_KEYFRAME_DISCOVERY]: {
    start: startVideoKeyframeDiscoveryTask
  },
  [SCHEDULED_TASK_TYPES.DERIVED_MEDIA_GC]: {
    start: startDerivedMediaGcTask
  }
}

async function startDerivedMediaGcTask(): Promise<StartScheduledTaskResult> {
  throw new Error('Derived media GC requires central dispatcher cutover')
}

async function startArchiveIntakeRetentionCleanupTask(): Promise<StartScheduledTaskResult> {
  throw new Error('Archive intake retention cleanup requires central dispatcher cutover')
}

async function startArchiveMaintenanceReconcileTask(): Promise<StartScheduledTaskResult> {
  throw new Error('Archive maintenance reconciliation requires central dispatcher cutover')
}

async function startTriggerLogRetentionCleanupTask(
  options: StartScheduledTaskOptions
): Promise<StartScheduledTaskResult> {
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.TRIGGER_LOG_RETENTION_CLEANUP)
  if (activeJob) {
    throw new Error('Trigger log retention cleanup job is already running')
  }

  const job = await JobService.createTriggerLogRetentionCleanupJob()

  // 处理器在事务外异步执行，避免界面请求在清理期间阻塞；失败分支统一写入失败或已取消状态。
  ;(async () => {
    try {
      await JobService.updateProgress(job.id, 10, '正在清理过期触发器日志...')
      const result = await cleanupTriggerLogs()
      await JobService.updateProgress(job.id, 100, '触发器日志清理完成')
      await JobService.completeJob(job.id, { ...result, trigger: options.trigger })
    } catch (error) {
      logger.error('Trigger log retention cleanup job failed', { error, trigger: options.trigger })
      await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
    }
  })()

  return { jobId: job.id }
}

export function getScheduledTaskDefinition(key: string) {
  return SCHEDULED_TASK_DEFINITIONS.find((definition) => definition.key === key) ?? null
}

export function getScheduledTaskDefinitionByType(type: string) {
  return SCHEDULED_TASK_DEFINITIONS.find((definition) => definition.type === type) ?? null
}

export function getScheduledTaskHandler(type: string) {
  return SCHEDULED_TASK_HANDLERS[type as ScheduledTaskType] ?? null
}

async function startScanRunRetentionCleanupTask(options: StartScheduledTaskOptions): Promise<StartScheduledTaskResult> {
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.SCAN_RUN_RETENTION_CLEANUP)
  if (activeJob) {
    throw new Error('Scan run retention cleanup job is already running')
  }

  const job = await JobService.createScanRunRetentionCleanupJob()

  // 注意：扫描历史清理返回可复用进度事件；该任务不持有扫描路径配置依赖，可在未配置 scan path 时仍能运行。
  ;(async () => {
    try {
      await JobService.updateProgress(job.id, 10, '正在计算需要清理的扫描历史...')
      const result = await cleanupScanRunHistory()
      await JobService.updateProgress(job.id, 100, '扫描历史清理完成')
      await JobService.completeJob(job.id, { ...result, trigger: options.trigger })
    } catch (error) {
      logger.error('Scan run retention cleanup job failed', { error, trigger: options.trigger })
      await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
    }
  })()

  return { jobId: job.id }
}

async function startWebpAnimationScanTask(options: StartScheduledTaskOptions): Promise<StartScheduledTaskResult> {
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN)
  if (activeJob) {
    throw new Error('Image animation scan job is already running')
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('Scan path is not configured')
  }

  const job = await JobService.createWebpAnimationScanJob()

  // 与多数任务不同，图片动图识别与封面重建需要 checkCancelled 钩子；当前 handler 以“运行中立即返回 jobId”为设计，便于调用方轮询状态。
  ;(async () => {
    try {
      const result = await runWebpAnimationScanJob({
        scanPath,
        checkCancelled: async () => {
          const current = await JobService.getJob(job.id)
          return current?.status === 'CANCELLING' || current?.status === 'CANCELLED'
        },
        onProgress: async (progress) => {
          await JobService.updateProgress(job.id, progress.percentage, progress.message)
        }
      })
      await JobService.completeJob(job.id, { ...result, trigger: options.trigger })
    } catch (error) {
      logger.error('Image animation scan job failed', { error, trigger: options.trigger })

      const current = await JobService.getJob(job.id)
      if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
        await JobService.markAsCancelled(job.id)
      } else {
        await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  })()

  return { jobId: job.id }
}

async function startVideoMediaProbeTask(options: StartScheduledTaskOptions): Promise<StartScheduledTaskResult> {
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.VIDEO_MEDIA_PROBE)
  if (activeJob) {
    throw new Error('Video media probe job is already running')
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('Scan path is not configured')
  }

  const job = await JobService.createVideoMediaProbeJob()

  // 媒体探测任务在完成探测后会链式执行封面生成，若运行中被取消则标记为 CANCELLED，避免将部分进度误记为 FAILED。
  ;(async () => {
    try {
      const result = await runVideoMediaProbeJob({
        scanPath,
        mode: options.videoProbeMode ?? 'INCREMENTAL',
        force: options.videoProbeMode === 'RECHECK_HAS_AUDIO',
        checkpointCreatedAt: job.createdAt,
        checkCancelled: async () => {
          const current = await JobService.getJob(job.id)
          return current?.status === 'CANCELLING' || current?.status === 'CANCELLED'
        },
        onProgress: async (progress) => {
          await JobService.updateProgress(
            job.id,
            Math.min(50, Math.round(progress.percentage / 2)),
            `媒体探测：${progress.message}`
          )
        }
      })
      const posterResult =
        options.videoProbeMode === 'RECHECK_HAS_AUDIO'
          ? { pending: 0, processed: 0, generated: 0, failed: 0, remainingPending: 0, failedSamples: [] }
          : await (async () => {
              await JobService.updateProgress(job.id, 50, '媒体探测完成，正在生成视频封面...')
              return runVideoPosterGenerationJob({
                scanPath,
                checkCancelled: async () => {
                  const current = await JobService.getJob(job.id)
                  return current?.status === 'CANCELLING' || current?.status === 'CANCELLED'
                },
                onProgress: async (progress) => {
                  await JobService.updateProgress(
                    job.id,
                    50 + Math.round(progress.percentage / 2),
                    `生成封面：${progress.message}`
                  )
                }
              })
            })()
      const current = await JobService.getJob(job.id)
      if (current?.status === 'CANCELLING' || current?.status === 'CANCELLED') {
        await JobService.markAsCancelled(job.id)
        return
      }
      await JobService.completeJob(job.id, { ...result, poster: posterResult, trigger: options.trigger })
    } catch (error) {
      logger.error('Video media probe job failed', { error, trigger: options.trigger })

      const current = await JobService.getJob(job.id)
      if (
        current?.status === 'CANCELLING' ||
        current?.status === 'CANCELLED' ||
        (error instanceof Error && error.message === 'Task cancelled')
      ) {
        await JobService.markAsCancelled(job.id)
      } else {
        await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  })()

  return { jobId: job.id }
}

async function startVideoChapterPreviewGenerationTask(
  options: StartScheduledTaskOptions
): Promise<StartScheduledTaskResult> {
  const mode = options.chapterPreviewMode ?? (options.trigger === 'schedule' ? 'INCREMENTAL' : 'FULL')
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.VIDEO_CHAPTER_PREVIEW_GENERATION)
  if (activeJob) {
    throw new Error('Video chapter preview generation job is already running')
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('Scan path is not configured')
  }

  const job = await JobService.createVideoChapterPreviewGenerationJob()

  ;(async () => {
    try {
      const result = await runVideoChapterPreviewGenerationJob({
        scanPath,
        mode,
        checkCancelled: async () => {
          const current = await JobService.getJob(job.id)
          return current?.status === 'CANCELLING' || current?.status === 'CANCELLED'
        },
        onProgress: async (progress) => {
          await JobService.updateProgress(job.id, progress.percentage, progress.message)
        }
      })
      const current = await JobService.getJob(job.id)
      if (current?.status === 'CANCELLING' || current?.status === 'CANCELLED') {
        await JobService.markAsCancelled(job.id)
        return
      }
      await JobService.completeJob(job.id, { ...result, trigger: options.trigger })
    } catch (error) {
      logger.error('Video chapter preview generation job failed', { error, trigger: options.trigger, mode })
      const current = await JobService.getJob(job.id)
      if (
        current?.status === 'CANCELLING' ||
        current?.status === 'CANCELLED' ||
        (error instanceof Error && error.message === 'Task cancelled')
      ) {
        await JobService.markAsCancelled(job.id)
      } else {
        await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
      }
    }
  })()

  return { jobId: job.id }
}

async function startVideoKeyframeDiscoveryTask(options: StartScheduledTaskOptions): Promise<StartScheduledTaskResult> {
  const result = await enqueueVideoKeyframeBatch({
    trigger: options.trigger,
    previewOnly: options.trigger === 'manual',
    filter: options.taskConfig
  })
  return { jobId: result.jobId }
}
