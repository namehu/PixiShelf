import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { authProcedure, router } from '@/server/trpc'
import { archiveModule } from '@/services/archive/archive-module'
import { ArchiveError } from '@/services/archive/errors'

const actionSchema = z.enum([
  'PAUSE',
  'RESUME',
  'CANCEL',
  'RETRY',
  'USE_DISPLAY_QUALITY',
  'DELETE_STAGING',
  'DELETE_ARCHIVE',
  'RESTORE_ARCHIVE'
])

export const archiveRouter = router({
  preview: authProcedure
    .input(z.object({ url: z.url().max(2_048) }))
    .mutation(async ({ input }) => runArchiveOperation(() => archiveModule.preview(input.url))),

  enqueue: authProcedure
    .input(z.object({ previewToken: z.string().min(1), quality: z.enum(['ORIGINAL', 'DISPLAY']) }))
    .mutation(async ({ input }) => runArchiveOperation(() => archiveModule.enqueue(input))),

  getTask: authProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ input }) => runArchiveOperation(() => archiveModule.getTask(input.taskId))),

  listTasks: authProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).default({ limit: 30 }))
    .query(async ({ input }) => runArchiveOperation(() => archiveModule.listTasks(input.limit))),

  action: authProcedure
    .input(z.object({ taskId: z.string().min(1), action: actionSchema }))
    .mutation(async ({ input }) => runArchiveOperation(() => archiveModule.requestAction(input.taskId, input.action)))
})

async function runArchiveOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof ArchiveError)) throw error
    const code =
      error.code === 'INVALID_URL' || error.code === 'UNSUPPORTED_PROVIDER' || error.code === 'SSRF_BLOCKED'
        ? 'BAD_REQUEST'
        : error.code === 'REMOTE_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'REMOTE_RATE_LIMITED'
            ? 'TOO_MANY_REQUESTS'
            : error.code === 'ORIGINAL_UNAVAILABLE' || error.code === 'STATE_CONFLICT'
              ? 'PRECONDITION_FAILED'
              : 'INTERNAL_SERVER_ERROR'
    throw new TRPCError({ code, message: error.message, cause: error })
  }
}
