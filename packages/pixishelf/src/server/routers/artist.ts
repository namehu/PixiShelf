import { ArtistsGetSchema, ArtistCreateSchema, ArtistUpdateSchema } from '@/schemas/artist.dto'
import { authProcedure, router } from '@/server/trpc'
import { getArtists, createArtist, updateArtist, deleteArtist, getArtistById } from '@/services/artist-service'
import { z } from 'zod'

/**
 * 艺术家路由
 */
export const artistRouter = router({
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
   * 删除艺术家
   */
  delete: authProcedure.input(z.number()).mutation(async ({ input }) => {
    return await deleteArtist(input)
  })
})
