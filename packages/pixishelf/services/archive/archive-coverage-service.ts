import { prisma } from '@/lib/prisma'
import { archiveWireErrorMessage } from './archive-redaction'

export async function getArchiveCoverage(artworkId: number) {
  const revision = await prisma.archiveRevision.findFirst({
    where: {
      artworkId,
      isCurrent: true,
      retiredAt: null,
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    },
    select: {
      id: true,
      downloadScope: true,
      sourceTotalItems: true,
      sourcePlanDigest: true,
      artwork: { select: { imageCount: true } }
    }
  })
  if (!revision) return null
  const completion = await prisma.archiveIntakeItem.findFirst({
    where: { completionBaseRevisionId: revision.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      archiveImport: { select: { id: true, status: true, errorCode: true, errorMessage: true } }
    }
  })
  const partial =
    revision.downloadScope === 'FIRST_20' &&
    revision.sourceTotalItems !== null &&
    revision.artwork.imageCount < revision.sourceTotalItems
  const task = completion?.archiveImport
  const active = task
    ? ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status)
    : Boolean(completion && ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'].includes(completion.status))
  return {
    revisionId: revision.id,
    localCount: revision.artwork.imageCount,
    sourceTotal: revision.sourceTotalItems,
    partial,
    canComplete: partial && Boolean(revision.sourcePlanDigest) && !active,
    active,
    taskId: task?.id ?? null,
    intakeItemId: completion?.id ?? null,
    error: archiveWireErrorMessage(
      task?.errorCode ?? completion?.errorCode ?? null,
      task?.errorMessage ?? completion?.errorMessage ?? null
    )
  }
}
export type ArchiveCoverage = Awaited<ReturnType<typeof getArchiveCoverage>>
