export type ArchiveErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROVIDER'
  | 'SSRF_BLOCKED'
  | 'REMOTE_NOT_FOUND'
  | 'REMOTE_RATE_LIMITED'
  | 'REMOTE_QUOTA_EXCEEDED'
  | 'REMOTE_FORBIDDEN'
  | 'REMOTE_RESPONSE_INVALID'
  | 'ORIGINAL_UNAVAILABLE'
  | 'DOWNLOAD_TOO_LARGE'
  | 'MEDIA_INVALID'
  | 'STORAGE_FULL'
  | 'CANCELLED'
  | 'PAUSED'
  | 'LEASE_LOST'
  | 'INTERNAL'

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode
  readonly recoverable: boolean
  readonly pause: boolean
  readonly retryAfterMs: number | null
  readonly decisionCode: string | null

  constructor(
    code: ArchiveErrorCode,
    message: string,
    options: {
      cause?: unknown
      recoverable?: boolean
      pause?: boolean
      retryAfterMs?: number | null
      decisionCode?: string | null
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ArchiveError'
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.pause = options.pause ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
    this.decisionCode = options.decisionCode ?? null
  }
}

export function toArchiveError(error: unknown): ArchiveError {
  if (error instanceof ArchiveError) return error
  const nodeError = error as NodeJS.ErrnoException
  if (nodeError?.code === 'ENOSPC') {
    return new ArchiveError('STORAGE_FULL', '归档磁盘空间不足；释放空间后可以重试', {
      cause: error,
      recoverable: true
    })
  }
  return new ArchiveError('INTERNAL', error instanceof Error ? error.message : '未知归档错误', {
    cause: error,
    recoverable: true
  })
}
