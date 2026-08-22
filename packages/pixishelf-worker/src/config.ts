import { z } from 'zod'
import { DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES } from '@pixishelf/job-executors'

const positiveInteger = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback)

const environmentBoolean = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1')

const excludedRootDirectoryList = z
  .string()
  .default(DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES.join(','))
  .transform((value, context) => {
    const directories = [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ]
    const invalid =
      directories.length > 100 ||
      directories.some(
        (item) =>
          item.length > 255 ||
          item === '.' ||
          item === '..' ||
          item.includes('/') ||
          item.includes('\\') ||
          item.includes('\0')
      )
    if (invalid) {
      context.addIssue({ code: 'custom', message: 'Excluded scan root directories must be safe directory names' })
      return z.NEVER
    }
    return directories
  })

const workerConfigSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'DATABASE_URL must use PostgreSQL'
      }),
    SOURCE_MEDIA_ROOT: z.string().trim().min(1),
    DERIVED_MEDIA_ROOT: z.string().trim().min(1),
    ARCHIVE_ROOT: z.string().trim().min(1),
    FFMPEG_PATH: z.string().trim().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().trim().min(1).default('ffprobe'),
    KEYFRAME_FFMPEG_THREADS: positiveInteger(2, 1, 8),
    ARCHIVE_MAX_MEDIA_BYTES: positiveInteger(512 * 1024 * 1024, 1, 2_147_483_647),
    SCAN_DISCOVERY_MAX_ENTRIES: positiveInteger(10_000_000, 1, 100_000_000),
    SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES: excludedRootDirectoryList,
    WORKER_ID: z.string().trim().min(1).max(120).optional(),
    WORKER_SERVICE_VERSION: z.string().trim().min(1).max(50).default('0.1.0'),
    WORKER_HEALTH_HOST: z.string().trim().min(1).default('0.0.0.0'),
    WORKER_HEALTH_PORT: positiveInteger(3011, 1, 65_535),
    WORKER_HEARTBEAT_INTERVAL_MS: positiveInteger(30_000, 1_000, 300_000),
    WORKER_PREFLIGHT_TIMEOUT_MS: positiveInteger(10_000, 100, 120_000),
    WORKER_DISPATCH_ENABLED: environmentBoolean,
    WORKER_DISPATCH_POLL_INTERVAL_MS: positiveInteger(1_000, 100, 60_000),
    WORKER_JOB_LEASE_DURATION_MS: positiveInteger(60_000, 10_000, 600_000),
    WORKER_JOB_HEARTBEAT_INTERVAL_MS: positiveInteger(20_000, 1_000, 300_000),
    WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS: positiveInteger(5_000, 100, 60_000),
    WORKER_QUEUE_TRANSACTION_TIMEOUT_MS: positiveInteger(30_000, 1_000, 300_000),
    WORKER_DISPATCH_DRAIN_GRACE_MS: positiveInteger(30_000, 1_000, 300_000)
  })
  .superRefine((value, context) => {
    if (value.WORKER_JOB_HEARTBEAT_INTERVAL_MS * 2 >= value.WORKER_JOB_LEASE_DURATION_MS) {
      context.addIssue({
        code: 'custom',
        path: ['WORKER_JOB_HEARTBEAT_INTERVAL_MS'],
        message: 'Job heartbeat interval must be less than half of the job lease duration'
      })
    }
    if (value.WORKER_QUEUE_TRANSACTION_TIMEOUT_MS >= value.WORKER_JOB_LEASE_DURATION_MS) {
      context.addIssue({
        code: 'custom',
        path: ['WORKER_QUEUE_TRANSACTION_TIMEOUT_MS'],
        message: 'Queue transaction timeout must be less than the job lease duration'
      })
    }
  })

export interface WorkerConfig {
  databaseUrl: string
  sourceMediaRoot: string
  derivedMediaRoot: string
  archiveRoot: string
  ffmpegPath: string
  ffprobePath: string
  keyframeFfmpegThreads: number
  archiveMaxMediaBytes: number
  scanDiscoveryMaxEntries: number
  scanDiscoveryExcludedRootDirectories: readonly string[]
  workerId?: string
  serviceVersion: string
  healthHost: string
  healthPort: number
  heartbeatIntervalMs: number
  preflightTimeoutMs: number
  dispatchEnabled: boolean
  dispatchPollIntervalMs: number
  jobLeaseDurationMs: number
  jobHeartbeatIntervalMs: number
  queueTransactionMaxWaitMs: number
  queueTransactionTimeoutMs: number
  dispatchDrainGraceMs: number
}

export function createDefaultWorkerId(host: string, processId: number, instanceId: string) {
  const suffix = `:${processId}:${instanceId}`
  const hostnameBudget = Math.max(1, 120 - suffix.length)
  return `${host.slice(0, hostnameBudget)}${suffix}`.slice(0, 120)
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = workerConfigSchema.parse({
    ...environment,
    SOURCE_MEDIA_ROOT: environment.SOURCE_MEDIA_ROOT ?? environment.SCAN_PATH,
    DERIVED_MEDIA_ROOT: environment.DERIVED_MEDIA_ROOT ?? environment.DERIVED_MEDIA_STORAGE_PATH,
    ARCHIVE_ROOT: environment.ARCHIVE_ROOT ?? environment.ARCHIVE_STORAGE_PATH
  })

  return {
    databaseUrl: parsed.DATABASE_URL,
    sourceMediaRoot: parsed.SOURCE_MEDIA_ROOT,
    derivedMediaRoot: parsed.DERIVED_MEDIA_ROOT,
    archiveRoot: parsed.ARCHIVE_ROOT,
    ffmpegPath: parsed.FFMPEG_PATH,
    ffprobePath: parsed.FFPROBE_PATH,
    keyframeFfmpegThreads: parsed.KEYFRAME_FFMPEG_THREADS,
    archiveMaxMediaBytes: parsed.ARCHIVE_MAX_MEDIA_BYTES,
    scanDiscoveryMaxEntries: parsed.SCAN_DISCOVERY_MAX_ENTRIES,
    scanDiscoveryExcludedRootDirectories: parsed.SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES,
    ...(parsed.WORKER_ID ? { workerId: parsed.WORKER_ID } : {}),
    serviceVersion: parsed.WORKER_SERVICE_VERSION,
    healthHost: parsed.WORKER_HEALTH_HOST,
    healthPort: parsed.WORKER_HEALTH_PORT,
    heartbeatIntervalMs: parsed.WORKER_HEARTBEAT_INTERVAL_MS,
    preflightTimeoutMs: parsed.WORKER_PREFLIGHT_TIMEOUT_MS,
    dispatchEnabled: parsed.WORKER_DISPATCH_ENABLED,
    dispatchPollIntervalMs: parsed.WORKER_DISPATCH_POLL_INTERVAL_MS,
    jobLeaseDurationMs: parsed.WORKER_JOB_LEASE_DURATION_MS,
    jobHeartbeatIntervalMs: parsed.WORKER_JOB_HEARTBEAT_INTERVAL_MS,
    queueTransactionMaxWaitMs: parsed.WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS,
    queueTransactionTimeoutMs: parsed.WORKER_QUEUE_TRANSACTION_TIMEOUT_MS,
    dispatchDrainGraceMs: parsed.WORKER_DISPATCH_DRAIN_GRACE_MS
  }
}
