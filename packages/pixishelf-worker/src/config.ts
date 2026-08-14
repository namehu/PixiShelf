import { z } from 'zod'

const positiveInteger = (fallback: number, minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback)

const workerConfigSchema = z.object({
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
  WORKER_ID: z.string().trim().min(1).max(120).optional(),
  WORKER_SERVICE_VERSION: z.string().trim().min(1).max(50).default('0.1.0'),
  WORKER_HEALTH_HOST: z.string().trim().min(1).default('0.0.0.0'),
  WORKER_HEALTH_PORT: positiveInteger(3011, 1, 65_535),
  WORKER_HEARTBEAT_INTERVAL_MS: positiveInteger(30_000, 1_000, 300_000),
  WORKER_PREFLIGHT_TIMEOUT_MS: positiveInteger(10_000, 100, 120_000)
})

export interface WorkerConfig {
  databaseUrl: string
  sourceMediaRoot: string
  derivedMediaRoot: string
  archiveRoot: string
  ffmpegPath: string
  ffprobePath: string
  workerId?: string
  serviceVersion: string
  healthHost: string
  healthPort: number
  heartbeatIntervalMs: number
  preflightTimeoutMs: number
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
    ...(parsed.WORKER_ID ? { workerId: parsed.WORKER_ID } : {}),
    serviceVersion: parsed.WORKER_SERVICE_VERSION,
    healthHost: parsed.WORKER_HEALTH_HOST,
    healthPort: parsed.WORKER_HEALTH_PORT,
    heartbeatIntervalMs: parsed.WORKER_HEARTBEAT_INTERVAL_MS,
    preflightTimeoutMs: parsed.WORKER_PREFLIGHT_TIMEOUT_MS
  }
}
