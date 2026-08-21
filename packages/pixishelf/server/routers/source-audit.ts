import { TRPCError } from '@trpc/server'
import logger from '@/lib/logger'
import { authProcedure, adminProcedure, router } from '@/server/trpc'
import {
  SourceAuditServiceError,
  getSourceAuditApplyOperation,
  getSourceAuditApplyOverview,
  getSourceAudit,
  getSourceAuditAvailability,
  listSourceAuditItems,
  listSourceAuditItemsInputSchema,
  sourceAuditApplyOperationInputSchema,
  sourceAuditApplyOperationSchema,
  sourceAuditApplyOverviewInputSchema,
  sourceAuditApplyOverviewSchema,
  sourceAuditAvailabilitySchema,
  sourceAuditItemPageSchema,
  sourceAuditRunIdInputSchema,
  sourceAuditSummarySchema,
  startSourceAudit,
  startSourceAuditApply,
  startSourceAuditApplyInputSchema,
  startSourceAuditApplyResultSchema,
  startSourceAuditInputSchema,
  startSourceAuditResultSchema
} from '@/services/source-audit'

export const sourceAuditRouter = router({
  availability: authProcedure.output(sourceAuditAvailabilitySchema).query(async () => {
    try {
      return await getSourceAuditAvailability()
    } catch (error) {
      throw sourceAuditErrorToTrpcError(error)
    }
  }),

  start: adminProcedure
    .input(startSourceAuditInputSchema)
    .output(startSourceAuditResultSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await startSourceAudit(input, ctx.userId)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    }),

  startApply: adminProcedure
    .input(startSourceAuditApplyInputSchema)
    .output(startSourceAuditApplyResultSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await startSourceAuditApply(input, ctx.userId)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    }),

  getApplyOverview: authProcedure
    .input(sourceAuditApplyOverviewInputSchema)
    .output(sourceAuditApplyOverviewSchema)
    .query(async ({ input }) => {
      try {
        return await getSourceAuditApplyOverview(input)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    }),

  getApplyOperation: authProcedure
    .input(sourceAuditApplyOperationInputSchema)
    .output(sourceAuditApplyOperationSchema)
    .query(async ({ input }) => {
      try {
        return await getSourceAuditApplyOperation(input)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    }),

  get: authProcedure
    .input(sourceAuditRunIdInputSchema)
    .output(sourceAuditSummarySchema.nullable())
    .query(async ({ input }) => {
      try {
        return await getSourceAudit(input)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    }),

  listItems: authProcedure
    .input(listSourceAuditItemsInputSchema)
    .output(sourceAuditItemPageSchema)
    .query(async ({ input }) => {
      try {
        return await listSourceAuditItems(input)
      } catch (error) {
        throw sourceAuditErrorToTrpcError(error)
      }
    })
})

export function sourceAuditErrorToTrpcError(error: unknown) {
  if (!(error instanceof SourceAuditServiceError)) {
    logger.error('Source audit request failed', { error })
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Source audit request failed' })
  }
  switch (error.code) {
    case 'CONFLICT':
      return new TRPCError({ code: 'CONFLICT', message: error.message })
    case 'NOT_FOUND':
      return new TRPCError({ code: 'NOT_FOUND', message: error.message })
    case 'INVALID_CURSOR':
      return new TRPCError({ code: 'BAD_REQUEST', message: error.message })
    case 'BLOCKED':
      return new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
  }
}
