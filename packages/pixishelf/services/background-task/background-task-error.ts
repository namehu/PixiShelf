export type BackgroundTaskErrorCode =
  | 'JOB_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'CONCURRENT_MODIFICATION'
  | 'IDEMPOTENCY_CONFLICT'

export class BackgroundTaskError extends Error {
  constructor(
    readonly code: BackgroundTaskErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'BackgroundTaskError'
  }
}
