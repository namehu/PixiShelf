import { prisma } from '@/lib/prisma'
import { PendingReplaceItemStatus } from '@prisma/client'
export async function syncPendingReplaceBatchCounters(batchId: string) {
  const [batch, grouped] = await Promise.all([
    prisma.pendingReplaceBatch.findUniqueOrThrow({ where: { id: batchId } }),
    prisma.pendingReplaceItem.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } })
  ])
  const count = (statuses: PendingReplaceItemStatus[]) =>
    grouped.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0)
  const counters = {
    totalItems: grouped.reduce((sum, row) => sum + row._count._all, 0),
    readyItems: count([PendingReplaceItemStatus.READY]),
    invalidItems: count([PendingReplaceItemStatus.INVALID]),
    excludedItems: count([PendingReplaceItemStatus.EXCLUDED]),
    succeededItems: count([PendingReplaceItemStatus.SUCCESS, PendingReplaceItemStatus.BACKUP_CLEANED]),
    failedItems: count([PendingReplaceItemStatus.FAILED]),
    restoredItems: count([PendingReplaceItemStatus.RESTORED]),
    backupBytes: batch.backupBytes
  }
  await prisma.pendingReplaceBatch.update({ where: { id: batchId }, data: counters })
  return counters
}
