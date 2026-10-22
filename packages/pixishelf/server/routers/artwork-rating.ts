import 'server-only'
import { TRPCError } from '@trpc/server'
import { authProcedure, router } from '@/server/trpc'
import {
  ArtworkRatingGetInputSchema,
  ArtworkRatingSetInputSchema,
  ArtworkRatingStateSchema
} from '@/schemas/artwork-rating.dto'
import { getArtworkRating, setArtworkRating } from '@/services/artwork-rating-service'

function assertExpectedAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new TRPCError({ code: 'FORBIDDEN', message: '账户已切换，请刷新后重试。' })
}

export const artworkRatingRouter = router({
  get: authProcedure.input(ArtworkRatingGetInputSchema).output(ArtworkRatingStateSchema).query(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return getArtworkRating(ctx.userId, input.artworkId)
  }),
  set: authProcedure.input(ArtworkRatingSetInputSchema).output(ArtworkRatingStateSchema).mutation(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return setArtworkRating(ctx.userId, input.artworkId, input.level)
  })
})
