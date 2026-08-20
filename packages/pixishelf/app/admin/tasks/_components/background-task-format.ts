import type { JobDto, JobEventDto, JobStatus, JobType, WorkerHealthDto } from '@pixishelf/job-contracts'
import { isWorkerHeartbeatFresh } from '@/services/background-task/worker-heartbeat'

export const ACTIVE_JOB_STATUSES: JobStatus[] = ['PENDING', 'RETRY_WAIT', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING']

export const EXECUTING_JOB_STATUSES: JobStatus[] = ['RUNNING', 'PAUSING', 'CANCELLING']

const statusLabels: Record<JobStatus, string> = {
  PENDING: '排队中',
  RETRY_WAIT: '等待重试',
  RUNNING: '执行中',
  PAUSING: '暂停中',
  PAUSED: '已暂停',
  CANCELLING: '取消中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  SKIPPED: '已跳过'
}

const typeLabels: Partial<Record<JobType, string>> = {
  SCAN: '图库扫描',
  LOCAL_DIRECTORY_IMPORT: '本地目录导入',
  MIGRATION: '数据迁移',
  PENDING_REPLACE: '待替换媒体',
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
  ARCHIVE_MAINTENANCE: '归档维护',
  ARCHIVE_INTAKE_RETENTION_CLEANUP: '归档收件历史清理',
  SCAN_RUN_RETENTION_CLEANUP: '扫描记录清理',
  TRIGGER_LOG_RETENTION_CLEANUP: '触发日志清理',
  DERIVED_MEDIA_GC: '衍生媒体清理'
}

const eventLabels: Record<JobEventDto['type'], string> = {
  'job.queued': '进入队列',
  'job.claimed': 'Worker 已领取',
  'job.started': '开始执行',
  'job.stage_changed': '阶段变更',
  'job.progress': '进度更新',
  'job.retry_scheduled': '计划重试',
  'job.pause_requested': '请求暂停',
  'job.paused': '已暂停',
  'job.cancel_requested': '请求取消',
  'job.cancelled': '已取消',
  'job.completed': '执行完成',
  'job.failed': '执行失败',
  'job.skipped': '已跳过',
  'worker.lease_recovered': '租约已恢复',
  'gc.entry_deleted': '文件已清理',
  'gc.entry_failed': '文件清理失败'
}

export function formatBackgroundJobStatus(status: JobStatus) {
  return statusLabels[status]
}

export function formatBackgroundJobType(type: JobType, payload?: unknown) {
  if (isHistoricalFullScan(type, payload)) return '历史来源核对（已停用）'
  return typeLabels[type] ?? type
}

export function formatBackgroundEventType(type: JobEventDto['type']) {
  return eventLabels[type]
}

export function formatBackgroundDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export function getWorkerHealth(worker: WorkerHealthDto, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(worker.heartbeatAt).getTime())
  const stale = !isWorkerHeartbeatFresh(worker.heartbeatAt, now)
  const healthy = worker.status === 'READY' && !stale
  return { ageMs, stale, healthy }
}

export function getWorkerSummary(workers: WorkerHealthDto[], now = Date.now()) {
  if (workers.length === 0) return { label: '无 Worker', tone: 'destructive' as const, readyCount: 0, staleCount: 0 }
  const health = workers.map((worker) => getWorkerHealth(worker, now))
  const readyCount = health.filter((item) => item.healthy).length
  const staleCount = health.filter((item) => item.stale).length
  if (readyCount > 0) return { label: `${readyCount} 个可用`, tone: 'success' as const, readyCount, staleCount }
  if (staleCount > 0) return { label: `${staleCount} 个心跳陈旧`, tone: 'destructive' as const, readyCount, staleCount }
  return { label: 'Worker 未就绪', tone: 'warning' as const, readyCount, staleCount }
}

export function formatHeartbeatAge(ageMs: number) {
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 5) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

export function mergeJobEvents(current: JobEventDto[], incoming: JobEventDto[]) {
  const byId = new Map(current.map((event) => [event.id, event]))
  for (const event of incoming) byId.set(event.id, event)
  return [...byId.values()].sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? -1 : 1))
}

export function canCancelJob(job: JobDto) {
  return ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING'].includes(job.status)
}

export function canPauseJob(job: JobDto) {
  return ['PENDING', 'RETRY_WAIT', 'RUNNING'].includes(job.status)
}

export function canResumeJob(job: JobDto) {
  return job.status === 'PAUSED'
}

export function canRetryJob(job: JobDto) {
  return !isNonRetryableScan(job.type, job.payload) && ['FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status)
}

function isNonRetryableScan(type: JobType, payload: unknown) {
  if (type !== 'SCAN' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
  if (!('mode' in payload)) return false
  return ['FULL_RECONCILE', 'CLIENT_LIST', 'ARTWORK_RESCAN'].includes(String(payload.mode))
}

function isHistoricalFullScan(type: JobType, payload: unknown) {
  return (
    type === 'SCAN' &&
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    'mode' in payload &&
    payload.mode === 'FULL_RECONCILE'
  )
}

export function canChangePriority(job: JobDto) {
  return ['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(job.status)
}
