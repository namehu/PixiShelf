import { getArchiveCoverage } from '@/services/archive/archive-coverage-service'
import { completeArchiveArtwork, completeArchiveArtworkSchema } from '@/services/archive/archive-completion-service'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import logger from '@/lib/logger'
import { adminProcedure, authProcedure, router } from '@/server/trpc'
import { archiveModule } from '@/services/archive/archive-module'
import { redactArchiveText } from '@/services/archive/archive-redaction'
import { ArchiveError } from '@/services/archive/errors'
import {
  actionArchiveTasksMany,
  archiveTaskActionManySchema,
  archiveTaskListSchema,
  getArchiveBulkOperation,
  listArchiveTasks
} from '@/services/archive/archive-task-service'

import { editArchiveTaskCreators, editTaskCreatorsSchema } from '@/services/archive/archive-task-creators'
import {
  archiveTrashListSchema,
  archiveTrashRestoreSchema,
  listArchiveTrash,
  restoreArchiveTrash
} from '@/services/archive/archive-trash-service'
import {
  requestArchiveArtworkMaintenance,
  requestArchivePurgeMaintenance
} from '@/services/archive/archive-maintenance-service'

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
const archiveMutationAckSchema = z.object({ taskId: z.string().min(1) })

/**
 * 归档任务路由：变更操作走显式管理员边界，并将归档服务层的领域错误统一转换为 tRPC 错误码。
 */
export const archiveRouter = router({
  getCoverage: authProcedure
    .input(z.object({ artworkId: z.number().int().positive() }).strict())
    .query(({ input }) => getArchiveCoverage(input.artworkId)),
  completeArtwork: adminProcedure
    .input(completeArchiveArtworkSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => completeArchiveArtwork(input, ctx.userId))),
  listTrash: adminProcedure
    .input(archiveTrashListSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveTrash(input))),
  restoreTrash: adminProcedure
    .input(archiveTrashRestoreSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => restoreArchiveTrash(input, ctx.userId))),
  retryTrash: adminProcedure
    .input(
      z
        .object({
          artworkId: z.number().int().positive(),
          action: z.enum(['TRASH_ARCHIVE', 'RESTORE_ARCHIVE', 'PURGE_ARCHIVE'])
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      runArchiveOperation(async () =>
        input.action === 'PURGE_ARCHIVE'
          ? await requestArchivePurgeMaintenance({ artworkId: input.artworkId, requestedByUserId: ctx.userId })
          : await requestArchiveArtworkMaintenance({ ...input, action: input.action, requestedByUserId: ctx.userId })
      )
    ),
  listTasks: authProcedure
    .input(archiveTaskListSchema)
    .query(({ input }) => runArchiveOperation(() => listArchiveTasks(input))),

  editTaskCreators: adminProcedure
    .input(editTaskCreatorsSchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => editArchiveTaskCreators(input, ctx.userId))),

  listTaskItems: adminProcedure
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

  retryTaskItem: adminProcedure
    .input(z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }))
    .output(archiveMutationAckSchema)
    .mutation(async ({ input, ctx }) =>
      runArchiveOperation(() =>
        archiveModule.retryTaskItem(input.taskId, input.itemId, { requestedByUserId: ctx.userId })
      )
    ),

  action: adminProcedure
    .input(z.object({ taskId: z.string().min(1), action: actionSchema }))
    .output(archiveMutationAckSchema)
    .mutation(async ({ input, ctx }) =>
      runArchiveOperation(() =>
        archiveModule.requestAction(input.taskId, input.action, { requestedByUserId: ctx.userId })
      )
    ),

  actionMany: adminProcedure
    .input(archiveTaskActionManySchema)
    .mutation(({ input, ctx }) => runArchiveOperation(() => actionArchiveTasksMany(input, ctx.userId))),

  getBulkOperation: authProcedure
    .input(z.object({ operationId: z.string().min(1).max(128) }).strict())
    .query(({ input }) => runArchiveOperation(() => getArchiveBulkOperation(input.operationId)))
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
export async function runArchiveOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof ArchiveError)) {
      logger.error('Archive operation failed unexpectedly', {
        error: redactArchiveText(error instanceof Error ? error.message : String(error))
      })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '归档服务暂时不可用，请稍后重试'
      })
    }
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
    if (code === 'INTERNAL_SERVER_ERROR') {
      logger.error('Archive operation failed', {
        code: error.code,
        error: redactArchiveText(error.message)
      })
    }
    throw new TRPCError({
      code,
      message: code === 'INTERNAL_SERVER_ERROR' ? '归档服务暂时不可用，请稍后重试' : error.message
    })
  }
}
