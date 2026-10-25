import * as schemas from '@pixishelf/job-contracts'
import { authProcedure, router } from '@/server/trpc'
import { startArtworkDedup, getArtworkDedupRun, controlArtworkDedup } from '@/services/artwork-dedup-service'
import {
  listArtworkDedupReviewGroups,
  listArtworkDedupComparisons,
  saveArtworkDedupReviewService,
  prepareArtworkDedupCleanup,
  getArtworkDedupOperation,
  listArtworkDedupOperations,
  controlArtworkDedupPrepare,
  directDeleteArtworkDedupOperation,
  allowArtworkDedupReimport,
  artworkDedupAdvancedOperation
} from '@/services/artwork-dedup-review-service'
export const artworkDedupRouter = router({
  start: authProcedure
    .input(schemas.artworkDedupStartInputSchema)
    .mutation(({ ctx, input }) => startArtworkDedup(ctx.userId, input)),
  getRun: authProcedure
    .input(schemas.artworkDedupGetRunInputSchema)
    .query(({ ctx, input }) => getArtworkDedupRun(ctx.userId, input)),
  control: authProcedure
    .input(schemas.artworkDedupControlInputSchema)
    .mutation(({ ctx, input }) => controlArtworkDedup(ctx.userId, input)),
  listGroups: authProcedure
    .input(schemas.artworkDedupReviewListGroupsInputSchema)
    .query(({ ctx, input }) => listArtworkDedupReviewGroups(ctx.userId, input)),
  listComparisons: authProcedure
    .input(schemas.artworkDedupListComparisonsInputSchema)
    .query(({ ctx, input }) => listArtworkDedupComparisons(ctx.userId, input)),
  saveReview: authProcedure
    .input(schemas.artworkDedupSaveReviewInputSchema)
    .mutation(({ ctx, input }) => saveArtworkDedupReviewService(ctx.userId, input)),
  prepareCleanup: authProcedure
    .input(schemas.artworkDedupPrepareCleanupInputSchema.or(schemas.artworkDedupPrepareDirectDeleteInputSchema))
    .mutation(({ ctx, input }) => prepareArtworkDedupCleanup(ctx.userId, input)),
  getOperation: authProcedure
    .input(schemas.artworkDedupGetOperationInputSchema)
    .query(({ ctx, input }) => getArtworkDedupOperation(ctx.userId, input)),
  listOperations: authProcedure
    .input(schemas.artworkDedupListOperationsInputSchema)
    .query(({ ctx, input }) => listArtworkDedupOperations(ctx.userId, input)),
  retryOperation: authProcedure
    .input(schemas.artworkDedupRetryOperationInputSchema)
    .mutation(({ ctx, input }) => controlArtworkDedupPrepare(ctx.userId, input, 'RETRY')),
  directDelete: authProcedure
    .input(schemas.artworkDedupDirectDeleteInputSchema)
    .mutation(({ ctx, input }) => directDeleteArtworkDedupOperation(ctx.userId, input)),
  cancelOperation: authProcedure
    .input(schemas.artworkDedupCancelOperationInputSchema)
    .mutation(({ ctx, input }) => controlArtworkDedupPrepare(ctx.userId, input, 'CANCEL')),
  isolate: authProcedure
    .input(schemas.artworkDedupIsolateInputSchema)
    .mutation(({ ctx, input }) => artworkDedupAdvancedOperation(ctx.userId, input, 'ISOLATE')),
  restore: authProcedure
    .input(schemas.artworkDedupRestoreInputSchema)
    .mutation(({ ctx, input }) => artworkDedupAdvancedOperation(ctx.userId, input, 'RESTORE')),
  preparePurge: authProcedure
    .input(schemas.artworkDedupPreparePurgeInputSchema)
    .mutation(({ ctx, input }) => artworkDedupAdvancedOperation(ctx.userId, input, 'PREPARE', 'PURGE')),
  purge: authProcedure
    .input(schemas.artworkDedupPurgeInputSchema)
    .mutation(({ ctx, input }) => artworkDedupAdvancedOperation(ctx.userId, input, 'PURGE')),
  allowReimport: authProcedure
    .input(schemas.artworkDedupAllowReimportInputSchema)
    .mutation(({ ctx, input }) => allowArtworkDedupReimport(ctx.userId, input))
})
