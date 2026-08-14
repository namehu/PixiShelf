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
  | 'WORKER_STOPPED'
  | 'STATE_CONFLICT'
  | 'PARTIAL_FAILURE'
  | 'INTERNAL'

export type ArchiveErrorStage =
  | 'SOURCE_PAGE'
  | 'PROXY_CONNECT'
  | 'TLS_HANDSHAKE'
  | 'MEDIA_REQUEST'
  | 'MEDIA_STREAM'
  | 'MEDIA_VALIDATION'
  | 'STORAGE'

export class ArchiveExecutorError extends Error {
  readonly code: ArchiveErrorCode
  readonly recoverable: boolean
  readonly pause: boolean
  readonly retryAfterMs: number | null
  readonly decisionCode: string | null
  readonly stage: ArchiveErrorStage | null
  readonly remoteHost: string | null

  constructor(
    code: ArchiveErrorCode,
    message: string,
    options: {
      cause?: unknown
      recoverable?: boolean
      pause?: boolean
      retryAfterMs?: number | null
      decisionCode?: string | null
      stage?: ArchiveErrorStage | null
      remoteHost?: string | null
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ArchiveExecutorError'
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.pause = options.pause ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
    this.decisionCode = options.decisionCode ?? null
    this.stage = options.stage ?? null
    this.remoteHost = sanitizeRemoteHost(options.remoteHost)
  }
}

export function toArchiveExecutorError(error: unknown): ArchiveExecutorError {
  if (error instanceof ArchiveExecutorError) return error
  const nodeError = error as NodeJS.ErrnoException
  if (nodeError?.code === 'ENOSPC') {
    return new ArchiveExecutorError('STORAGE_FULL', 'Archive storage is full', {
      cause: error,
      recoverable: true,
      stage: 'STORAGE'
    })
  }
  if (isAbortError(error)) {
    return new ArchiveExecutorError('CANCELLED', 'Archive execution was cancelled', {
      cause: error,
      recoverable: true
    })
  }
  return new ArchiveExecutorError('INTERNAL', error instanceof Error ? error.message : 'Unknown archive failure', {
    cause: error,
    recoverable: true
  })
}

export function withArchiveExecutorErrorContext(
  error: unknown,
  context: { stage?: ArchiveErrorStage; remoteHost?: string | null }
): ArchiveExecutorError {
  const classified = toArchiveExecutorError(error)
  return new ArchiveExecutorError(classified.code, classified.message, {
    cause: classified,
    recoverable: classified.recoverable,
    pause: classified.pause,
    retryAfterMs: classified.retryAfterMs,
    decisionCode: classified.decisionCode,
    stage: classified.stage ?? context.stage ?? null,
    remoteHost: classified.remoteHost ?? context.remoteHost ?? null
  })
}

// Preserve the established archive-domain vocabulary while keeping the class name explicit at package boundaries.
export { ArchiveExecutorError as ArchiveError }
export const toArchiveError = toArchiveExecutorError
export const withArchiveErrorContext = withArchiveExecutorErrorContext

function sanitizeRemoteHost(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed.length > 300 || /[\s/@?#\\]/.test(trimmed)) return null
  return trimmed
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
