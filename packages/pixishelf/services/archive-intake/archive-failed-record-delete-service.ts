import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveUploaderIdentityLockKey,
  archiveUploaderUrlLockKey
} from '@pixishelf/job-contracts'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { archiveSubmittedSourceUrl } from '@/lib/archive-submitted-url'
import { ArchiveError } from '@/services/archive/errors'
import { runArchiveBulkOperation, type ArchiveBulkTargetResult } from '@/services/archive/archive-bulk-operation'

export const deleteArchiveFailedRecordsSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    targetType: z.enum(['INTAKE_ITEM', 'DISCOVERY_ITEM']),
    itemIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100)
  })
  .strict()

type Target = z.infer<typeof deleteArchiveFailedRecordsSchema>['targetType']
type Transaction = Prisma.TransactionClient
const activeIntake = ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] as const
const terminalJobs = ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'] as const
const blockingImports = ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING', 'FAILED'] as const

export async function deleteArchiveFailedRecords(
  input: z.input<typeof deleteArchiveFailedRecordsSchema>,
  requestedByUserId: string,
  dependencies: { database?: PrismaClient } = {}
) {
  const parsed = deleteArchiveFailedRecordsSchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId,
      commandType: 'DELETE_FAILED_RECORDS',
      targetType: parsed.targetType,
      targetIds: parsed.itemIds
    },
    async (transaction, id) => {
      // A replay uses the original cutoff, never the time of the retried HTTP request.
      const operation = await transaction.archiveBulkOperation.findUniqueOrThrow({
        where: { idempotencyKey: parsed.idempotencyKey },
        select: { createdAt: true }
      })
      return deleteTarget(transaction, parsed.targetType, id, operation.createdAt)
    },
    { database }
  )
}

async function loadTarget(tx: Transaction, kind: Target, id: string) {
  if (kind === 'INTAKE_ITEM') {
    const item = await tx.archiveIntakeItem.findUnique({ where: { id } })
    return item ? { ...item, url: item.submittedUrl, eligible: item.status === 'FAILED' } : null
  }
  const item = await tx.archiveUploaderCatalogItem.findUnique({ where: { id } })
  if (!item) return null
  const linked = await tx.archiveIntakeItem.findFirst({
    where: {
      OR: [
        { id: item.lastIntakeItemId ?? '' },
        {
          updatedAt: item.lastOutcomeAt ? { gt: item.lastOutcomeAt } : undefined,
          OR: [
            { providerKey: item.providerKey, externalId: item.externalId },
            { submittedUrl: item.canonicalUrl },
            { canonicalUrl: item.canonicalUrl }
          ]
        }
      ]
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
  })
  if (linked && activeIntake.some((status) => status === linked.status)) {
    conflict('同作品仍有活动收件任务，请等待结束后再删除')
  }
  return {
    ...item,
    url: item.canonicalUrl,
    eligible: linked
      ? linked.status === 'FAILED' &&
        (!item.lastOutcomeAt || linked.updatedAt > item.lastOutcomeAt || item.lastOutcome === 'FAILED')
      : item.lastOutcome === 'FAILED'
  }
}

async function deleteTarget(tx: Transaction, kind: Target, id: string, cutoff: Date): Promise<ArchiveBulkTargetResult> {
  const target = await loadTarget(tx, kind, id)
  if (!target) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '记录已删除' }
  if (!target.eligible) conflict('仅支持删除失败收件及其发现记录')
  const sourceUrl = archiveSubmittedSourceUrl(target.url)
  const path = sourceUrl ? new URL(sourceUrl).pathname : ''
  const gid = path.match(/^\/g\/([1-9]\d*)\//)?.[1] ?? path.match(/^\/s\/[a-z0-9]+\/([1-9]\d*)-/i)?.[1]
  const identity =
    target.providerKey && target.externalId
      ? { providerKey: target.providerKey, externalId: target.externalId }
      : gid
        ? { providerKey: 'e-hentai', externalId: gid }
        : null
  const urls = [...new Set([target.url, target.canonicalUrl, sourceUrl].filter((url): url is string => !!url))]
  const catalogWhere: Prisma.ArchiveUploaderCatalogItemWhereInput = {
    OR: [
      ...(identity ? [identity] : []),
      { canonicalUrl: { in: urls } },
      ...(kind === 'INTAKE_ITEM' ? [{ lastIntakeItemId: id }] : [{ id }])
    ]
  }
  const scanWhere: Prisma.ArchiveUploaderScanItemWhereInput = {
    OR: [
      ...(identity ? [identity] : []),
      { canonicalUrl: { in: urls } },
      ...(kind === 'INTAKE_ITEM' ? [{ intakeItemId: id }] : [])
    ]
  }
  const catalogs = await tx.archiveUploaderCatalogItem.findMany({ where: catalogWhere })
  const scanItems = await tx.archiveUploaderScanItem.findMany({
    where: scanWhere,
    select: { run: { select: { sourceId: true } } }
  })
  const sourceIds = [
    ...new Set([...catalogs.map((row) => row.sourceId), ...scanItems.map((row) => row.run.sourceId)])
  ].sort()
  // Match scanner order: source -> publish -> identity/URL. Never acquire new source locks after identity locks.
  for (const sourceId of sourceIds) await lock(tx, 20_260_902, sourceId)
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(7341902117::bigint)::text`
  const keys = [
    ...new Set([
      ...(identity ? [archiveUploaderIdentityLockKey(identity.providerKey, identity.externalId)] : []),
      ...urls.map(archiveUploaderUrlLockKey),
      ...catalogs.flatMap((row) => [
        archiveUploaderIdentityLockKey(row.providerKey, row.externalId),
        archiveUploaderUrlLockKey(row.canonicalUrl)
      ])
    ])
  ].sort()
  for (const key of keys) await lock(tx, ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE, key)
  // Submission creation uses this lock; prevent a new intake between the activity check and deletion.
  await lock(tx, 20_260_820, 'archive-resolve')
  const current = await loadTarget(tx, kind, id)
  if (!current) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '记录已删除' }
  if (!current.eligible || current.updatedAt > cutoff) conflict('记录已变化，请刷新后重新选择')
  const currentCatalogs = await tx.archiveUploaderCatalogItem.findMany({ where: catalogWhere })
  if (currentCatalogs.some((row) => !sourceIds.includes(row.sourceId) || row.updatedAt > cutoff)) {
    conflict('发现记录已变化，请刷新后重新选择')
  }
  const blockingScan = await tx.archiveUploaderScanRun.findFirst({
    where: {
      sourceId: { in: sourceIds },
      OR: [
        { status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } },
        { systemJob: { status: { notIn: [...terminalJobs] } } }
      ]
    },
    select: { id: true }
  })
  if (blockingScan) conflict('相关来源仍有活动扫描，请等待结束后再删除')

  // Failed parsing may never have persisted providerKey/externalId. Match validated E-Hentai locators by GID too.
  const locatorIds =
    identity?.providerKey === 'e-hentai' && /^[1-9]\d*$/.test(identity.externalId)
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM archive_intake_items WHERE "submittedUrl" ~* ${`^https://e-hentai[.]org/(g/${identity.externalId}/[a-z0-9]+/?|s/[a-z0-9]+/${identity.externalId}-[1-9][0-9]*/?)([?#].*)?$`}
      `)
      : []
  const intakeWhere: Prisma.ArchiveIntakeItemWhereInput = {
    OR: [
      ...(identity ? [identity] : []),
      { submittedUrl: { in: urls } },
      { canonicalUrl: { in: urls } },
      {
        id: {
          in: [
            ...locatorIds.map((row) => row.id),
            ...currentCatalogs.flatMap((row) => (row.lastIntakeItemId ? [row.lastIntakeItemId] : [])),
            ...(kind === 'INTAKE_ITEM' ? [id] : [])
          ]
        }
      }
    ]
  }
  const initialItems = await tx.archiveIntakeItem.findMany({ where: intakeWhere, select: { id: true } })
  if (initialItems.length) {
    // Also fences the generic job retry path, which updates intake rows directly.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM archive_intake_items WHERE id IN (${Prisma.join(initialItems.map((row) => row.id))}) ORDER BY id FOR UPDATE`
    )
  }
  const items = await tx.archiveIntakeItem.findMany({
    where: intakeWhere,
    include: { currentSystemJob: { select: { status: true } } }
  })
  if (
    items.some(
      (row) =>
        activeIntake.includes(row.status as (typeof activeIntake)[number]) ||
        (row.currentSystemJob && !terminalJobs.includes(row.currentSystemJob.status as (typeof terminalJobs)[number]))
    )
  ) {
    conflict('同作品仍有活动收件任务，请等待结束后再删除')
  }
  if (items.some((row) => row.status === 'FAILED' && row.updatedAt > cutoff)) {
    conflict('出现了新的失败记录，请刷新后重新选择')
  }
  const importIds = [
    ...new Set(
      [
        ...items.flatMap((row) => [row.archiveImportId, row.activeArchiveImportId]),
        ...currentCatalogs.map((row) => row.lastArchiveImportId)
      ].filter((value): value is string => !!value)
    )
  ]
  const blockingImport = await tx.archiveImport.findFirst({
    where: {
      OR: [...(identity ? [identity] : []), { canonicalUrl: { in: urls } }, { id: { in: importIds } }],
      status: { in: [...blockingImports] }
    },
    select: { id: true }
  })
  if (blockingImport) conflict('同作品存在活动或失败下载任务，请先到归档任务处理')
  const failedIds = items.filter((row) => row.status === 'FAILED').map((row) => row.id)
  const deletedCatalogs = await tx.archiveUploaderCatalogItem.deleteMany({
    where: { id: { in: currentCatalogs.map((row) => row.id) } }
  })
  const deletedScanItems = await tx.archiveUploaderScanItem.deleteMany({ where: scanWhere })
  const deletedIntakes = await tx.archiveIntakeItem.deleteMany({ where: { id: { in: failedIds }, status: 'FAILED' } })
  if (deletedIntakes.count !== failedIds.length) conflict('收件状态已变化，请刷新后重试')
  return {
    result: 'APPLIED',
    message: `已删除 ${deletedIntakes.count} 条失败收件、${deletedCatalogs.count} 条发现记录和 ${deletedScanItems.count} 条扫描明细；本地归档未改动`
  }
}

function conflict(message: string): never {
  throw new ArchiveError('STATE_CONFLICT', message)
}
async function lock(tx: Transaction, namespace: number, key: string) {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${namespace}::integer, hashtext(${key}::text))::text`)
}
