import { z } from 'zod'

const positiveId = z.number().int().positive()
const observedAt = z.string().datetime({ offset: true })

export const ReadingContextInputSchema = z.object({
  artworkId: positiveId,
  expectedUserId: z.string().min(1)
})

export const ReadingReportInputSchema = ReadingContextInputSchema.extend({
  mediaRevision: positiveId,
  events: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('VIEW'), mediaId: positiveId, observedAt }),
        z.object({ type: z.literal('HEARTBEAT'), mediaId: positiveId, observedAt })
      ])
    )
    .min(1)
    .max(100)
})

export const ReadingSummariesInputSchema = z.object({
  expectedUserId: z.string().min(1),
  artworkIds: z.array(positiveId).max(100)
})

export const ReadingHistoryInputSchema = z.object({
  expectedUserId: z.string().min(1),
  pageSize: z.number().int().min(1).max(100).default(24),
  cursor: z
    .object({ lastViewedAt: observedAt, artworkId: positiveId })
    .optional()
})

export type ReadingContextInput = z.infer<typeof ReadingContextInputSchema>
export type ReadingReportInputValidated = z.infer<typeof ReadingReportInputSchema>
export type ReadingHistoryInput = z.infer<typeof ReadingHistoryInputSchema>
