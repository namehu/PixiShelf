import { z } from 'zod'

export const DISCOVERY_BATCH_JOB_TYPE = 'ARCHIVE_DISCOVERY_BATCH_SCAN' as const
export const discoveryBatchPayloadSchema = z
  .object({
    sources: z
      .array(
        z
          .object({ id: z.string().min(1).max(128), name: z.string().max(180), skipReason: z.string().optional() })
          .strict()
      )
      .min(1)
  })
  .strict()
export type DiscoveryBatchPayload = z.infer<typeof discoveryBatchPayloadSchema>

export const discoveryBatchCheckpointSchema = z
  .object({
    index: z.number().int().nonnegative(),
    phase: z.enum(['LATEST', 'HISTORY']),
    round: z.number().int().nonnegative(),
    childJobId: z.string().nullable(),
    control: z.enum(['RUN', 'PAUSE', 'CANCEL']),
    results: z.array(
      z.object({
        sourceId: z.string(),
        status: z.enum(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED']),
        message: z.string()
      })
    )
  })
  .strict()
export type DiscoveryBatchCheckpoint = z.infer<typeof discoveryBatchCheckpointSchema>
export function initialDiscoveryBatchCheckpoint(): DiscoveryBatchCheckpoint {
  return { index: 0, phase: 'LATEST', round: 0, childJobId: null, control: 'RUN', results: [] }
}

export function parseDiscoveryBatchCheckpoint(value: unknown): DiscoveryBatchCheckpoint {
  return value == null ? initialDiscoveryBatchCheckpoint() : discoveryBatchCheckpointSchema.parse(value)
}
