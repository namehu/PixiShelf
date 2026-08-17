const MAX_PUBLIC_SUMMARY_BYTES = 512
const MAX_ERROR_CODE_LENGTH = 80

const PUBLIC_MESSAGES: Record<string, string> = {
  ACTION_REQUIRED: 'Migration requires administrator review',
  ARTWORK_DELETED: 'Artwork was deleted before migration planning',
  ARTWORK_NOT_FOUND: 'Artwork no longer exists',
  CANDIDATE_LIMIT_EXCEEDED: 'Artwork exceeds the configured migration safety limit',
  CANCELLED: 'Migration was cancelled by an administrator',
  DATABASE_PATH_CONFLICT: 'Artwork metadata changed during migration',
  FILESYSTEM_PERMISSION_DENIED: 'Migration cannot access a required file',
  FILESYSTEM_RECOVERY_FAILED: 'Migration filesystem checkpoint could not be verified',
  INCOMPLETE_ARTWORK: 'Artwork is missing required migration metadata',
  INTERNAL_ERROR: 'Migration failed because of an internal error',
  INVALID_ARTWORK: 'Artwork is not eligible for migration',
  INVALID_PATH_SEGMENT: 'Artwork contains an unsafe migration path segment',
  PATH_OUTSIDE_ALLOWED_ROOT: 'Migration path is outside the configured storage root',
  SOURCE_CHANGED: 'Migration source changed during processing',
  SOURCE_CHANGED_AFTER_PUBLISH: 'Migration source changed after publication',
  SOURCE_NOT_FOUND: 'Migration source file was not found',
  STAGING_CONFLICT: 'Migration staging content conflicts with its checkpoint',
  TARGET_CONFLICT: 'Migration target conflicts with existing content',
  EACCES: 'Migration cannot access a required file',
  ENOENT: 'Migration source file was not found',
  EPERM: 'Migration cannot access a required file'
}

export function migrationPublicSummary(code: string): string {
  return truncateUtf8(PUBLIC_MESSAGES[code] ?? PUBLIC_MESSAGES.INTERNAL_ERROR!, MAX_PUBLIC_SUMMARY_BYTES)
}

export function migrationPublicErrorCode(code: string): string {
  const normalized = code
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, MAX_ERROR_CODE_LENGTH)
  return normalized || 'INTERNAL_ERROR'
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value
  let end = value.length
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maximumBytes - 3) end -= 1
  return `${value.slice(0, end)}...`
}
