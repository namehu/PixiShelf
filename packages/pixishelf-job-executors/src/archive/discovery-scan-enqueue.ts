import { randomUUID } from 'node:crypto'
import { Prisma, lockCreatorCatalog } from '@pixishelf/db'
import { ARCHIVE_SEARCH_DEFINITION_VERSION, archiveTitleQuerySchema } from '@pixishelf/job-contracts'

export class DiscoveryScanConflict extends Error {}

export async function lockDiscoverySource(tx: Prisma.TransactionClient, sourceId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${sourceId}::text))::text`)
}

/** Caller owns the transaction, including the parent's checkpoint when creating a batch child. */
export async function enqueueDiscoveryScan(
  tx: Prisma.TransactionClient,
  input: {
    sourceId: string
    mode: 'LATEST' | 'HISTORY'
    requestedByUserId: string | null
    sourceKind?: 'UPLOADER' | 'TITLE_QUERY' | 'ALL'
    parentJobId?: string
    idempotencyKey?: string
    now?: Date
    uuid?: () => string
  }
) {
  await lockDiscoverySource(tx, input.sourceId)
  const source = await tx.archiveUploaderSource.findUnique({ where: { id: input.sourceId } })
  if (!source || (input.sourceKind && input.sourceKind !== 'ALL' && source.sourceKind !== input.sourceKind)) {
    throw new DiscoveryScanConflict('发现来源不存在')
  }
  if (source.status !== 'ACTIVE') throw new DiscoveryScanConflict('来源已停用')
  const active = await tx.archiveUploaderScanRun.findFirst({
    where: { sourceId: source.id, status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } },
    select: { id: true }
  })
  if (active) throw new DiscoveryScanConflict('该来源已有活动扫描任务')
  const cursorBefore = input.mode === 'HISTORY' ? source.historyCursor : source.incrementalCursor
  if (input.mode === 'HISTORY' && !cursorBefore) throw new DiscoveryScanConflict('当前没有更早的扫描页可继续')
  const titleQuery = source.sourceKind === 'TITLE_QUERY' ? archiveTitleQuerySchema.parse(source.titleQuery) : null
  const uuid = input.uuid ?? randomUUID
  const runId = uuid()
  const jobId = uuid()
  const priority = input.parentJobId ? 100 : 20
  await tx.systemJob.create({
    data: {
      id: jobId,
      type: titleQuery ? 'ARCHIVE_SEARCH_SCAN' : 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: titleQuery ? ARCHIVE_SEARCH_DEFINITION_VERSION : 1,
      status: 'PENDING',
      triggerSource: input.parentJobId ? 'SYSTEM' : 'MANUAL',
      ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
      requestedByUserId: input.requestedByUserId,
      idempotencyKey: input.idempotencyKey ?? `archive-uploader-scan:${runId}`,
      payload: { scanRunId: runId },
      queuePriority: priority,
      effectivePriority: priority,
      availableAt: input.now ?? new Date(),
      maxAttempts: 3,
      message: '等待扫描发现来源'
    }
  })
  await tx.systemJobEvent.create({
    data: {
      jobId,
      type: 'job.queued',
      attempt: 0,
      message: '发现来源扫描已加入队列',
      data: { sourceId: source.id, scanRunId: runId, mode: input.mode }
    }
  })
  await lockCreatorCatalog(tx)
  const defaults = await tx.discoverySourceCreator.findMany({
    where: { sourceId: source.id },
    orderBy: { artistId: 'asc' }
  })
  const run = await tx.archiveUploaderScanRun.create({
    data: {
      id: runId,
      sourceId: source.id,
      systemJobId: jobId,
      mode: input.mode,
      searchIdentityKind: source.uploaderUid ? 'UID' : source.identityKind,
      searchIdentityValue: source.uploaderUid ?? source.identityValue,
      ...(titleQuery ? { titleQuery } : {}),
      cursorBefore,
      defaultCreatorIds: defaults.map(({ artistId }) => artistId)
    }
  })
  await tx.archiveUploaderSource.update({ where: { id: source.id }, data: { lastRunId: run.id } })
  return run
}
