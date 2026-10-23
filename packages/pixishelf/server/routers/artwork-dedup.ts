import {
  artworkDedupStartInputSchema,
  artworkDedupGetRunInputSchema,
  artworkDedupControlInputSchema,
  artworkDedupListGroupsInputSchema
} from '@pixishelf/job-contracts'
import { authProcedure, router } from '@/server/trpc'
import {
  assertArtworkDedupAccount,
  startArtworkDedup,
  getArtworkDedupRun,
  controlArtworkDedup,
  listArtworkDedupGroups
} from '@/services/artwork-dedup-service'

export const artworkDedupRouter = router({
  start: authProcedure.input(artworkDedupStartInputSchema).mutation(({ ctx, input }) => {
    assertArtworkDedupAccount(ctx.userId, input.expectedUserId)
    return startArtworkDedup(ctx.userId, input)
  }),
  getRun: authProcedure.input(artworkDedupGetRunInputSchema).query(({ ctx, input }) => {
    assertArtworkDedupAccount(ctx.userId, input.expectedUserId)
    return getArtworkDedupRun(ctx.userId, input)
  }),
  control: authProcedure.input(artworkDedupControlInputSchema).mutation(({ ctx, input }) => {
    assertArtworkDedupAccount(ctx.userId, input.expectedUserId)
    return controlArtworkDedup(ctx.userId, input)
  }),
  listGroups: authProcedure.input(artworkDedupListGroupsInputSchema).query(({ ctx, input }) => {
    assertArtworkDedupAccount(ctx.userId, input.expectedUserId)
    return listArtworkDedupGroups(ctx.userId, input)
  })
})
