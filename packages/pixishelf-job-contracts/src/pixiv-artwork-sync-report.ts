import { z } from 'zod'

export const PIXIV_ARTWORK_SYNC_REPORT_VERSION = 1 as const
export const PIXIV_ARTWORK_SYNC_REPORT_MAX_BYTES = 512_000
export const PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT = 2_000

export const pixivArtworkSyncReportFieldKeySchema = z.enum([
  'title',
  'description',
  'titleOverridden',
  'descriptionOverridden',
  'bookmarkCount',
  'isAiGenerated',
  'originalUrl',
  'size',
  'sourceDate',
  'sourceUrl',
  'thumbnailUrl',
  'xRestrict',
  'pixivAiType',
  'pixivType',
  'sanityLevel'
])

export type PixivArtworkSyncReportFieldKey = z.infer<typeof pixivArtworkSyncReportFieldKeySchema>

export const pixivArtworkSyncReportValueSchema = z
  .object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    truncated: z.boolean().optional(),
    originalLength: z.number().int().nonnegative().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
  })
  .strict()

export const pixivArtworkSyncReportSnapshotSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    path: z.string().min(1)
  })
  .strict()

export const pixivArtworkSyncReportSchema = z
  .object({
    schemaVersion: z.literal(PIXIV_ARTWORK_SYNC_REPORT_VERSION),
    jobId: z.string().min(1).max(128),
    artworkId: z.number().int().positive(),
    externalRefId: z.string().min(1).max(128),
    pixivArtworkId: z.string().regex(/^[1-9][0-9]*$/),
    checkedAt: z.iso.datetime(),
    refreshExisting: z.boolean(),
    status: z.enum(['SUCCESS', 'PARTIAL']),
    changeKind: z.enum(['UPDATED', 'SNAPSHOT_ONLY', 'UNCHANGED', 'PARTIAL']),
    fields: z.array(
      z
        .object({
          key: pixivArtworkSyncReportFieldKeySchema,
          before: pixivArtworkSyncReportValueSchema,
          after: pixivArtworkSyncReportValueSchema
        })
        .strict()
    ),
    tags: z
      .object({
        before: z.array(z.string()),
        after: z.array(z.string()),
        added: z.array(z.string()),
        removed: z.array(z.string())
      })
      .strict(),
    protectedFields: z.array(z.enum(['title', 'description'])),
    snapshots: z
      .object({
        before: pixivArtworkSyncReportSnapshotSchema.nullable(),
        after: pixivArtworkSyncReportSnapshotSchema,
        changed: z.boolean()
      })
      .strict()
  })
  .strict()

export type PixivArtworkSyncReport = z.infer<typeof pixivArtworkSyncReportSchema>
export type PixivArtworkSyncReportValue = z.infer<typeof pixivArtworkSyncReportValueSchema>
