import { z } from 'zod'

const aggregateCountSchema = z.number().int().nonnegative().safe()

export const ANIMATION_SCAN_PROGRESS_STAGE_VALUES = ['INITIALIZING', 'SCANNING', 'COMPLETED'] as const
export const animationScanProgressStageSchema = z.enum(ANIMATION_SCAN_PROGRESS_STAGE_VALUES)

/**
 * Durable, privacy-safe progress for the animation detector. Keep this payload
 * aggregate-only because it is copied into the authenticated live event stream.
 */
export const animationScanProgressDataSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('animation-scan'),
    stage: animationScanProgressStageSchema,
    initializedItems: aggregateCountSchema,
    totalItems: aggregateCountSchema,
    attemptedItems: aggregateCountSchema,
    succeededItems: aggregateCountSchema,
    failedItems: aggregateCountSchema,
    animatedItems: aggregateCountSchema,
    staticItems: aggregateCountSchema,
    remainingItems: aggregateCountSchema,
    activeProbes: aggregateCountSchema,
    concurrencyLimit: z.number().int().min(1).max(8),
    itemsPerSecond: z.number().nonnegative().finite(),
    etaSeconds: aggregateCountSchema.nullable(),
    sampledAt: z.string().datetime({ offset: true })
  })
  .strict()

/** A plain union allows a future schema to reuse a kind with a newer version literal. */
export const jobProgressDataSchema = z.union([animationScanProgressDataSchema])

export type AnimationScanProgressStage = z.infer<typeof animationScanProgressStageSchema>
export type AnimationScanProgressData = z.infer<typeof animationScanProgressDataSchema>
export type JobProgressData = z.infer<typeof jobProgressDataSchema>
