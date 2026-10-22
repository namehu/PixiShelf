import 'server-only'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { authProcedure, router } from '@/server/trpc'
import {
  MediaMarkGetManyInput, MediaMarkGetManyResponseDto, MediaMarkListInput, MediaMarkListResponseDto,
  MediaMarkRemoveInput, MediaMarkSetInput, MediaMarkStateDto
} from '@/schemas/media-mark.dto'
import { getMediaMarks, listMediaMarks, removeMediaMark, setMediaMark } from '@/services/media-mark-service'

function assertExpectedAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new TRPCError({ code: 'FORBIDDEN', message: '账户已切换，请刷新后重试。' })
}

export const mediaMarkRouter = router({
  getMany: authProcedure.input(MediaMarkGetManyInput).output(MediaMarkGetManyResponseDto).query(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return getMediaMarks(ctx.userId, input.artworkId, input.mediaIds)
  }),
  set: authProcedure.input(MediaMarkSetInput).output(MediaMarkStateDto).mutation(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return setMediaMark(ctx.userId, input.artworkId, input.mediaId, input.kind, input.value)
  }),
  list: authProcedure.input(MediaMarkListInput).output(MediaMarkListResponseDto).query(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return listMediaMarks(ctx.userId, input.kind, input.page)
  }),
  remove: authProcedure.input(MediaMarkRemoveInput).output(z.object({ success: z.literal(true) })).mutation(({ ctx, input }) => {
    assertExpectedAccount(ctx.userId, input.expectedUserId)
    return removeMediaMark(ctx.userId, input.markId, input.kind)
  })
})
