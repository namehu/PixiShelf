import { lockCreatorCatalog } from '@pixishelf/db'
import { assertArchiveSourceSnapshot } from './dedup-source-snapshot.ts'
import { randomUUID } from 'node:crypto'
import {
  archiveImportV2PayloadSchema,
  ARCHIVE_COVERAGE_DEFINITION_VERSION,
  type ArchiveImportV2Payload
} from '@pixishelf/job-contracts'
import type { ExecutionContext, FencedExecutionTransaction } from '@pixishelf/job-runtime'
import { ArchiveExecutorError } from './errors.ts'
import type { ArchiveTransaction } from './types.ts'
import type { ArchivePublishResult } from './publisher.ts'

export const ARCHIVE_PUBLICATION_LOCK = 7_341_902_117

/** Called only inside the current execution's finalizer; successor claim and publication are atomic. */
export async function handoffArchivePhase(
  scope: FencedExecutionTransaction<ArchiveTransaction>,
  context: Pick<ExecutionContext<ArchiveImportV2Payload>, 'job' | 'payload'>,
  phase: 'DOWNLOAD' | 'PUBLISH',
  now: Date,
  seal?: { token: string; digest: string }
) {
  const transaction = scope.transaction
  await lockCreatorCatalog(transaction)
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLICATION_LOCK)
  const current = await transaction.archiveImport.findUnique({ where: { id: context.payload.archiveImportId } })
  const predecessor = await transaction.systemJob.findUniqueOrThrow({ where: { id: context.job.id } })
  if (
    !current ||
    current.systemJobId !== context.job.id ||
    current.cleanupRequestedAt ||
    !['PENDING', 'RUNNING'].includes(current.status) ||
    (phase === 'DOWNLOAD' ? current.phase !== 'LEGACY' : current.phase !== 'DOWNLOAD') ||
    (seal && current.generationToken !== seal.token)
  ) {
    throw new ArchiveExecutorError('STATE_CONFLICT', '归档阶段交接绑定已变化')
  }
  await assertArchiveSourceSnapshot(transaction, current)
  if (seal) {
    const sealed = await transaction.archiveStagingGeneration.updateMany({
      where: { token: seal.token, archiveImportId: current.id, jobId: context.job.id, sealedAt: null, cleanedAt: null },
      data: { sealedAt: now, drainedAt: now, manifestSha256: seal.digest }
    })
    if (sealed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档暂存代已变化')
  }
  const id = randomUUID()
  const automatic = current.origin === 'AUTO'
  const triggerSource = automatic ? 'SYSTEM' : current.origin === 'MANUAL' ? 'MANUAL' : predecessor.triggerSource
  const priority = automatic ? 900 : current.origin === 'MANUAL' ? 10 : predecessor.queuePriority
  const successor = await transaction.systemJob.create({
    data: {
      id,
      type: phase === 'DOWNLOAD' ? 'ARCHIVE_DOWNLOAD' : 'ARCHIVE_PUBLISH',
      executionLane: phase === 'DOWNLOAD' ? 'ARCHIVE_DOWNLOAD' : 'BACKGROUND_WRITER',
      definitionVersion: current.sourceTotalItems === null ? 1 : ARCHIVE_COVERAGE_DEFINITION_VERSION,
      status: 'PENDING',
      triggerSource,
      requestedByUserId: predecessor.requestedByUserId,
      parentJobId: predecessor.id,
      idempotencyKey: `archive-phase:${predecessor.id}:${phase.toLowerCase()}`,
      payload: archiveImportV2PayloadSchema.parse(context.payload),
      queuePriority: priority,
      effectivePriority: automatic || current.origin === 'MANUAL' ? priority : predecessor.effectivePriority,
      availableAt: phase === 'DOWNLOAD' ? predecessor.availableAt : now,
      deadlineAt: predecessor.deadlineAt,
      attempt: phase === 'DOWNLOAD' ? Math.max(0, predecessor.attempt - 1) : 0,
      maxAttempts: predecessor.maxAttempts,
      progress: phase === 'PUBLISH' ? 95 : Math.min(95, predecessor.progress),
      stage: phase === 'PUBLISH' ? 'WAITING_PUBLISH' : 'WAITING_DOWNLOAD',
      message: phase === 'PUBLISH' ? '等待入库' : '等待下载'
    }
  })
  await transaction.archiveImportExecution.create({ data: { jobId: successor.id, archiveImportId: current.id, phase } })
  const changed = await transaction.archiveImport.updateMany({
    where: {
      id: current.id,
      systemJobId: predecessor.id,
      phase: current.phase,
      generationToken: current.generationToken,
      cleanupRequestedAt: null
    },
    data: {
      systemJobId: successor.id,
      phase,
      status: 'PENDING',
      ...(seal ? { sealedManifestSha256: seal.digest } : {})
    }
  })
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档阶段交接状态已变化')
  await transaction.systemJobEvent.create({
    data: {
      jobId: successor.id,
      type: 'job.queued',
      attempt: successor.attempt,
      message: successor.message,
      data: { archiveImportId: current.id, phase, predecessorJobId: predecessor.id }
    }
  })
  await scope.complete({
    result: { outcome: 'HANDOFF', archiveImportId: current.id, successorJobId: successor.id, phase },
    message: successor.message ?? '归档阶段已交接'
  })
}

/** Shares the publication finalizer so the durable intent, child job and parent completion commit together. */
export async function finalizeArchivePublication(
  scope: FencedExecutionTransaction<ArchiveTransaction>,
  parentJobId: string,
  publication: ArchivePublishResult,
  now: Date
) {
  const { retirementRevisionId, ...result } = publication
  if (retirementRevisionId) {
    const retirementJobId = randomUUID()
    await scope.transaction.systemJob.create({
      data: {
        id: retirementJobId,
        type: 'ARCHIVE_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        parentJobId,
        idempotencyKey: `archive-retire:${result.revisionId}`,
        payload: {
          action: 'RETIRE_PARTIAL_REVISION',
          revisionId: retirementRevisionId,
          replacementRevisionId: result.revisionId
        },
        queuePriority: 100,
        effectivePriority: 100,
        availableAt: now,
        maxAttempts: 3,
        message: '清理补全后的旧部分归档副本'
      }
    })
    await scope.transaction.systemJobEvent.create({
      data: { jobId: retirementJobId, type: 'job.queued', attempt: 0, message: '清理补全后的旧部分归档副本' }
    })
  }
  await scope.complete({ result, message: '归档导入已发布' })
}
