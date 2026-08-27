
import { router, publicProcedure, authProcedure, adminProcedure } from '@/server/trpc'
import { PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT } from '@pixishelf/job-contracts'
import { z } from 'zod'
import * as seriesService from '@/services/series-service'
import {
  cancelPixivSeriesReconciliation,
  getPixivSeriesReconciliationSummary,
  retryPixivSeriesReconciliation,
  startPixivSeriesReconciliation
} from '@/services/pixiv-series-reconciliation-service'

export const seriesRouter = router({
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().default(20),
      query: z.string().optional(),
      source: z.enum(['ALL', 'PIXIV', 'LOCAL']).default('ALL'),
      pixivStatus: z.enum(['UNCHECKED', 'SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED']).optional()
    }))
    .query(async ({ input }) => {
      return seriesService.getSeriesList(input)
    }),

  get: publicProcedure
    .input(z.number())
    .query(async ({ input }) => {
      return seriesService.getSeriesDetail(input)
    }),

  create: authProcedure
    .input(z.object({
      title: z.string(),
      description: z.string().optional(),
      coverImageUrl: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      return seriesService.createSeries(input)
    }),

  update: authProcedure
    .input(z.object({
      id: z.number(),
      data: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        coverImageUrl: z.string().optional()
      })
    }))
    .mutation(async ({ input }) => {
      return seriesService.updateSeries(input.id, input.data)
    }),

  delete: authProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      return seriesService.deleteSeries(input)
    }),

  addArtwork: authProcedure
    .input(z.object({
      seriesId: z.number(),
      artworkId: z.number()
    }))
    .mutation(async ({ input }) => {
      return seriesService.addArtworkToSeries(input.seriesId, input.artworkId)
    }),

  removeArtwork: authProcedure
    .input(z.object({
      seriesId: z.number(),
      artworkId: z.number()
    }))
    .mutation(async ({ input }) => {
      return seriesService.removeArtworkFromSeries(input.seriesId, input.artworkId)
    }),

  reorderArtworks: authProcedure
    .input(z.object({
      seriesId: z.number(),
      artworkIds: z.array(z.number())
    }))
    .mutation(async ({ input }) => {
      return seriesService.reorderArtworks(input.seriesId, input.artworkIds)
    }),

  pixivReconciliationSummary: adminProcedure.query(() => getPixivSeriesReconciliationSummary()),

  startPixivReconciliation: adminProcedure
    .input(
      z.object({
        artworkIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT)
          .optional(),
        refreshExisting: z.boolean().default(false)
      })
    )
    .mutation(({ input, ctx }) =>
      startPixivSeriesReconciliation(ctx.userId, input.artworkIds, input.refreshExisting)
    ),

  retryPixivReconciliation: adminProcedure
    .input(z.object({ artworkId: z.number().int().positive() }))
    .mutation(({ input, ctx }) => retryPixivSeriesReconciliation(input.artworkId, ctx.userId)),

  cancelPixivReconciliation: adminProcedure
    .input(z.object({ jobId: z.string().min(1).optional() }).optional())
    .mutation(({ input }) => cancelPixivSeriesReconciliation(input?.jobId))
})
