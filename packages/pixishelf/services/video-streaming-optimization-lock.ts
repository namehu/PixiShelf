import type { Prisma } from '@pixishelf/db'
import {
  ACTIVE_JOB_STATUSES,
  JOB_DEFINITION_VERSION,
  videoStreamingOptimizationPayloadSchema
} from '@pixishelf/job-contracts'
import { systemJobWireSelect } from './background-task/job-serialization'

/** All streaming enqueue and retry entry points serialize on the same media target. */
export async function lockActiveVideoStreamingOptimization(
  transaction: Prisma.TransactionClient,
  imageId: number,
  relativePath: string
) {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text', 7_283_461, imageId)
  const existing = await transaction.systemJob.findFirst({
    where: {
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      definitionVersion: JOB_DEFINITION_VERSION,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      AND: [
        { payload: { path: ['imageId'], equals: imageId } },
        { payload: { path: ['mode'], equals: 'REMUX_FASTSTART' } }
      ]
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: systemJobWireSelect
  })
  const payload = existing ? videoStreamingOptimizationPayloadSchema.safeParse(existing.payload) : null
  return existing && payload?.success && payload.data.relativePath === relativePath ? existing : null
}
