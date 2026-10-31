import type { Prisma } from '@pixishelf/db'
import { ACTIVE_JOB_STATUSES } from '@pixishelf/job-contracts'
import { systemJobWireSelect } from './background-task/job-serialization'

export async function lockActiveVideoPlayback(transaction: Prisma.TransactionClient, imageId: number) {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text', 7_283_462, imageId)
  return transaction.systemJob.findFirst({
    where: {
      type: 'VIDEO_PLAYBACK_GENERATION',
      definitionVersion: 1,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      payload: { path: ['imageId'], equals: imageId }
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: systemJobWireSelect
  })
}
