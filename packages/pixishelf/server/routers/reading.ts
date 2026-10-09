import 'server-only'
import { TRPCError } from '@trpc/server'
import { authProcedure, router } from '@/server/trpc'
import {
  ReadingContextInputSchema,
  ReadingMarkReadInputSchema,
  ReadingHistoryInputSchema,
  ReadingReportInputSchema,
  ReadingSummariesInputSchema
} from '@/schemas/reading.dto'
import {
  getReadingContext,
  markReadingRead,
  getReadingHistory,
  getReadingSummaries,
  reportReading
} from '@/services/reading-service'

function assertExpectedUser(actualUserId: string, expectedUserId: string) {
  if (actualUserId !== expectedUserId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reading session changed' })
  }
}

export const readingRouter = router({
  context: authProcedure.input(ReadingContextInputSchema).query(({ ctx, input }) => {
    assertExpectedUser(ctx.userId, input.expectedUserId)
    return getReadingContext(ctx.userId, input.artworkId)
  }),
  report: authProcedure.input(ReadingReportInputSchema).mutation(({ ctx, input }) => {
    assertExpectedUser(ctx.userId, input.expectedUserId)
    return reportReading(ctx.userId, input)
  }),
  markRead: authProcedure.input(ReadingMarkReadInputSchema).mutation(({ ctx, input }) => {
    assertExpectedUser(ctx.userId, input.expectedUserId)
    return markReadingRead(ctx.userId, input)
  }),
  summaries: authProcedure.input(ReadingSummariesInputSchema).query(({ ctx, input }) => {
    assertExpectedUser(ctx.userId, input.expectedUserId)
    return getReadingSummaries(ctx.userId, input.artworkIds)
  }),
  history: authProcedure.input(ReadingHistoryInputSchema).query(({ ctx, input }) => {
    assertExpectedUser(ctx.userId, input.expectedUserId)
    return getReadingHistory(ctx.userId, input.pageSize, input.cursor)
  })
})
