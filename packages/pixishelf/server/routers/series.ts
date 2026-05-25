
import { router, publicProcedure, authProcedure } from '@/server/trpc'
import { z } from 'zod'
import * as seriesService from '@/services/series-service'

export const seriesRouter = router({
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().default(20),
      query: z.string().optional()
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
    })
})
