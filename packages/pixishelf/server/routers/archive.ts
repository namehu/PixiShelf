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
const itemStatusFilterSchema = z.enum(['ALL', 'COMPLETED', 'FAILED', 'PENDING', 'DOWNLOADING'])

/**
 * 归档任务路由：仅对已登录用户开放，并将归档服务层的领域错误统一转换为 tRPC 错误码。
 */
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

  listTaskItems: authProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(100).default(50),
        status: itemStatusFilterSchema.default('ALL')
      })
    )
    .query(async ({ input }) =>
      runArchiveOperation(() => archiveModule.listTaskItems(input.taskId, input.cursor, input.limit, input.status))
    ),

  getTaskItemCounts: authProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ input }) => runArchiveOperation(() => archiveModule.getTaskItemCounts(input.taskId))),

  retryTaskItem: authProcedure
    .input(z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }))
    .mutation(async ({ input }) => runArchiveOperation(() => archiveModule.retryTaskItem(input.taskId, input.itemId))),

  action: authProcedure
    .input(z.object({ taskId: z.string().min(1), action: actionSchema }))
    .mutation(async ({ input }) => runArchiveOperation(() => archiveModule.requestAction(input.taskId, input.action)))
})

/**
 * 包装归档服务操作，避免将实现细节错误码直接透传给客户端。
 *
 * 约束说明：
 * - INVALID_URL/UNSUPPORTED_PROVIDER/SSRF_BLOCKED 映射为 BAD_REQUEST
 * - REMOTE_NOT_FOUND 映射为 NOT_FOUND
 * - REMOTE_RATE_LIMITED 映射为 TOO_MANY_REQUESTS
 * - 其他冲突/缺失状态映射为 PRECONDITION_FAILED
 */
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
