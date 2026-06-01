import 'server-only'

import logger from '@/lib/logger'
import * as JobService from '@/services/job-service'
import { getScanPath } from '@/services/setting.service'
import { runWebpAnimationScanJob } from '@/services/webp-animation-scan-service'

export const SCHEDULED_TASK_TYPES = {
  WEBP_ANIMATION_SCAN: 'WEBP_ANIMATION_SCAN'
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
          return current?.status === 'CANCELLING'
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
