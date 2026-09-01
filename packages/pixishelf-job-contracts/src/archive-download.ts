import { z } from 'zod'
import { bigintStringSchema, isoDateTimeSchema } from './dtos.ts'

export const ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY = 'archive_media_concurrency' as const
export const ARCHIVE_MEDIA_CONCURRENCY_ADVISORY_LOCK_KEY = 'pixishelf:archive-media-concurrency' as const
export const ARCHIVE_MEDIA_CONCURRENCY_DEFAULT = 2 as const
export const ARCHIVE_MEDIA_CONCURRENCY_MIN = 1 as const
export const ARCHIVE_MEDIA_CONCURRENCY_MAX = 8 as const

export const archiveMediaConcurrencySchema = z.coerce
  .number()
  .int()
  .min(ARCHIVE_MEDIA_CONCURRENCY_MIN)
  .max(ARCHIVE_MEDIA_CONCURRENCY_MAX)

export const archiveTransferTelemetrySchema = z.object({
  version: z.literal(1),
  kind: z.literal('archive.transfer'),
  archiveImportId: z.string().min(1),
  downloadedBytes: bigintStringSchema,
  bytesPerSecond: z.number().int().nonnegative().safe(),
  activeDownloads: z.number().int().nonnegative(),
  concurrencyLimit: archiveMediaConcurrencySchema,
  completedItems: z.number().int().nonnegative(),
  failedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  sampledAt: isoDateTimeSchema
})

export type ArchiveTransferTelemetry = z.infer<typeof archiveTransferTelemetrySchema>

