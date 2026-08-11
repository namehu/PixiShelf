import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import * as JobService from '@/services/job-service'

export class PendingReplaceLeaseLostError extends Error {
  constructor() {
    super('Pending replacement lease was transferred to the recovery worker')
    this.name = 'PendingReplaceLeaseLostError'
  }
}

export class PendingReplaceCommitOutcomeUnknownError extends Error {
  constructor(operation: 'replace' | 'restore') {
    super(`Pending replacement ${operation} commit outcome is unknown; stale recovery is required`)
    this.name = 'PendingReplaceCommitOutcomeUnknownError'
  }
}

export async function assertPendingReplaceLease(input: { jobId?: string; leaseAttempt?: number }) {
  if (!input.jobId || input.leaseAttempt === undefined) return
  if (!(await JobService.hasPendingReplaceJobLease(input.jobId, input.leaseAttempt))) {
    throw new PendingReplaceLeaseLostError()
  }
}

export async function touchPendingReplaceLease(jobId: string, leaseAttempt: number) {
  const touched = await JobService.touchJobHeartbeat(jobId, leaseAttempt)
  if (touched.count !== 1) throw new PendingReplaceLeaseLostError()
}

export async function assertPendingReplaceTransactionLease(
  tx: { systemJob: { updateMany(args: any): PromiseLike<{ count: number }> } },
  input: { jobId?: string; leaseAttempt?: number }
) {
  if (!input.jobId || input.leaseAttempt === undefined) return
  const touched = await tx.systemJob.updateMany({
    where: {
      id: input.jobId,
      type: 'PENDING_REPLACE',
      attempt: input.leaseAttempt,
      status: { in: ['RUNNING', 'CANCELLING'] }
    },
    data: { heartbeatAt: new Date() }
  })
  if (touched.count !== 1) throw new PendingReplaceLeaseLostError()
}

export async function updatePendingReplaceItemWithLease(
  input: { jobId?: string; leaseAttempt?: number },
  itemId: string,
  data: Prisma.PendingReplaceItemUpdateArgs['data']
) {
  if (!input.jobId || input.leaseAttempt === undefined) {
    return prisma.pendingReplaceItem.update({ where: { id: itemId }, data })
  }
  return prisma.$transaction(async (tx) => {
    await assertPendingReplaceTransactionLease(tx, input)
    return tx.pendingReplaceItem.update({ where: { id: itemId }, data })
  })
}

export async function updatePendingReplaceItemsWithLease(
  input: { jobId?: string; leaseAttempt?: number },
  args: Prisma.PendingReplaceItemUpdateManyArgs
) {
  if (!input.jobId || input.leaseAttempt === undefined) {
    return prisma.pendingReplaceItem.updateMany(args)
  }
  return prisma.$transaction(async (tx) => {
    await assertPendingReplaceTransactionLease(tx, input)
    return tx.pendingReplaceItem.updateMany(args)
  })
}

export async function withPendingReplaceMutationLease<T>(
  input: { jobId?: string; leaseAttempt?: number },
  mutation: () => Promise<T>
) {
  if (!input.jobId || input.leaseAttempt === undefined) return mutation()
  return prisma.$transaction(
    async (tx) => {
      await assertPendingReplaceTransactionLease(tx, input)
      return mutation()
    },
    { maxWait: 10_000, timeout: 10 * 60_000 }
  )
}
