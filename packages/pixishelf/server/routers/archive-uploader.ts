import { adminProcedure, authProcedure, router } from '@/server/trpc'
import {
  addArchiveUploaderScanItems,
  addArchiveUploaderScanItemsSchema,
  cancelArchiveUploaderScan,
  cancelArchiveUploaderScanSchema,
  createArchiveUploaderSource,
  createArchiveUploaderSourceSchema,
  getArchiveUploaderSource,
  getArchiveUploaderSourceSchema,
  listArchiveUploaderSources,
  listArchiveUploaderSourcesSchema,
  listArchiveUploaderScanItems,
  listArchiveUploaderScanItemsSchema,
  setArchiveUploaderSourceArchived,
  setArchiveUploaderSourceArchivedSchema,
  triggerArchiveUploaderScan,
  triggerArchiveUploaderScanSchema
} from '@/services/archive-uploader/archive-uploader-service'
import { runArchiveOperation } from './archive'

export const archiveUploaderRouter = router({
  createSource: adminProcedure
    .input(createArchiveUploaderSourceSchema)
    .mutation(({ input }) => runArchiveOperation(() => createArchiveUploaderSource(input))),

  listSources: authProcedure
    .input(listArchiveUploaderSourcesSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveUploaderSources(input))),

  getSource: authProcedure
    .input(getArchiveUploaderSourceSchema)
    .query(({ input }) => runArchiveOperation(() => getArchiveUploaderSource(input))),

  listItems: authProcedure
    .input(listArchiveUploaderScanItemsSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveUploaderScanItems(input))),

  setArchived: adminProcedure
    .input(setArchiveUploaderSourceArchivedSchema)
    .mutation(({ input }) => runArchiveOperation(() => setArchiveUploaderSourceArchived(input))),

  triggerScan: adminProcedure
    .input(triggerArchiveUploaderScanSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => triggerArchiveUploaderScan(input, ctx.userId))),

  cancelScan: adminProcedure
    .input(cancelArchiveUploaderScanSchema)
    .mutation(({ input }) => runArchiveOperation(() => cancelArchiveUploaderScan(input))),

  addToInbox: adminProcedure
    .input(addArchiveUploaderScanItemsSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => addArchiveUploaderScanItems(input, ctx.userId)))
})
