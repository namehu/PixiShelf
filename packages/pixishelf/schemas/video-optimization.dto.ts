import { z } from 'zod'
import { ESource } from '@/enums/e-source'

export const VIDEO_OPTIMIZATION_STATUSES = ['NONE', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'] as const
export const DEFAULT_VIDEO_OPTIMIZATION_STATUSES = ['NONE', 'FAILED', 'CANCELLED', 'SKIPPED'] as const
export const videoOptimizationStatusSchema = z.enum(VIDEO_OPTIMIZATION_STATUSES)
export const videoOptimizationFiltersSchema = z
  .object({
    artworkId: z.number().int().positive().optional(),
    title: z.string().trim().max(500).optional(),
    artistName: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    excludeTags: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    sources: z.array(z.enum(ESource)).max(4).default([]),
    statuses: z
      .array(videoOptimizationStatusSchema)
      .min(1)
      .max(6)
      .default([...DEFAULT_VIDEO_OPTIMIZATION_STATUSES])
  })
  .strict()
export const listVideoStreamingOptimizationCandidatesInputSchema = z
  .object({
    filters: videoOptimizationFiltersSchema.default(() => videoOptimizationFiltersSchema.parse({})),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20)
  })
  .strict()
export const previewVideoStreamingOptimizationBatchInputSchema = z
  .object({
    filters: videoOptimizationFiltersSchema.default(() => videoOptimizationFiltersSchema.parse({})),
    selection: z.discriminatedUnion('mode', [
      z
        .object({ mode: z.literal('SELECTED'), artworkIds: z.array(z.number().int().positive()).min(1).max(1000) })
        .strict(),
      z
        .object({
          mode: z.literal('ALL_MATCHING'),
          excludedArtworkIds: z.array(z.number().int().positive()).max(1000).default([])
        })
        .strict()
    ])
  })
  .strict()
export const videoOptimizationTargetSchema = z
  .object({
    imageId: z.number().int().positive(),
    artworkId: z.number().int().positive(),
    latestJobId: z.string().min(1).max(128).nullable(),
    status: videoOptimizationStatusSchema.exclude(['ACTIVE'])
  })
  .strict()
export const submitVideoStreamingOptimizationBatchInputSchema = z
  .object({
    targets: z.array(videoOptimizationTargetSchema).min(1).max(1000)
  })
  .strict()

export type VideoOptimizationFilters = z.input<typeof videoOptimizationFiltersSchema>
export type VideoOptimizationStatus = z.output<typeof videoOptimizationStatusSchema>
export type VideoOptimizationTarget = z.output<typeof videoOptimizationTargetSchema>
export type ListVideoStreamingOptimizationCandidatesInput = z.input<
  typeof listVideoStreamingOptimizationCandidatesInputSchema
>
export type PreviewVideoStreamingOptimizationBatchInput = z.input<
  typeof previewVideoStreamingOptimizationBatchInputSchema
>
export type SubmitVideoStreamingOptimizationBatchInput = z.input<
  typeof submitVideoStreamingOptimizationBatchInputSchema
>
