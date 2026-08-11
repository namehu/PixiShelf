export interface VideoOptimizationJobView {
  id: string
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
  targetImageId?: number | null
  targetPath?: string | null
  mode?: string | null
  queuePosition?: number | null
  createdAt?: Date | string
  updatedAt?: Date | string
  startedAt?: Date | string | null
  finishedAt?: Date | string | null
  attempt?: number
}

export const ACTIVE_VIDEO_OPTIMIZATION_STATUSES = ['PENDING', 'RUNNING', 'CANCELLING']

export function isActiveVideoOptimization(job?: VideoOptimizationJobView | null) {
  return Boolean(job && ACTIVE_VIDEO_OPTIMIZATION_STATUSES.includes(job.status))
}
