import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
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

const discovery = { sourceKind: 'ALL' as const }

export const archiveSearchRouter = router({
  renameSource: adminProcedure
    .input(renameArchiveTitleSourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => renameArchiveTitleSource(input))),
  createSource: adminProcedure
    .input(createArchiveTitleSourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => createArchiveTitleSource(input))),

  listSources: authProcedure
    .input(listArchiveUploaderSourcesSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveUploaderSources(input, discovery))),

  getSource: authProcedure
    .input(getArchiveUploaderSourceSchema)
    .query(({ input }) => runArchiveOperation(() => getArchiveUploaderSource(input, discovery))),

  listItems: authProcedure
    .input(listArchiveUploaderScanItemsSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveUploaderScanItems(input, discovery))),

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
