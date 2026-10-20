import type { Prisma } from '@pixishelf/db'
import { archiveUploaderIdentityLockKey } from '@pixishelf/job-contracts'
import { ArchiveError } from '@/services/archive/errors'

type ActionableCatalogItem = Prisma.ArchiveUploaderCatalogItemGetPayload<{
  select: {
    providerKey: true
    externalId: true
    canonicalUrl: true
    classification: true
    lastOutcome: true
    lastOutcomeAt: true
    lastIntakeItemId: true
  }
}>

export async function assertCatalogItemsActionable(
  transaction: Prisma.TransactionClient,
  items: ActionableCatalogItem[]
) {
  const identities = items.map((item) => ({ providerKey: item.providerKey, externalId: item.externalId }))
  const references = await transaction.artworkExternalRef.findMany({
    where: { OR: identities },
    select: {
      providerKey: true,
      externalId: true,
      artwork: { select: { deletedAt: true, archiveLifecycleState: true } }
    }
  })
  const activeArtworkKeys = new Set(
    references
      .filter(
        (reference) => reference.artwork.deletedAt === null && reference.artwork.archiveLifecycleState === 'ACTIVE'
      )
      .map(dispositionKey)
  )
  const cancelledUpdate = (item: ActionableCatalogItem) =>
    item.classification === 'POSSIBLE_UPDATE' &&
    item.lastOutcome === 'CANCELLED' &&
    activeArtworkKeys.has(dispositionKey(item))
  if (
    items.some(
      (item) =>
        item.lastOutcome !== null &&
        item.lastOutcome !== 'ARCHIVED' &&
        item.lastIntakeItemId !== null &&
        !cancelledUpdate(item)
    )
  ) {
    throw new ArchiveError('STATE_CONFLICT', '该画廊已经进入过收件流程；请前往收件箱处理当前结果')
  }
  const canonicalUrls = items.map(({ canonicalUrl }) => canonicalUrl)
  const authoritativeTerminalFilters: Prisma.ArchiveIntakeItemWhereInput[] = items.map((item) => ({
    status: { in: cancelledUpdate(item) ? ['FAILED', 'DUPLICATE'] : ['FAILED', 'CANCELLED', 'DUPLICATE'] },
    updatedAt: item.lastOutcomeAt ? { gt: item.lastOutcomeAt } : undefined,
    OR: [
      { providerKey: item.providerKey, externalId: item.externalId },
      { submittedUrl: item.canonicalUrl },
      { canonicalUrl: item.canonicalUrl }
    ]
  }))
  const [activeIntake, terminalIntake, activeImports] = await Promise.all([
    transaction.archiveIntakeItem.findFirst({
      where: {
        status: { in: ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] },
        OR: [...identities, { submittedUrl: { in: canonicalUrls } }, { canonicalUrl: { in: canonicalUrls } }]
      },
      select: { id: true }
    }),
    transaction.archiveIntakeItem.findFirst({
      where: { OR: authoritativeTerminalFilters },
      select: { id: true }
    }),
    transaction.archiveImport.findFirst({
      where: {
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] },
        OR: identities
      },
      select: { id: true }
    })
  ])
  const referenceKeys = new Set(references.map(dispositionKey))
  const hasInvalidRecommendation = items.some((item) => {
    const archived = referenceKeys.has(dispositionKey(item))
    return archived && item.classification !== 'POSSIBLE_UPDATE'
  })
  if (activeIntake || terminalIntake || activeImports || hasInvalidRecommendation) {
    throw new ArchiveError(
      'STATE_CONFLICT',
      '只能处理尚未提交的新归档、检测到变化或替代版本；活动和异常任务请前往收件箱处理'
    )
  }
}

function dispositionKey(item: Pick<ActionableCatalogItem, 'providerKey' | 'externalId'>) {
  return archiveUploaderIdentityLockKey(item.providerKey, item.externalId)
}
