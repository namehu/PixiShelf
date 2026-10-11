import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import {
  bindPendingReplaceItemSchema,
  pendingReplaceBatchIdSchema,
  pendingReplaceItemIdSchema,
  reorderPendingReplaceItemSchema,
  startPendingReplaceSchema
} from '@/schemas/pending-replace.dto'
import { adminProcedure, router } from '@/server/trpc'
import {
  bindPendingReplaceItem,
  cancelPendingReplaceBatch,
  cleanupPendingReplaceBatchBackups,
  createPendingReplacePreview,
  getPendingReplaceBatch,
  recoverInterruptedPendingReplaceBatchById,
  reorderPendingReplaceItem,
  restorePendingReplaceItemById,
  startPendingReplaceBatch,
  unbindPendingReplaceItem
} from '@/services/pending-replace-service'
import { getScanPath } from '@/services/setting.service'
import { TRPCError } from '@trpc/server'
async function requireScanPath() {
  // 大部分替换动作依赖扫描根目录；未配置时返回前置条件失败，避免操作发生在错误路径下。
  const scanPath = await getScanPath()
  if (!scanPath) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  return scanPath
}
async function scanPathForExecution() {
  return ''
}
const publicPendingReplaceErrors = new Set([
  '该作品已绑定其他目录，请先解除配对',
  'Pending replacement batch cannot be queued from its current state',
  'Pending replacement batch not found',
  'Pending replacement job already in progress',
  '历史替换任务缺少可验证的冻结输入',
  '发现任务已写入项目，不能重复覆盖批次',
  '只有待执行项目可以调整顺序',
  '媒体顺序必须完整且不能重复',
  '当前目录状态不能解除配对',
  '当前目录状态不能调整配对',
  '待替换资源必须是普通目录，不能使用符号链接',
  '批次已开始，不能再调整顺序',
  '批次已开始，不能解除目录配对',
  '批次已开始，不能调整目录配对',
  '无法确定作品目标目录',
  '替换项目缺少 externalId',
  '未找到待绑定作品',
  '未找到待配对目录',
  '没有可恢复的中央替换任务',
  '没有可恢复的备份清理阶段',
  '没有可恢复的替换阶段',
  '没有可恢复的还原阶段',
  '没有可执行的替换项目',
  '没有可清理的旧媒体备份',
  '目录中没有可替换的直属媒体文件',
  '目录配对状态已经变化，请刷新后重试',
  '该作品没有可恢复的旧媒体备份',
  '该作品缺少可验证的旧媒体备份',
  '该目录尚未绑定作品',
  '请求项目不属于当前批次或状态不可执行'
])
function wrapPendingReplaceError(error: unknown): never {
  if (error instanceof TRPCError) throw error
  if (error instanceof BackgroundTaskError && error.code === 'ACTIVE_JOB_CONFLICT') {
    const message =
      error.message === 'An active pending replacement has different frozen input'
        ? error.message
        : 'A pending replacement job is already active'
    throw new TRPCError({ code: 'CONFLICT', message })
  }
  // Only exact, reviewed domain messages may cross the transport boundary.
  const message = error instanceof Error ? error.message : 'Unknown error'
  if (!publicPendingReplaceErrors.has(message)) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: error })
  }
  if (message.includes('already in progress')) throw new TRPCError({ code: 'CONFLICT', message })
  if (message.includes('not found') || message.includes('未找到')) throw new TRPCError({ code: 'NOT_FOUND', message })
  if (message.includes('运行中') || message.includes('不能') || message.includes('无法') || message.includes('没有')) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message })
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message })
}
export const pendingReplaceRouter = router({
  preview: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await createPendingReplacePreview(await scanPathForExecution(), ctx.userId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  status: adminProcedure.input(pendingReplaceBatchIdSchema.partial()).query(async ({ input }) => {
    return getPendingReplaceBatch(input.batchId)
  }),
  reorder: adminProcedure.input(reorderPendingReplaceItemSchema).mutation(async ({ input }) => {
    try {
      return await reorderPendingReplaceItem(input)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  bind: adminProcedure.input(bindPendingReplaceItemSchema).mutation(async ({ input }) => {
    try {
      return await bindPendingReplaceItem({
        scanPath: await requireScanPath(),
        itemId: input.itemId,
        artworkId: input.artworkId
      })
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  unbind: adminProcedure.input(pendingReplaceItemIdSchema).mutation(async ({ input }) => {
    try {
      return await unbindPendingReplaceItem(input)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  start: adminProcedure.input(startPendingReplaceSchema).mutation(async ({ input, ctx }) => {
    try {
      return await startPendingReplaceBatch({
        scanPath: await scanPathForExecution(),
        batchId: input.batchId,
        itemIds: input.itemIds,
        requestedByUserId: ctx.userId
      })
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  cancel: adminProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input }) => {
    return cancelPendingReplaceBatch(input.batchId)
  }),
  recover: adminProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input, ctx }) => {
    try {
      return await recoverInterruptedPendingReplaceBatchById(await scanPathForExecution(), input.batchId, ctx.userId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  restore: adminProcedure.input(pendingReplaceItemIdSchema).mutation(async ({ input, ctx }) => {
    try {
      return await restorePendingReplaceItemById(await scanPathForExecution(), input.itemId, ctx.userId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),
  cleanupBackups: adminProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input, ctx }) => {
    try {
      return await cleanupPendingReplaceBatchBackups(await scanPathForExecution(), input.batchId, ctx.userId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  })
})
