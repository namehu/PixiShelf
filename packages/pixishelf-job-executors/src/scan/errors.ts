export type ScanExecutorErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'INPUT_SNAPSHOT_INVALID'
  | 'PATH_OUTSIDE_SCAN_ROOT'
  | 'SYMLINK_NOT_ALLOWED'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_READABLE'
  | 'METADATA_INVALID'
  | 'MEDIA_NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'EMPTY_FULL_RECONCILE'
  | 'FULL_SWEEP_LIMIT_EXCEEDED'

export class ScanExecutorError extends Error {
  constructor(
    readonly code: ScanExecutorErrorCode,
    message: string,
    readonly recoverable = false
  ) {
    super(message)
    this.name = 'ScanExecutorError'
  }
}

export function scanErrorMessage(error: unknown): string {
  if (error instanceof ScanExecutorError) return error.message
  if (error instanceof Error) return error.message
  return 'Unknown scan executor error'
}
