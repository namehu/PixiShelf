import { TRPCError } from '@trpc/server'
import { adminProcedure, router } from '@/server/trpc'
import {
  bindPendingReplaceItemSchema,
  pendingReplaceBatchIdSchema,
  pendingReplaceItemIdSchema,
  reorderPendingReplaceItemSchema,
  startPendingReplaceSchema
} from '@/schemas/pending-replace.dto'
import { getScanPath } from '@/services/setting.service'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
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

async function requireScanPath() {
  // 大部分替换动作依赖扫描根目录；未配置时返回前置条件失败，避免操作发生在错误路径下。
  const scanPath = await getScanPath()
  if (!scanPath) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  return scanPath
}

async function scanPathForExecution() {
  return isCentralDispatcherCutoverEnabled() ? '' : requireScanPath()
}

function wrapPendingReplaceError(error: unknown): never {
  // 服务抛错并非结构化时，按字符串规则进行分类映射：
  // - 已存在进行中/未找到/状态不允许 -> 对应 CONFLICT/NOT_FOUND/PRECONDITION_FAILED
  // - 其他错误默认 BAD_REQUEST，避免将内部异常直接泄露。
  const message = error instanceof Error ? error.message : 'Unknown error'
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
