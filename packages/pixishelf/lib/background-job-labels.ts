import type { JobType } from '@pixishelf/job-contracts'

export const backgroundJobTypeLabels: Record<JobType, string> = {
  SCAN: '图库扫描',
  LOCAL_DIRECTORY_IMPORT: '本地目录导入',
  MIGRATION: '数据迁移',
  PENDING_REPLACE: '待替换媒体',
  PIXIV_ARTWORK_ENRICHMENT: 'Pixiv 作品在线同步',
  PIXIV_ARTIST_ENRICHMENT: 'Pixiv 艺术家补全',
  PIXIV_SERIES_RECONCILIATION: 'Pixiv 系列核对',
  PIXIV_AI_DERIVED_TAG_SYNC: '校准 Pixiv AI 派生标签',
  PIXIV_TAG_ENRICHMENT: 'Pixiv 标签补全',
  REFILL_META_SOURCE: '补全来源元数据',
  MEDIA_DERIVED_TAG_SYNC: '同步媒体标签',
  WEBP_ANIMATION_SCAN: '识别图片动画',
  VIDEO_MEDIA_PROBE: '视频媒体探测与封面生成',
  VIDEO_POSTER_GENERATION: '视频封面生成',
  VIDEO_CHAPTER_PREVIEW_GENERATION: '视频章节截图',
  VIDEO_STREAMING_OPTIMIZATION: '视频播放优化',
  VIDEO_KEYFRAME_DISCOVERY: '代表帧筛选',
  VIDEO_KEYFRAME_GENERATION: '代表帧生成',
  ARCHIVE_IMPORT: '归档导入',
  ARCHIVE_RESOLVE_ITEM: '解析归档收件',
  ARCHIVE_UPLOADER_SCAN: '上传者发现扫描',
  ARCHIVE_SEARCH_SCAN: '标题关键词扫描',
  ARCHIVE_DEFAULT_TAG_BACKFILL: '补全历史归档标签',
  ARCHIVE_MAINTENANCE: '归档维护',
  ARCHIVE_INTAKE_RETENTION_CLEANUP: '归档收件历史清理',
  SCAN_RUN_RETENTION_CLEANUP: '扫描记录清理',
  TRIGGER_LOG_RETENTION_CLEANUP: '触发日志清理',
  JOB_EVENT_RETENTION_CLEANUP: '后台任务事件清理',
  DERIVED_MEDIA_GC: '衍生媒体清理'
}

export const backgroundScanModeLabels = {
  CONSISTENCY_AUDIT: 'Pixiv 来源核对',
  AUDIT_APPLY: 'Pixiv 来源同步',
  FULL_RECONCILE: '历史来源核对（已停用）'
} as const

export function backgroundJobLabel(type: JobType, payload?: unknown): string {
  if (type === 'SCAN' && payload && typeof payload === 'object' && 'mode' in payload) {
    const mode = payload.mode
    if (typeof mode === 'string' && Object.hasOwn(backgroundScanModeLabels, mode)) {
      return backgroundScanModeLabels[mode as keyof typeof backgroundScanModeLabels]
    }
  }
  return backgroundJobTypeLabels[type] ?? type
}

export const backgroundTriggerLabels = {
  MANUAL: '手动',
  SCHEDULE: '计划',
  SYSTEM: '系统',
  RETRY: '重试',
  LEGACY: '历史迁入'
} as const
