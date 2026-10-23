import type { Prisma } from '@pixishelf/db'
import { ArchiveError } from './errors'

interface PublicationRetryTransaction {
  systemJobEvent: { create(args: { data: Prisma.SystemJobEventUncheckedCreateInput }): PromiseLike<unknown> }
  mediaContentPathWrite: {
    findMany(args: {
      where: Prisma.MediaContentPathWriteWhereInput
      take: number
    }): PromiseLike<Prisma.MediaContentPathWriteGetPayload<Record<string, never>>[]>
  }
  archiveImportExecution: {
    findUnique(args: {
      where: { jobId: string }
    }): PromiseLike<Prisma.ArchiveImportExecutionGetPayload<Record<string, never>> | null>
  }
  systemJob: {
    updateMany(args: {
      where: Prisma.SystemJobWhereInput
      data: Prisma.SystemJobUpdateManyMutationInput
    }): PromiseLike<Prisma.BatchPayload>
  }
  archiveImport: {
    updateMany(args: {
      where: Prisma.ArchiveImportWhereInput
      data: Prisma.ArchiveImportUpdateManyMutationInput
    }): PromiseLike<Prisma.BatchPayload>
  }
  systemJobFailureAcknowledgement: {
    deleteMany(args: { where: { jobId: string } }): PromiseLike<Prisma.BatchPayload>
  }
  archiveUploaderCatalogItem: {
    updateMany(args: {
      where: Prisma.ArchiveUploaderCatalogItemWhereInput
      data: Prisma.ArchiveUploaderCatalogItemUpdateManyArgs['data']
    }): PromiseLike<Prisma.BatchPayload>
  }
}

type PublicationRetryTask = Prisma.ArchiveImportGetPayload<{ include: { systemJob: true } }>

/** Caller holds resource/job locks before the archive coordination lock. File proof remains in the executor. */
export async function retryUnresolvedArchivePublication(
  transaction: PublicationRetryTransaction,
  task: PublicationRetryTask,
  input: { timestamp: Date; requestedByUserId: string; message: string; changesFiles?: boolean }
): Promise<boolean> {
  const claims = await transaction.mediaContentPathWrite.findMany({
    where: {
      status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] },
      OR: [{ jobId: task.systemJobId }, { sessionId: `archive-publish:${task.id}` }]
    },
    take: 2
  })
  if (!claims.length) return false
  const claim = claims[0]!
  const binding = await transaction.archiveImportExecution.findUnique({ where: { jobId: task.systemJobId } })
  if (
    input.changesFiles ||
    task.phase !== 'PUBLISH' ||
    task.systemJob.type !== 'ARCHIVE_PUBLISH' ||
    task.systemJob.status !== 'FAILED' ||
    task.cleanupRequestedAt ||
    claims.length !== 1 ||
    claim.jobId !== task.systemJobId ||
    claim.sessionId !== `archive-publish:${task.id}` ||
    claim.status !== 'ACTIVE' ||
    claim.scope !== 'DIRECTORY' ||
    claim.parentWriteId !== null ||
    claim.declaredFileSize !== null ||
    binding?.archiveImportId !== task.id ||
    binding.phase !== 'PUBLISH'
  ) {
    throw new ArchiveError('STATE_CONFLICT', '未解决的归档写入不能创建新任务，请先恢复原发布操作')
  }
  const changed = await transaction.systemJob.updateMany({
    where: { id: task.systemJobId, status: 'FAILED', attempt: task.systemJob.attempt },
    data: {
      status: 'PENDING',
      availableAt: input.timestamp,
      finishedAt: null,
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      pauseRequestedAt: null,
      cancelRequestedAt: null,
      errorCode: null,
      error: null,
      maxAttempts: Math.max(task.systemJob.maxAttempts, task.systemJob.attempt + 1),
      message: input.message
    }
  })
  if (changed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档发布状态已改变，请刷新后重试')
  const updated = await transaction.archiveImport.updateMany({
    where: { id: task.id, systemJobId: task.systemJobId, status: task.status, phase: 'PUBLISH' },
    data: {
      status: 'PENDING',
      decisionCode: null,
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      retainUntil: null
    }
  })
  if (updated.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档发布绑定已改变，请刷新后重试')
  // This job ID is reused; an acknowledgement of its old failure must not hide a later attempt's failure.
  await transaction.systemJobFailureAcknowledgement.deleteMany({ where: { jobId: task.systemJobId } })
  await transaction.archiveUploaderCatalogItem.updateMany({
    where: { OR: [{ lastArchiveImportId: task.id }, { providerKey: task.providerKey, externalId: task.externalId }] },
    data: {
      lastArchiveImportId: task.id,
      lastOutcome: 'SUBMITTED',
      lastOutcomeAt: input.timestamp,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  })
  await transaction.systemJobEvent.create({
    data: {
      jobId: task.systemJobId,
      type: 'job.queued',
      level: 'INFO',
      attempt: task.systemJob.attempt,
      message: input.message,
      data: {
        reason: 'ARCHIVE_PUBLICATION_RECOVERY',
        archiveImportId: task.id,
        requestedByUserId: input.requestedByUserId,
        nextAttempt: task.systemJob.attempt + 1
      }
    }
  })
  return true
}
