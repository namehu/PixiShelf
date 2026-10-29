import { createHash } from 'node:crypto'
import { Prisma, bindDiscoveryCreators, lockCreatorCatalog, type PrismaClient } from '@pixishelf/db'
import { ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE, archiveUploaderIdentityLockKey } from '@pixishelf/job-contracts'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { runArchiveBulkOperation } from '@/services/archive/archive-bulk-operation'
import { ArchiveError } from '@/services/archive/errors'
import { archiveTaskSourceUrl } from '@/services/archive/archive-task-source-service'
import { createArchiveIntakeSubmissionInTransaction } from '@/services/archive-intake/archive-intake-service'
import { assertCatalogItemsActionable } from './archive-uploader-catalog-actions'
import { linkIntakeCatalogItems } from './archive-uploader-intake-link'

const id = z.string().trim().min(1).max(128)
const ids = z
  .array(id)
  .min(1)
  .max(100)
  .transform((values) => [...new Set(values)])
const requestId = z.string().trim().min(1).max(180)
export const deferDiscoveryItemsSchema = z.object({ sourceId: id, itemIds: ids, requestId }).strict()
export const deferredItemsCommandSchema = z.object({ deferredItemIds: ids, requestId }).strict()
export const downloadDeferredItemsSchema = deferredItemsCommandSchema.extend({
  downloadMode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
  quality: z.enum(['ORIGINAL', 'DISPLAY']).default('ORIGINAL')
})
export const listDeferredItemsSchema = z
  .object({
    sourceId: id.optional(),
    cursor: z.object({ deferredAt: z.coerce.date(), id }).strict().nullish(),
    limit: z.number().int().min(1).max(100).default(50),
    direction: z.literal('forward').optional()
  })
  .strict()

interface Dependencies {
  database?: PrismaClient
}
type ArchiveDiscoveryDeferredItem = Prisma.ArchiveDiscoveryDeferredItemGetPayload<object>
const databaseFor = (dependencies: Dependencies) => dependencies.database ?? (prisma as unknown as PrismaClient)

export async function listDeferredItems(
  input: z.input<typeof listDeferredItemsSchema>,
  dependencies: Dependencies = {}
) {
  const parsed = listDeferredItemsSchema.parse(input)
  const database = databaseFor(dependencies)
  // sourceId on the decision is an audit origin; membership comes from every source's catalog.
  const scope = parsed.sourceId
    ? Prisma.sql`EXISTS (
    SELECT 1 FROM archive_uploader_catalog_items catalog
    WHERE catalog."sourceId" = ${parsed.sourceId}
      AND catalog."providerKey" = deferred."providerKey" AND catalog."externalId" = deferred."externalId"
  )`
    : Prisma.sql`TRUE`
  const cursor = parsed.cursor
    ? Prisma.sql`AND (
    deferred."deferredAt" < ${parsed.cursor.deferredAt}
    OR (deferred."deferredAt" = ${parsed.cursor.deferredAt} AND deferred.id < ${parsed.cursor.id})
  )`
    : Prisma.empty
  const [rows, counts] = await Promise.all([
    database.$queryRaw<ArchiveDiscoveryDeferredItem[]>(Prisma.sql`
      SELECT deferred.* FROM archive_discovery_deferred_items deferred WHERE ${scope} ${cursor}
      ORDER BY deferred."deferredAt" DESC, deferred.id DESC LIMIT ${parsed.limit + 1}`),
    database.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM archive_discovery_deferred_items deferred WHERE ${scope}`)
  ])
  const visible = rows.slice(0, parsed.limit)
  const last = visible.at(-1)
  return {
    items: visible.map((item) => ({
      id: item.id,
      providerKey: item.providerKey,
      externalId: item.externalId,
      title: item.title,
      sourceDisplayName: item.sourceDisplayName,
      sourceDeleted: item.sourceId === null,
      deferredAt: item.deferredAt,
      uploaderName: item.uploaderName,
      postedAt: item.postedAt,
      sourceHref: `/api/archive/deferred/${encodeURIComponent(item.id)}/source`
    })),
    totalCount: Number(counts[0]?.count ?? 0),
    nextCursor: rows.length > parsed.limit && last ? { deferredAt: last.deferredAt, id: last.id } : null
  }
}

export async function deferDiscoveryItems(
  input: z.input<typeof deferDiscoveryItemsSchema>,
  userId: string,
  dependencies: Dependencies = {}
) {
  const parsed = deferDiscoveryItemsSchema.parse(input)
  const database = databaseFor(dependencies)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'DEFER_DISCOVERY',
      targetType: 'DISCOVERY_ITEM',
      targetIds: parsed.itemIds,
      requestOptions: { sourceId: parsed.sourceId }
    },
    async (transaction, itemId) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${parsed.sourceId}::text))::text`
      )
      const item = await transaction.archiveUploaderCatalogItem.findUnique({
        where: { id: itemId, sourceId: parsed.sourceId },
        include: { source: { select: { displayName: true } } }
      })
      if (!item || !item.matchesQuery) throw new ArchiveError('STATE_CONFLICT', '发现结果不存在或已被筛选排除')
      await lockDeferredIdentity(transaction, item)
      await assertCatalogItemsActionable(transaction, [item])
      const ignored = await transaction.archiveUploaderIgnoredItem.findUnique({
        where: { providerKey_externalId: { providerKey: item.providerKey, externalId: item.externalId } },
        select: { id: true }
      })
      if (ignored) throw new ArchiveError('STATE_CONFLICT', '该画廊已被忽略，请先恢复')
      const canonicalUrl = archiveTaskSourceUrl(item)
      if (!canonicalUrl) throw new ArchiveError('INVALID_URL', '来源地址不可用')
      const existing = await transaction.archiveDiscoveryDeferredItem.findUnique({
        where: { providerKey_externalId: { providerKey: item.providerKey, externalId: item.externalId } }
      })
      if (existing) return { result: 'REUSED', relatedId: existing.id }
      const decision = await transaction.archiveDiscoveryDeferredItem.create({
        data: {
          providerKey: item.providerKey,
          externalId: item.externalId,
          canonicalUrl,
          sourceId: item.sourceId,
          sourceDisplayName: item.source.displayName,
          title: item.title,
          thumbnailUrl: item.thumbnailUrl,
          uploaderName: item.uploaderName,
          postedAt: item.postedAt,
          deferredByUserId: userId
        }
      })
      return { result: 'CREATED', relatedId: decision.id }
    },
    { database }
  )
}

export async function restoreDeferredItems(
  input: z.input<typeof deferredItemsCommandSchema>,
  userId: string,
  dependencies: Dependencies = {}
) {
  const parsed = deferredItemsCommandSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'RESTORE_DEFERRED',
      targetType: 'DEFERRED_DISCOVERY_ITEM',
      targetIds: parsed.deferredItemIds
    },
    async (transaction, targetId) => {
      const decision = await transaction.archiveDiscoveryDeferredItem.findUnique({ where: { id: targetId } })
      if (!decision) return { result: 'SKIPPED' }
      await lockDeferredIdentity(transaction, decision)
      const removed = await transaction.archiveDiscoveryDeferredItem.deleteMany({ where: { id: targetId } })
      return { result: removed.count ? 'APPLIED' : 'SKIPPED' }
    },
    { database: databaseFor(dependencies) }
  )
}

export async function ignoreDeferredItems(
  input: z.input<typeof deferredItemsCommandSchema>,
  userId: string,
  dependencies: Dependencies = {}
) {
  const parsed = deferredItemsCommandSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'IGNORE_DEFERRED',
      targetType: 'DEFERRED_DISCOVERY_ITEM',
      targetIds: parsed.deferredItemIds
    },
    async (transaction, targetId) => {
      const candidate = await transaction.archiveDiscoveryDeferredItem.findUnique({ where: { id: targetId } })
      if (!candidate) return { result: 'SKIPPED' }
      await lockDeferredIdentity(transaction, candidate)
      const decision = await transaction.archiveDiscoveryDeferredItem.findUnique({ where: { id: targetId } })
      if (!decision) return { result: 'SKIPPED' }
      const { providerKey, externalId, sourceId, sourceDisplayName, title, thumbnailUrl, uploaderName, postedAt } =
        decision
      const ignored = await transaction.archiveUploaderIgnoredItem.upsert({
        where: { providerKey_externalId: { providerKey, externalId } },
        update: {},
        create: {
          providerKey,
          externalId,
          sourceId,
          sourceDisplayName,
          title,
          thumbnailUrl,
          uploaderName,
          postedAt,
          ignoredByUserId: userId
        }
      })
      await transaction.archiveDiscoveryDeferredItem.delete({ where: { id: targetId } })
      return { result: 'APPLIED', relatedId: ignored.id }
    },
    { database: databaseFor(dependencies) }
  )
}

export async function downloadDeferredItems(
  input: z.input<typeof downloadDeferredItemsSchema>,
  userId: string,
  dependencies: Dependencies = {}
) {
  const parsed = downloadDeferredItemsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'DOWNLOAD_DEFERRED',
      targetType: 'DEFERRED_DISCOVERY_ITEM',
      targetIds: parsed.deferredItemIds,
      requestOptions: { downloadMode: parsed.downloadMode, quality: parsed.quality }
    },
    async (transaction, targetId) => {
      const candidate = await transaction.archiveDiscoveryDeferredItem.findUnique({ where: { id: targetId } })
      if (!candidate) return { result: 'SKIPPED' }
      if (candidate.sourceId) {
        await transaction.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${candidate.sourceId}::text))::text`
        )
      }
      await lockCreatorCatalog(transaction)
      await lockDeferredIdentity(transaction, candidate)
      const decision = await transaction.archiveDiscoveryDeferredItem.findUnique({ where: { id: targetId } })
      if (!decision) return { result: 'SKIPPED' }
      const submission = await createArchiveIntakeSubmissionInTransaction(
        {
          idempotencyKey: `deferred:${createHash('sha256').update(`${parsed.requestId}:${targetId}`).digest('hex')}`,
          urls: [decision.canonicalUrl],
          downloadMode: parsed.downloadMode,
          quality: parsed.quality
        },
        userId,
        transaction
      )
      if (submission.acceptedCount > 0) {
        const source = decision.sourceId
          ? await transaction.archiveUploaderSource.findUnique({
              where: { id: decision.sourceId },
              select: { sourceKind: true, defaultCreators: { select: { artistId: true } } }
            })
          : null
        if (source?.sourceKind === 'TITLE_QUERY' && source.defaultCreators.length) {
          await bindDiscoveryCreators(
            transaction,
            { providerKey: decision.providerKey, externalId: decision.externalId },
            source.defaultCreators.map((creator) => creator.artistId),
            { automatic: true, title: decision.title }
          )
        }
        await linkIntakeCatalogItems(transaction, [decision], submission.id, new Date())
      }
      return submission.acceptedCount > 0
        ? { result: 'CREATED', relatedId: submission.id }
        : {
            result: 'CONFLICT',
            relatedId: submission.id,
            message: '未能加入收件箱，稍后决定记录已保留；请检查容量或已有任务'
          }
    },
    { database: databaseFor(dependencies) }
  )
}

async function lockDeferredIdentity(
  transaction: Prisma.TransactionClient,
  identity: { providerKey: string; externalId: string }
) {
  const key = archiveUploaderIdentityLockKey(identity.providerKey, identity.externalId)
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE}::integer, hashtext(${key}::text))::text`
  )
}
