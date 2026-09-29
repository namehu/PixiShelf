import { ArtistsGetSchema, ArtistCreateSchema, ArtistUpdateSchema } from '@/schemas/artist.dto'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
  adoptPixivSourceName,
  createArtist,
  deleteArtist,
  getArtistById,
  getArtists,
  updateArtist
} from '@/services/artist-service'
import {
  cancelPixivArtistEnrichment,
  getPixivArtistEnrichmentSummary,
  retryPixivArtistEnrichment,
  startPixivArtistEnrichment
} from '@/services/pixiv-artist-enrichment-service'
import { PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
import { z } from 'zod'
import {
  previewArtistMerge,
  submitArtistMerge,
  getArtistMerge,
  listArtistMerges
} from '@/services/artist-merge-service'

/**
 * 艺术家路由
 */
export const artistRouter = router({
  previewMerge: adminProcedure
    .input(
      z.object({ sourceArtistId: z.number().int().positive(), targetArtistId: z.number().int().positive() }).strict()
    )
    .mutation(({ input, ctx }) => previewArtistMerge(ctx.userId, input.sourceArtistId, input.targetArtistId)),
  submitMerge: adminProcedure
    .input(z.object({ previewId: z.string().min(1).max(128), fingerprint: z.string().length(64) }).strict())
    .mutation(({ input, ctx }) => submitArtistMerge(ctx.userId, input.previewId, input.fingerprint)),
  getMerge: adminProcedure
    .input(z.object({ mergeId: z.string().min(1).max(128) }).strict())
    .query(({ input }) => getArtistMerge(input.mergeId)),
  listMerges: adminProcedure.query(() => listArtistMerges()),
  /**
   * 获取艺术家详情
   */
  getById: authProcedure.input(z.number()).query(async ({ input }) => {
    return await getArtistById(input)
  }),

  /**
   * 获取艺术家列表
   */
  queryPage: authProcedure.input(ArtistsGetSchema).query(async ({ input }) => {
    return await getArtists(input)
  }),

  /**
   * 创建艺术家
   */
  create: authProcedure.input(ArtistCreateSchema).mutation(async ({ input }) => {
    return await createArtist(input)
  }),

  /**
   * 更新艺术家
   */
  update: authProcedure.input(ArtistUpdateSchema).mutation(async ({ input }) => {
    return await updateArtist(input.id, input.data)
  }),

  /**
   * 设置艺术家星标状态
   */
  setStar: authProcedure.input(z.object({ id: z.number(), isStarred: z.boolean() })).mutation(async ({ input }) => {
    return await updateArtist(input.id, { isStarred: input.isStarred })
  }),

  /**
   * 删除艺术家
   */
  delete: authProcedure.input(z.number()).mutation(async ({ input }) => {
    return await deleteArtist(input)
  }),

  pixivEnrichmentSummary: adminProcedure.query(() => getPixivArtistEnrichmentSummary()),

  startPixivEnrichment: adminProcedure
    .input(
      z.object({
        artistIds: z.array(z.number().int().positive()).min(1).max(PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT).optional(),
        refreshExisting: z.boolean().default(false)
      })
    )
    .mutation(({ input, ctx }) => startPixivArtistEnrichment(ctx.userId, input.artistIds, input.refreshExisting)),

  cancelPixivEnrichment: adminProcedure
    .input(z.object({ jobId: z.string().min(1).optional() }).optional())
    .mutation(({ input }) => cancelPixivArtistEnrichment(input?.jobId)),

  retryPixivEnrichment: adminProcedure
    .input(z.object({ artistId: z.number().int().positive() }))
    .mutation(({ input, ctx }) => retryPixivArtistEnrichment(input.artistId, ctx.userId)),

  adoptPixivSourceName: adminProcedure
    .input(z.object({ artistId: z.number().int().positive() }))
    .mutation(({ input }) => adoptPixivSourceName(input.artistId))
})
