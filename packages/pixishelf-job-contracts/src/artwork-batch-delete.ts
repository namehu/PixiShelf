import { artworkDedupMemberDtoSchema } from './artwork-dedup-maintenance.ts'
import { z } from 'zod'
import { ArtworkDeletePreviewSchema, ArtworkDeleteReportSchema } from './artwork-delete.ts'

const account = { expectedUserId: z.string().min(1) }
export const artworkBatchDeletePreviewInputSchema = z.object({
  ...account,
  artworkIds: z.array(z.number().int().positive()).min(1).max(1000),
  idempotencyKey: z.string().uuid()
})
export const artworkBatchDeleteIdInputSchema = z.object({ ...account, jobId: z.string().uuid() })
export const artworkBatchDeleteSubmitInputSchema = artworkBatchDeleteIdInputSchema.extend({
  items: z
    .array(
      z.object({
        artworkId: z.number().int().positive(),
        selectedPaths: z.array(z.string().min(1).max(4096)).max(100_000)
      })
    )
    .min(1)
    .max(1000)
})
export const artworkBatchDeletePayloadSchema = z.object({
  items: z
    .array(
      z.object({
        artworkId: z.number().int().positive(),
        operationId: z.string().uuid(),
        selectedPaths: z.array(z.string()),
        preview: ArtworkDeletePreviewSchema
      })
    )
    .min(1)
    .max(1000),
  confirmed: z.boolean().default(false),
  stopAfterCurrent: z.boolean().default(false),
  round: z.number().int().nonnegative().default(0),
  origin: z
    .object({
      runId: z.string(),
      groupIds: z.array(z.string()),
      keeperArtworkIds: z.array(z.number().int()),
      losses: z
        .array(
          z.object({
            artworkId: z.number().int(),
            unmatched: z.string(),
            unchecked: z.string().nullable(),
            member: artworkDedupMemberDtoSchema
          })
        )
        .optional()
    })
    .nullable()
    .default(null)
})
export type ArtworkBatchDeletePayload = z.infer<typeof artworkBatchDeletePayloadSchema>
export const artworkBatchDeleteResultSchema = z.object({
  items: z.array(
    z.object({
      artworkId: z.number().int(),
      round: z.number().int(),
      status: z.enum(['PROCESSING', 'DELETED', 'TRASH_SUBMITTED', 'FAILED']),
      report: ArtworkDeleteReportSchema.nullable(),
      message: z.string()
    })
  )
})
export type ArtworkBatchDeleteResult = z.infer<typeof artworkBatchDeleteResultSchema>
export const artworkDedupDeleteSelectionInputSchema = z.object({
  ...account,
  runId: z.string(),
  expectedRunVersion: z.number().int(),
  expectedReviewRevision: z.number().int(),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('EXPLICIT'), groupIds: z.array(z.string()).max(1000) }),
    z.object({
      kind: z.literal('ALL_RECOMMENDED'),
      excludedGroupIds: z.array(z.string()).max(1000).default([]),
      manualGroupIds: z.array(z.string()).max(1000).default([])
    })
  ])
})
export const artworkDedupDeletePreviewInputSchema = artworkDedupDeleteSelectionInputSchema.extend({
  idempotencyKey: z.string().uuid()
})

export const artworkBatchDeletePublicPayloadSchema = z.object({
  runId: z.string().nullable(),
  artworks: z.number().int().nonnegative(),
  confirmed: z.boolean(),
  stopAfterCurrent: z.boolean()
})
