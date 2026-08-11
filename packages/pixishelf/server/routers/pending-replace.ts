import { TRPCError } from '@trpc/server'
import { authProcedure, router } from '@/server/trpc'
import {
  bindPendingReplaceItemSchema,
  pendingReplaceBatchIdSchema,
  pendingReplaceItemIdSchema,
  reorderPendingReplaceItemSchema,
  startPendingReplaceSchema
} from '@/schemas/pending-replace.dto'
import { getScanPath } from '@/services/setting.service'
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
  const scanPath = await getScanPath()
  if (!scanPath) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Scan path is not configured' })
  return scanPath
}

function wrapPendingReplaceError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unknown error'
  if (message.includes('already in progress')) throw new TRPCError({ code: 'CONFLICT', message })
  if (message.includes('not found') || message.includes('未找到')) throw new TRPCError({ code: 'NOT_FOUND', message })
  if (message.includes('运行中') || message.includes('不能') || message.includes('无法') || message.includes('没有')) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message })
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message })
}

export const pendingReplaceRouter = router({
  preview: authProcedure.mutation(async () => {
    try {
      return await createPendingReplacePreview(await requireScanPath())
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  status: authProcedure.input(pendingReplaceBatchIdSchema.partial()).query(async ({ input }) => {
    return getPendingReplaceBatch(input.batchId)
  }),

  reorder: authProcedure.input(reorderPendingReplaceItemSchema).mutation(async ({ input }) => {
    try {
      return await reorderPendingReplaceItem(input)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  bind: authProcedure.input(bindPendingReplaceItemSchema).mutation(async ({ input }) => {
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

  unbind: authProcedure.input(pendingReplaceItemIdSchema).mutation(async ({ input }) => {
    try {
      return await unbindPendingReplaceItem(input)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  start: authProcedure.input(startPendingReplaceSchema).mutation(async ({ input }) => {
    try {
      return await startPendingReplaceBatch({
        scanPath: await requireScanPath(),
        batchId: input.batchId,
        itemIds: input.itemIds
      })
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  cancel: authProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input }) => {
    return cancelPendingReplaceBatch(input.batchId)
  }),

  recover: authProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input }) => {
    try {
      return await recoverInterruptedPendingReplaceBatchById(await requireScanPath(), input.batchId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  restore: authProcedure.input(pendingReplaceItemIdSchema).mutation(async ({ input }) => {
    try {
      return await restorePendingReplaceItemById(await requireScanPath(), input.itemId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  }),

  cleanupBackups: authProcedure.input(pendingReplaceBatchIdSchema).mutation(async ({ input }) => {
    try {
      return await cleanupPendingReplaceBatchBackups(await requireScanPath(), input.batchId)
    } catch (error) {
      wrapPendingReplaceError(error)
    }
  })
})
