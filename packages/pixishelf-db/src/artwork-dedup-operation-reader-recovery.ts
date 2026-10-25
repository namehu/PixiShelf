import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError, lockArtworkDedupOperation } from './artwork-dedup-operation'
import { assertMediaContentWritersStopped, lockMediaContentOfflineDispatchers } from './media-content-recovery'

type Operation = Pick<
  Prisma.ArtworkDedupOperationGetPayload<Record<string, never>>,
  | 'id'
  | 'status'
  | 'mode'
  | 'originalAction'
  | 'preparePurpose'
  | 'protocolVersion'
  | 'executionVersion'
  | 'jobId'
  | 'readerToken'
  | 'readerState'
  | 'cancelRequestedAt'
>
type Job = Pick<
  Prisma.SystemJobGetPayload<Record<string, never>>,
  'id' | 'type' | 'status' | 'payload' | 'definitionVersion' | 'leaseExpiresAt'
>
/** One predicate serves both visible controls and the locked command transaction. */
export function isArtworkDedupPrepareRetryable(op: Operation, job: Job | null, now: Date): boolean {
  const payload = job?.payload as Record<string, unknown> | undefined
  const purposeMatches =
    (op.preparePurpose === 'ISOLATION' && job?.definitionVersion === 1) ||
    (op.preparePurpose === 'DIRECT_DELETE' &&
      (op.protocolVersion === 1 || op.protocolVersion === 2) &&
      (job?.definitionVersion === 3 || op.protocolVersion === 1 && job?.definitionVersion === 2) &&
      payload?.purpose === 'DIRECT_DELETE' &&
      payload?.protocolVersion === op.protocolVersion)
  return (
    op.mode === 'PREPARE' &&
    op.originalAction === 'PREPARE' &&
    purposeMatches &&
    !op.cancelRequestedAt &&
    op.readerState === 'IDLE' &&
    !op.readerToken &&
    !!job &&
    job.id === op.jobId &&
    job.type === 'ARTWORK_DEDUP_MAINTENANCE' &&
    payload?.operationId === op.id &&
    payload?.executionVersion === op.executionVersion &&
    payload?.mode === op.mode &&
    (!job.leaseExpiresAt || job.leaseExpiresAt <= now) &&
    ((op.status === 'FAILED' && job.status === 'FAILED') || (op.status === 'BUILDING' && job.status === 'PAUSED'))
  )
}
async function inspection(tx: Prisma.TransactionClient, operationId: string, now: Date) {
  await lockMediaContentOfflineDispatchers(tx)
  const before = await tx.artworkDedupOperation.findUnique({ where: { id: operationId }, select: { jobId: true } })
  if (!before?.jobId) throw new ArtworkDedupOperationError('NOT_FOUND')
  await tx.$queryRaw`SELECT "resourceKey" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM system_jobs WHERE id=${before.jobId} FOR UPDATE`
  const op = await lockArtworkDedupOperation(tx, operationId)
  const job = await tx.systemJob.findUniqueOrThrow({ where: { id: before.jobId } })
  await assertMediaContentWritersStopped(tx, now)
  const payload = job.payload as Record<string, unknown> | null
  if (
    op.jobId !== job.id ||
    job.type !== 'ARTWORK_DEDUP_MAINTENANCE' ||
    payload?.operationId !== op.id ||
    payload?.executionVersion !== op.executionVersion ||
    payload?.mode !== op.mode ||
    !op.readerToken ||
    !['PENDING', 'RETRY_WAIT', 'PAUSED', 'FAILED', 'CANCELLED'].includes(job.status) ||
    (job.leaseExpiresAt && job.leaseExpiresAt > now)
  ) {
    throw new ArtworkDedupOperationError('CONFLICT')
  }
  const snapshot = {
    version: 1,
    operationId: op.id,
    operationVersion: op.version,
    operationStatus: op.status,
    executionVersion: op.executionVersion,
    mode: op.mode,
    jobId: job.id,
    jobAttempt: job.attempt,
    jobStatus: job.status,
    readerToken: op.readerToken,
    readerState: op.readerState,
    readerOwner: op.readerOwner
  }
  return { snapshot, digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }
}
export function inspectArtworkDedupOperationReaderRecovery(
  tx: Prisma.TransactionClient,
  input: { operationId: string; now: Date }
) {
  return inspection(tx, input.operationId, input.now)
}
export async function recoverArtworkDedupOperationReader(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string
    expectedDigest: string
    expectedReaderToken: string
    operator: string
    confirmAllWritersStopped: boolean
    now: Date
  }
) {
  if (
    input.confirmAllWritersStopped !== true ||
    !input.operator.trim() ||
    input.operator.length > 128 ||
    !/^[a-f0-9]{64}$/.test(input.expectedDigest)
  ) {
    throw new ArtworkDedupOperationError('CONFLICT')
  }
  const current = await inspection(tx, input.operationId, input.now)
  if (current.digest !== input.expectedDigest || current.snapshot.readerToken !== input.expectedReaderToken) {
    throw new ArtworkDedupOperationError('CONFLICT')
  }
  await tx.artworkDedupOperation.update({
    where: { id: input.operationId },
    data: { readerState: 'IDLE', readerToken: null, readerOwner: Prisma.DbNull, version: { increment: 1 } }
  })
  await tx.systemJobEvent.create({
    data: {
      jobId: current.snapshot.jobId,
      type: 'job.stage_changed',
      level: 'WARN',
      attempt: current.snapshot.jobAttempt,
      message: '重复作品维护读取进程经离线确认已停止',
      data: {
        operation: 'artwork-dedup.maintenance-reader-recovered',
        operationId: input.operationId,
        executionVersion: current.snapshot.executionVersion,
        inspectionDigest: current.digest,
        operator: input.operator
      }
    }
  })
  return { operationId: input.operationId, recovered: true as const }
}
