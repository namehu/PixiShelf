import 'server-only'

import logger from '@/lib/logger'
import * as JobService from '@/services/job-service'
import { getScanPath } from '@/services/setting.service'
import { runVideoMediaProbeJob } from '@/services/video-media-probe-service'
import { runWebpAnimationScanJob } from '@/services/webp-animation-scan-service'

export const SCHEDULED_TASK_TYPES = {
  WEBP_ANIMATION_SCAN: 'WEBP_ANIMATION_SCAN',
  VIDEO_MEDIA_PROBE: 'VIDEO_MEDIA_PROBE'
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
  mutexKey: string | null
}

export const SCHEDULED_TASK_DEFINITIONS: ScheduledTaskDefinition[] = [
  {
    key: 'webp_animation_scan',
    type: SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN,
    name: '识别 WebP 动图',
    description: '初始化未处理的 WebP 图片，并识别静态图或动图。',
    defaultTime: '03:30',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 30,
    mutexKey: 'media-maintenance'
  },
  {
    key: 'video_media_probe',
    type: SCHEDULED_TASK_TYPES.VIDEO_MEDIA_PROBE,
    name: '视频媒体探测',
    description: '分类未识别媒体，并使用 ffprobe 探测视频音频、编码、时长和帧率。',
    defaultTime: '04:00',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 40,
    mutexKey: 'media-maintenance'
  }
]

export interface StartScheduledTaskOptions {
  trigger: 'manual' | 'schedule'
}

export interface StartScheduledTaskResult {
  jobId: string
}

type ScheduledTaskHandler = {
  start: (options: StartScheduledTaskOptions) => Promise<StartScheduledTaskResult>
}

export const SCHEDULED_TASK_HANDLERS: Record<ScheduledTaskType, ScheduledTaskHandler> = {
  [SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN]: {
    start: startWebpAnimationScanTask
  },
  [SCHEDULED_TASK_TYPES.VIDEO_MEDIA_PROBE]: {
    start: startVideoMediaProbeTask
  }
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

async function startWebpAnimationScanTask(options: StartScheduledTaskOptions): Promise<StartScheduledTaskResult> {
  const activeJob = await JobService.getActiveJobByType(SCHEDULED_TASK_TYPES.WEBP_ANIMATION_SCAN)
  if (activeJob) {
    throw new Error('WebP animation scan job is already running')
  }

  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('Scan path is not configured')
  }

  const job = await JobService.createWebpAnimationScanJob()

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
      logger.error('WebP animation scan job failed', { error, trigger: options.trigger })

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

  ;(async () => {
    try {
      const result = await runVideoMediaProbeJob({
        scanPath,
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
