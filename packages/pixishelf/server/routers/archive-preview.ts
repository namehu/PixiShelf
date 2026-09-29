import { authProcedure, router } from '@/server/trpc'
import {
  getArchivePreviewPage,
  getArchivePreviewPageSchema,
  listArchivePreviewSources,
  listArchivePreviewSourcesSchema,
  openArchivePreview,
  openArchivePreviewSchema,
  reloadArchivePreview,
  reloadArchivePreviewSchema
} from '@/services/archive-preview/archive-preview-service'
import { runArchiveOperation } from './archive'

export const archivePreviewRouter = router({
  sources: authProcedure
    .input(listArchivePreviewSourcesSchema)
    .query(({ input }) => runArchiveOperation(() => listArchivePreviewSources(input))),

  open: authProcedure
    .input(openArchivePreviewSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => openArchivePreview(input, ctx.userId))),

  page: authProcedure
    .input(getArchivePreviewPageSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => getArchivePreviewPage(input, ctx.userId))),

  reload: authProcedure
    .input(reloadArchivePreviewSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => reloadArchivePreview(input, ctx.userId)))
})
