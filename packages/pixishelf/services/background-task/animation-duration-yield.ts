interface LegacyAnimationDurationYield {
  type: string
  status: string
  stage: string | null
  errorCode: string | null
  error: string | null
}

// Older workers persisted a normal batch yield as a task error. Match the
// exact legacy marker so a real RESOURCE_BUSY failure remains visible.
export function isLegacyAnimationDurationYield(job: LegacyAnimationDurationYield): boolean {
  return job.type === 'ANIMATION_DURATION_PROBE' &&
    ['RETRY_WAIT', 'PAUSED', 'PENDING', 'CANCELLED'].includes(job.status) &&
    ['YIELDING', 'WAITING_RETRY', 'WAITING_SOURCE_WRITE'].includes(job.stage ?? '') &&
    job.errorCode === 'RESOURCE_BUSY' &&
    job.error === 'Animation duration probe yielded after a durable batch'
}
