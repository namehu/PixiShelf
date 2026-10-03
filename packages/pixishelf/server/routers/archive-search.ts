import { z } from 'zod'
import {
  startDiscoveryBatch,
  startDiscoveryBatchSchema,
  getDiscoveryBatch,
  discoveryBatchIdSchema,
  commandDiscoveryBatch,
  controlDiscoveryBatchSchema,
  retryDiscoveryBatch,
  retryDiscoveryBatchSchema
} from '@/services/archive-uploader/discovery-batch-service'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
  archiveDiscoveryCatalogCountsSchema,
  getArchiveDiscoveryCatalogCounts,
  deleteArchiveDiscoverySource,
  deleteArchiveDiscoverySourceSchema,
  getArchiveDiscoverySourceDeletePreview,
  renameArchiveTitleSource,
  renameArchiveTitleSourceSchema,
  addArchiveUploaderScanItems,
  addArchiveUploaderScanItemsSchema,
  cancelArchiveUploaderScan,
  cancelArchiveUploaderScanSchema,
  createArchiveUploaderSubmissionAttempt,
  createArchiveUploaderSubmissionAttemptSchema,
  createArchiveTitleSource,
  createArchiveTitleSourceSchema,
  getArchiveUploaderSource,
  getArchiveUploaderSourceSchema,
  ignoreArchiveUploaderScanItems,
  ignoreArchiveUploaderScanItemsSchema,
  listArchiveUploaderSources,
  listArchiveUploaderSourcesSchema,
  listArchiveUploaderIgnoredItems,
  listArchiveUploaderIgnoredItemsSchema,
  listArchiveUploaderScanItems,
  listArchiveUploaderScanItemsSchema,
  restoreArchiveUploaderIgnoredItems,
  restoreArchiveUploaderIgnoredItemsSchema,
  setArchiveUploaderSourceArchived,
  setArchiveUploaderSourceArchivedSchema,
  triggerArchiveUploaderScan,
  triggerArchiveUploaderScanSchema
} from '@/services/archive-uploader/archive-uploader-service'
import { runArchiveOperation } from './archive'
import {
  setDiscoveryCreators,
  setDiscoveryCreatorsSchema,
  bindDiscoveryItems,
  bindDiscoveryCreatorsSchema,
  cancelPendingCreators,
  cancelPendingCreatorsSchema,
  listPendingCreators,
  listPendingCreatorsSchema
} from '@/services/archive-uploader/discovery-creator-service'

const discovery = { sourceKind: 'ALL' as const }

export const archiveSearchRouter = router({
  startBatchScan: adminProcedure
    .input(startDiscoveryBatchSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => startDiscoveryBatch(input, ctx.userId))),
  activeBatchScan: authProcedure.query(() => runArchiveOperation(() => getDiscoveryBatch())),
  batchScanDetail: authProcedure
    .input(discoveryBatchIdSchema)
    .query(({ input }) => runArchiveOperation(() => getDiscoveryBatch(input.batchId))),
  controlBatchScan: adminProcedure
    .input(controlDiscoveryBatchSchema)
    .mutation(({ input }) => runArchiveOperation(() => commandDiscoveryBatch(input))),
  retryBatchScan: adminProcedure
    .input(retryDiscoveryBatchSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => retryDiscoveryBatch(input, ctx.userId))),
  setDefaultCreators: adminProcedure
    .input(setDiscoveryCreatorsSchema)
    .mutation(({ input }) => runArchiveOperation(() => setDiscoveryCreators(input))),
  bindCreators: adminProcedure
    .input(bindDiscoveryCreatorsSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => bindDiscoveryItems(input, ctx.userId))),
  cancelPendingCreators: adminProcedure
    .input(cancelPendingCreatorsSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => cancelPendingCreators(input, ctx.userId))),
  listPendingCreators: authProcedure
    .input(listPendingCreatorsSchema)
    .query(({ input }) => runArchiveOperation(() => listPendingCreators(input))),
  getDeletePreview: authProcedure
    .input(deleteArchiveDiscoverySourceSchema)
    .query(({ input }) => runArchiveOperation(() => getArchiveDiscoverySourceDeletePreview(input, discovery))),
  deleteSource: adminProcedure
    .input(deleteArchiveDiscoverySourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => deleteArchiveDiscoverySource(input, discovery))),
  renameSource: adminProcedure
    .input(renameArchiveTitleSourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => renameArchiveTitleSource(input))),
  createSource: adminProcedure
    .input(createArchiveTitleSourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => createArchiveTitleSource(input))),

  catalogCounts: authProcedure
    .input(archiveDiscoveryCatalogCountsSchema)
    .query(({ input }) => runArchiveOperation(() => getArchiveDiscoveryCatalogCounts(input, discovery))),

  listSources: authProcedure
    .input(listArchiveUploaderSourcesSchema.extend({ includeCounts: z.boolean().default(true) }))
    .query(({ input: { includeCounts, ...input } }) =>
      runArchiveOperation(() => listArchiveUploaderSources(input, { ...discovery, includeCounts }))
    ),

  getSource: authProcedure
    .input(getArchiveUploaderSourceSchema.extend({ includeCounts: z.boolean().default(true) }))
    .query(({ input: { includeCounts, ...input } }) =>
      runArchiveOperation(() => getArchiveUploaderSource(input, { ...discovery, includeCounts }))
    ),

  listItems: authProcedure
    .input(listArchiveUploaderScanItemsSchema.extend({ includeCounts: z.boolean().default(true) }))
    .query(({ input: { includeCounts, ...input } }) =>
      runArchiveOperation(() => listArchiveUploaderScanItems(input, { ...discovery, includeCounts }))
    ),

  listIgnoredItems: authProcedure
    .input(listArchiveUploaderIgnoredItemsSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveUploaderIgnoredItems(input))),

  setArchived: adminProcedure
    .input(setArchiveUploaderSourceArchivedSchema)
    .mutation(({ input }) => runArchiveOperation(() => setArchiveUploaderSourceArchived(input, discovery))),

  triggerScan: adminProcedure
    .input(triggerArchiveUploaderScanSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => triggerArchiveUploaderScan(input, ctx.userId, discovery))),

  cancelScan: adminProcedure
    .input(cancelArchiveUploaderScanSchema)
    .mutation(({ input }) => runArchiveOperation(() => cancelArchiveUploaderScan(input, discovery))),

  createSubmissionAttempt: adminProcedure
    .input(createArchiveUploaderSubmissionAttemptSchema)
    .mutation(({ input }) => runArchiveOperation(() => createArchiveUploaderSubmissionAttempt(input, discovery))),

  addToInbox: adminProcedure
    .input(addArchiveUploaderScanItemsSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => addArchiveUploaderScanItems(input, ctx.userId, discovery))),

  ignoreItems: adminProcedure
    .input(ignoreArchiveUploaderScanItemsSchema)
    .mutation(({ input, ctx }) =>
      runArchiveOperation(() => ignoreArchiveUploaderScanItems(input, ctx.userId, discovery))
    ),

  restoreIgnoredItems: adminProcedure
    .input(restoreArchiveUploaderIgnoredItemsSchema)
    .mutation(({ input }) => runArchiveOperation(() => restoreArchiveUploaderIgnoredItems(input)))
})
