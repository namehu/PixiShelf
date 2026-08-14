import { z } from 'zod'

export const JOB_ERROR_CODE_VALUES = [
  'INVALID_PAYLOAD',
  'UNSUPPORTED_DEFINITION_VERSION',
  'DATABASE_SCHEMA_MISMATCH',
  'DATABASE_UNAVAILABLE',
  'LEASE_LOST',
  'RESOURCE_BUSY',
  'PRECONDITION_FAILED',
  'SOURCE_NOT_FOUND',
  'PATH_OUTSIDE_ALLOWED_ROOT',
  'FILESYSTEM_PERMISSION_DENIED',
  'EXTERNAL_PROCESS_FAILED',
  'EXTERNAL_PROCESS_TIMEOUT',
  'CANCELLED_BY_USER',
  'WORKER_SHUTDOWN',
  'INTERNAL_ERROR'
] as const

export const jobErrorCodeSchema = z.enum(JOB_ERROR_CODE_VALUES)
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>

export const JOB_ERROR_CODES = Object.freeze(
  Object.fromEntries(JOB_ERROR_CODE_VALUES.map((value) => [value, value])) as { [K in JobErrorCode]: K }
)
