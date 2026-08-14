export interface VideoKeyframeJobView {
  id: string
  type?: string
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
  targetImageId?: number | null
  targetPath?: string | null
  mode?: string | null
  queuePosition?: number | null
  attempt?: number
  availableAt?: Date | string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

export const ACTIVE_VIDEO_KEYFRAME_STATUSES = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING']

export interface VideoKeyframeQueueView {
  capacity: number
  automaticCapacity: number
  active: VideoKeyframeJobView[]
  recent: VideoKeyframeJobView[]
  discoveryActive: VideoKeyframeJobView[]
  discoveryRecent: VideoKeyframeJobView[]
}

export interface VideoKeyframePreviewCandidate {
  imageId: number
  path: string
  duration: number | null
  status: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT'
  publishedCount: number
}

export interface VideoKeyframePreviewResult {
  previewOnly: true
  previewTruncated: boolean
  matched: number
  inaccessible: number
  failedSamples: Array<{ imageId: number; path: string; error: string }>
  candidates: VideoKeyframePreviewCandidate[]
  force: boolean
  filter: {
    minDuration: number | null
    maxDuration: number | null
    includePaths: string[]
    excludePaths: string[]
    statuses: Array<'MISSING' | 'STALE' | 'FAILED'>
  }
}

export function isActiveVideoKeyframeJob(job?: VideoKeyframeJobView | null) {
  return Boolean(job && ACTIVE_VIDEO_KEYFRAME_STATUSES.includes(job.status))
}

export function shouldPollVideoKeyframeQueue(queue?: VideoKeyframeQueueView) {
  // PAUSED 仍属于活动任务，但暂停期间状态不会自动推进，因此无需保持轮询。
  return Boolean(
    queue &&
      [...queue.active, ...queue.discoveryActive].some((job) =>
        ['PENDING', 'RUNNING', 'PAUSING', 'CANCELLING'].includes(job.status)
      )
  )
}

export function isVideoKeyframePreviewJob(job: VideoKeyframeJobView) {
  if (!job.result || typeof job.result !== 'object' || Array.isArray(job.result)) return false
  const result = job.result as Record<string, unknown>
  if (result.previewOnly === true) return true
  // 兼容旧任务结果：早期版本把 previewOnly 保存在原始 request 中。
  const request = result.request
  return Boolean(
    request &&
      typeof request === 'object' &&
      !Array.isArray(request) &&
      (request as Record<string, unknown>).previewOnly
  )
}

export function getVideoKeyframePreviewResult(job?: VideoKeyframeJobView | null): VideoKeyframePreviewResult | null {
  if (job?.status !== 'COMPLETED' || !job.result || typeof job.result !== 'object' || Array.isArray(job.result)) {
    return null
  }
  const result = job.result as Record<string, unknown>
  if (result.previewOnly !== true || !Array.isArray(result.candidates)) return null
  // result 来自持久化的 unknown 数据；逐项收窄并丢弃损坏条目，避免旧任务数据破坏管理界面。
  const candidates = result.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const value = candidate as Record<string, unknown>
    if (
      !Number.isInteger(value.imageId) ||
      typeof value.path !== 'string' ||
      !['MISSING', 'STALE', 'FAILED', 'CURRENT'].includes(String(value.status))
    ) {
      return []
    }
    return [
      {
        imageId: Number(value.imageId),
        path: value.path,
        duration: typeof value.duration === 'number' && Number.isFinite(value.duration) ? value.duration : null,
        status: value.status as VideoKeyframePreviewCandidate['status'],
        publishedCount:
          typeof value.publishedCount === 'number' && Number.isInteger(value.publishedCount) ? value.publishedCount : 0
      }
    ]
  })
  const filterValue =
    result.filter && typeof result.filter === 'object' && !Array.isArray(result.filter)
      ? (result.filter as Record<string, unknown>)
      : {}
  return {
    previewOnly: true,
    previewTruncated: result.previewTruncated === true,
    matched: typeof result.matched === 'number' && Number.isFinite(result.matched) ? result.matched : candidates.length,
    inaccessible:
      typeof result.inaccessible === 'number' && Number.isFinite(result.inaccessible) ? result.inaccessible : 0,
    failedSamples: Array.isArray(result.failedSamples)
      ? result.failedSamples.flatMap((sample) => {
          if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return []
          const value = sample as Record<string, unknown>
          if (!Number.isInteger(value.imageId) || typeof value.path !== 'string' || typeof value.error !== 'string') {
            return []
          }
          return [{ imageId: Number(value.imageId), path: value.path, error: value.error }]
        })
      : [],
    candidates,
    force: result.force === true,
    filter: {
      minDuration: finiteNumberOrNull(filterValue.minDuration),
      maxDuration: finiteNumberOrNull(filterValue.maxDuration),
      includePaths: stringArray(filterValue.includePaths),
      excludePaths: stringArray(filterValue.excludePaths),
      statuses: statusArray(filterValue.statuses)
    }
  }
}

export function getVideoKeyframeRetryCountdown(job?: VideoKeyframeJobView | null, now = Date.now()) {
  if (job?.status !== 'PENDING' || !job.availableAt) return null
  const retryAt = new Date(job.availableAt).getTime()
  if (!Number.isFinite(retryAt)) return null
  // 向上取整可避免界面在真正到期前提前显示 0 秒。
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1_000))
  if (seconds === 0) return '即将自动重试'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const duration = [minutes > 0 ? `${minutes} 分` : '', remainingSeconds > 0 ? `${remainingSeconds} 秒` : '']
    .filter(Boolean)
    .join(' ')
  return `${duration}后自动重试`
}

export function formatVideoKeyframeError(error: string) {
  // 兼容旧工作进程写入的英文质量错误；新错误保持原文，避免掩盖诊断信息。
  const legacyQualityError = /^Only (\d+)\/(\d+) representative frames passed quality checks$/.exec(error)
  if (legacyQualityError) {
    return `仅 ${legacyQualityError[1]}/${legacyQualityError[2]} 张通过质量检查；可重试并按实际有效数量发布`
  }
  return error
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function statusArray(value: unknown): Array<'MISSING' | 'STALE' | 'FAILED'> {
  const supported = ['MISSING', 'STALE', 'FAILED'] as const
  if (!Array.isArray(value)) return [...supported]
  const statuses = supported.filter((status) => value.includes(status))
  return statuses.length > 0 ? statuses : [...supported]
}
