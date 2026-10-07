import 'server-only'

import { TRIGGER_LOG_RETENTION_DAYS } from '@/services/trigger-log-service'
import { ARCHIVE_INTAKE_RETENTION_DAYS } from '@pixishelf/job-executors'

export const SCHEDULED_TASK_TYPES = {
  WEBP_ANIMATION_SCAN: 'WEBP_ANIMATION_SCAN',
  ANIMATION_DURATION_PROBE: 'ANIMATION_DURATION_PROBE',
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
    key: 'animation_duration_probe',
    type: SCHEDULED_TASK_TYPES.ANIMATION_DURATION_PROBE,
    name: '动图时长探测',
    description: '只探测已识别为动画的 WebP，并持久保存单周期时长；失败文件可手动重试。',
    defaultTime: '03:45',
    defaultTimezone: 'Asia/Shanghai',
    defaultPriority: 35,
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

export function getScheduledTaskDefinition(key: string) {
  return SCHEDULED_TASK_DEFINITIONS.find((definition) => definition.key === key)
}
