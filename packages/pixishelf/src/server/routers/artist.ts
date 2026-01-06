import { ArtistsGetSchema } from '@/schemas/artist.dto'
import { authProcedure, router } from '@/server/trpc'
import { getArtists } from '@/services/artist-service'

export const artistRouter = router({
  /**
   * 获取艺术家列表
   */
  queryPage: authProcedure.input(ArtistsGetSchema).query(async ({ input }) => {
    return await getArtists(input)
  })
})
