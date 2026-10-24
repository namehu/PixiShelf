import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ArtworkDedupConflictError, lockArtworkDedupRun } from './artwork-dedup'
import { assertMediaContentWritersStopped, lockMediaContentOfflineDispatchers } from './media-content-recovery'

async function inspection(tx: Prisma.TransactionClient, runId: string, now: Date) {
  await lockMediaContentOfflineDispatchers(tx)
  const before = await tx.artworkDedupRun.findUnique({ where: { id: runId }, select: { jobId: true } })
  if (!before?.jobId) throw new ArtworkDedupConflictError('NOT_FOUND')
  await tx.$queryRaw`SELECT "resourceKey" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM system_jobs WHERE id=${before.jobId} FOR UPDATE`
  const run = await lockArtworkDedupRun(tx, runId)
  const job = await tx.systemJob.findUniqueOrThrow({ where: { id: before.jobId } })
  await assertMediaContentWritersStopped(tx, now)
  if (
    run.jobId !== job.id ||
    job.type !== 'ARTWORK_DEDUP_SCAN' ||
    !run.readerToken ||
    !['PENDING', 'RETRY_WAIT', 'PAUSED', 'FAILED', 'CANCELLED'].includes(job.status) ||
    (job.leaseExpiresAt && job.leaseExpiresAt > now)
  ) {
    throw new ArtworkDedupConflictError()
  }
  const snapshot = {
    version: 1,
    runId: run.id,
    runVersion: run.version,
    executionVersion: run.executionVersion,
    jobId: job.id,
    jobAttempt: job.attempt,
    jobStatus: job.status,
    readerToken: run.readerToken,
    readerState: run.readerState,
    readerOwner: run.readerOwner
  }
  const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return { snapshot, digest }
}
export async function inspectArtworkDedupReaderRecovery(
  tx: Prisma.TransactionClient,
  input: { runId: string; now: Date }
) {
  return inspection(tx, input.runId, input.now)
}
export async function recoverArtworkDedupReader(
  tx: Prisma.TransactionClient,
  input: {
    runId: string
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
    !/^[0-9a-f]{64}$/.test(input.expectedDigest)
  ) {
    throw new ArtworkDedupConflictError()
  }
  const current = await inspection(tx, input.runId, input.now)
  if (current.digest !== input.expectedDigest || current.snapshot.readerToken !== input.expectedReaderToken) {
    throw new ArtworkDedupConflictError()
  }
  await tx.artworkDedupRun.update({
    where: { id: input.runId },
    data: { readerState: 'IDLE', readerToken: null, readerOwner: Prisma.DbNull, version: { increment: 1 } }
  })
  await tx.systemJobEvent.create({
    data: {
      jobId: current.snapshot.jobId,
      type: 'job.stage_changed',
      level: 'WARN',
      attempt: current.snapshot.jobAttempt,
      message: '重复作品检测读取进程经离线确认已停止',
      data: {
        operation: 'artwork-dedup.reader-recovered',
        runId: input.runId,
        executionVersion: current.snapshot.executionVersion,
        inspectionDigest: current.digest,
        operator: input.operator
      }
    }
  })
  return { runId: input.runId, recovered: true }
}
