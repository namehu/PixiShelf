import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'

/** Inspect only after claiming source HOLD. The caller requests normal job cancellation and yields;
 * terminal jobs, expired leases and stop requests never manufacture execution exit evidence. */
export async function inspectArtworkDedupArchiveDrain(tx: Prisma.TransactionClient, operationId: string) {
  const sources = await tx.artworkDedupOperationSource.findMany({
    where: { operationId, source: { kind: 'PROVIDER' } },
    include: { source: true }
  })
  if (sources.some(({ source }) => source.ownerOperationId !== operationId || source.status !== 'HOLD')) {
    throw new ArtworkDedupOperationError('SOURCE_HELD')
  }
  if (!sources.length) {
    return { drained: true, stopJobIds: [], undrainedTokens: [], unregisteredJobIds: [], activeWriteIds: [] }
  }
  const imports = await tx.archiveImport.findMany({
    where: { OR: sources.map(({ source }) => ({ providerKey: source.providerKey!, externalId: source.externalId! })) },
    include: { systemJob: true, executions: { include: { job: true } }, generations: true }
  })
  const stopJobIds = new Set<string>(),
    undrainedTokens = new Set<string>(),
    unregisteredJobIds = new Set<string>()
  const jobs = new Set<string>()
  for (const item of imports) {
    const executions = new Map(item.executions.map((execution) => [execution.jobId, execution]))
    if (!executions.has(item.systemJobId)) {
      executions.set(item.systemJobId, {
        jobId: item.systemJobId,
        archiveImportId: item.id,
        phase: item.phase,
        createdAt: item.createdAt,
        job: item.systemJob
      })
    }
    for (const execution of executions.values()) {
      jobs.add(execution.jobId)
      if (['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'].includes(execution.job.status)) {
        stopJobIds.add(execution.jobId)
      }
      if (execution.phase === 'DOWNLOAD' || execution.phase === 'LEGACY') {
        const generations = item.generations.filter((generation) => generation.jobId === execution.jobId)
        // Every started attempt must have registered a distinct execution token before filesystem I/O.
        // A missing registration cannot be repaired using a later attempt's drain receipt.
        if (
          generations.length < execution.job.attempt ||
          (execution.job.leaseToken && !generations.some((generation) => generation.token === execution.job.leaseToken))
        ) {
          unregisteredJobIds.add(execution.jobId)
        }
      }
    }
    for (const generation of item.generations) if (!generation.drainedAt) undrainedTokens.add(generation.token)
  }
  const cleanupJobs = await findArchiveStagingCleanupJobs(
    tx,
    imports.map((item) => item.id)
  )
  for (const job of cleanupJobs) {
    jobs.add(job.id)
    if (['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'].includes(job.status)) {
      stopJobIds.add(job.id)
    }
  }
  const writes = await tx.mediaContentPathWrite.findMany({
    where: {
      status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] },
      OR: [
        { jobId: { in: [...jobs] } },
        {
          sessionId: {
            in: [
              ...imports.map((item) => `archive-publish:${item.id}`),
              ...cleanupJobs.map((job) => `archive-cleanup:${job.id}`)
            ]
          }
        }
      ]
    },
    select: { id: true }
  })
  const activeWriteIds = writes.map((write) => write.id).sort()
  return {
    drained: !stopJobIds.size && !undrainedTokens.size && !unregisteredJobIds.size && !activeWriteIds.length,
    stopJobIds: [...stopJobIds].sort(),
    undrainedTokens: [...undrainedTokens].sort(),
    unregisteredJobIds: [...unregisteredJobIds].sort(),
    activeWriteIds
  }
}

/** Exact business binding only: unrelated maintenance and the dedup operation itself are not old cleanup work. */
export function findArchiveStagingCleanupJobs(tx: Prisma.TransactionClient, importIds: string[]) {
  if (!importIds.length) return Promise.resolve([])
  return tx.systemJob.findMany({
    where: {
      type: 'ARCHIVE_MAINTENANCE',
      AND: [
        { payload: { path: ['action'], equals: 'CLEAN_STAGING' } },
        { OR: importIds.map((id) => ({ payload: { path: ['archiveImportId'], equals: id } })) }
      ]
    },
    select: { id: true, status: true }
  })
}

/** Terminal queue status never releases a durable cleanup declaration or permits a new intent. */
export async function findUnresolvedArchiveStagingCleanup(tx: Prisma.TransactionClient, archiveImportId: string) {
  const jobs = await findArchiveStagingCleanupJobs(tx, [archiveImportId])
  if (!jobs.length) return null
  return tx.mediaContentPathWrite.findFirst({
    where: {
      status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] },
      OR: [
        { jobId: { in: jobs.map((job) => job.id) } },
        { sessionId: { in: jobs.map((job) => `archive-cleanup:${job.id}`) } }
      ]
    },
    select: { id: true, jobId: true, sessionId: true }
  })
}
