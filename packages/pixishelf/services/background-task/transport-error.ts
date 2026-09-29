import { BackgroundTaskError } from './background-task-error'

export interface BackgroundTaskTransportError {
  status: 400 | 404 | 409
  message: string
  trpcCode: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT'
}

export function classifyBackgroundTaskTransportError(error: unknown): BackgroundTaskTransportError | null {
  if (error instanceof BackgroundTaskError) {
    if (error.code === 'JOB_NOT_FOUND') return { status: 404, message: error.message, trpcCode: 'NOT_FOUND' }
    if (error.code === 'PRECONDITION_FAILED') return { status: 400, message: error.message, trpcCode: 'BAD_REQUEST' }
    return { status: 409, message: error.message, trpcCode: 'CONFLICT' }
  }
  const code = errorCode(error)
  if (
    code === 'CONFIGURATION_INVALID' ||
    code === 'INPUT_SNAPSHOT_INVALID' ||
    code === 'PATH_OUTSIDE_SCAN_ROOT' ||
    code === 'SYMLINK_NOT_ALLOWED' ||
    code === 'SOURCE_NOT_FOUND' ||
    code === 'SOURCE_NOT_READABLE' ||
    code === 'METADATA_INVALID' ||
    code === 'MEDIA_NOT_FOUND'
  ) {
    return { status: 400, message: errorMessage(error), trpcCode: 'BAD_REQUEST' }
  }
  if (code === 'STATE_CONFLICT') {
    return { status: 409, message: errorMessage(error), trpcCode: 'CONFLICT' }
  }
  return null
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '后台任务请求失败'
}
