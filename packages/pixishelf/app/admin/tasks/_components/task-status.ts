import type { JobStatus } from '@pixishelf/job-contracts'

export const ACTIVE_TASK_STATUSES: readonly JobStatus[] = [
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'CANCELLING'
]

export const TERMINAL_TASK_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED']
export const EXECUTING_TASK_STATUSES: readonly JobStatus[] = ['RUNNING', 'PAUSING', 'CANCELLING']

const TASK_STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: '等待执行',
  RETRY_WAIT: '等待重试',
  RUNNING: '正在执行',
  PAUSING: '正在暂停',
  PAUSED: '已暂停',
  CANCELLING: '正在取消',
  COMPLETED: '已完成',
  FAILED: '执行失败',
  CANCELLED: '已取消',
  SKIPPED: '已跳过'
}

export function formatTaskStatus(status: JobStatus | null | undefined) {
  return status ? TASK_STATUS_LABELS[status] : '状态未知'
}
