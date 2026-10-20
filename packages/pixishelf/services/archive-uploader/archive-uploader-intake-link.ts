import { Prisma } from '@pixishelf/db'
import { archiveUploaderIdentityLockKey } from '@pixishelf/job-contracts'

export async function linkIntakeCatalogItems(
  transaction: Prisma.TransactionClient,
  items: Array<{ providerKey: string; externalId: string; canonicalUrl: string }>,
  submissionId: string,
  outcomeAt: Date
) {
  const intakeItems = await transaction.archiveIntakeItem.findMany({
    where: { submissionId },
    select: { id: true, submittedUrl: true, status: true, updatedAt: true }
  })
  const intakeByUrl = new Map(intakeItems.map((item) => [item.submittedUrl, item]))
  const updates = new Map<string, Prisma.Sql>()
  for (const item of items) {
    const intakeItem = intakeByUrl.get(item.canonicalUrl)
    if (!intakeItem) continue
    const duplicate = intakeItem.status === 'DUPLICATE'
    updates.set(
      archiveUploaderIdentityLockKey(item.providerKey, item.externalId),
      Prisma.sql`(
        ${item.providerKey}::text, ${item.externalId}::text, ${intakeItem.id}::text,
        ${duplicate ? 'DUPLICATE' : 'SUBMITTED'}::"ArchiveUploaderCatalogOutcome",
        ${duplicate ? intakeItem.updatedAt : outcomeAt}::timestamp,
        ${duplicate ? 'ACTIVE_DUPLICATE' : null}::text,
        ${duplicate ? '相同链接已有活动收件项目' : null}::text
      )`
    )
  }
  if (updates.size === 0) return
  // Match every source for this identity, exactly as the previous per-item updates did.
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "archive_uploader_catalog_items" AS catalog
    SET "lastIntakeItemId" = incoming."intakeId",
        "lastArchiveImportId" = NULL,
        "lastOutcome" = incoming."outcome",
        "lastOutcomeAt" = incoming."outcomeAt",
        "lastErrorCode" = incoming."errorCode",
        "lastErrorMessage" = incoming."errorMessage",
        "updatedAt" = ${outcomeAt}
    FROM (VALUES ${Prisma.join([...updates.values()])})
      AS incoming("providerKey", "externalId", "intakeId", "outcome", "outcomeAt", "errorCode", "errorMessage")
    WHERE catalog."providerKey" = incoming."providerKey"
      AND catalog."externalId" = incoming."externalId"
  `)
}
