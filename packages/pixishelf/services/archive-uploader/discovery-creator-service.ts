import {
  Prisma,
  type PrismaClient,
  bindDiscoveryCreators,
  cancelDiscoveryCreator,
  lockCreatorCatalog,
  lockDiscoveryCreators
} from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { runArchiveBulkOperation } from '@/services/archive/archive-bulk-operation'
import { ArchiveError } from '@/services/archive/errors'

const ids = z
  .array(z.number().int().positive())
  .max(200)
  .transform((values) => [...new Set(values)].sort((a, b) => a - b))
const targets = z.array(z.string().min(1).max(128)).min(1).max(100)
export const setDiscoveryCreatorsSchema = z.object({ sourceId: z.string().min(1).max(128), artistIds: ids }).strict()
export const bindDiscoveryCreatorsSchema = setDiscoveryCreatorsSchema
  .extend({
    artistIds: ids.refine((values) => values.length > 0),
    itemIds: targets,
    requestId: z.string().uuid(),
    cancel: z.boolean().default(false)
  })
  .strict()
export const cancelPendingCreatorsSchema = z.object({ pendingIds: targets, requestId: z.string().uuid() }).strict()
export const listPendingCreatorsSchema = z
  .object({
    cursor: z.object({ createdAt: z.coerce.date(), id: z.string().min(1).max(128) }).nullish(),
    limit: z.number().int().min(1).max(100).default(50),
    direction: z.literal('forward').optional()
  })
  .strict()

export async function setDiscoveryCreators(
  input: z.input<typeof setDiscoveryCreatorsSchema>,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = setDiscoveryCreatorsSchema.parse(input)
  return database.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${parsed.sourceId}::text))::text`
    )
    await lockCreatorCatalog(tx)
    if (!(await tx.archiveUploaderSource.findUnique({ where: { id: parsed.sourceId } }))) {
      throw new ArchiveError('STATE_CONFLICT', '发现来源不存在')
    }
    if ((await tx.artist.count({ where: { id: { in: parsed.artistIds } } })) !== parsed.artistIds.length) {
      throw new ArchiveError('STATE_CONFLICT', '所选艺术家或社团已不存在')
    }
    await tx.discoverySourceCreator.deleteMany({ where: { sourceId: parsed.sourceId } })
    await tx.discoverySourceCreator.createMany({
      data: parsed.artistIds.map((artistId) => ({ sourceId: parsed.sourceId, artistId }))
    })
    return { saved: true }
  })
}

export async function snapshotDiscoverySourceCreators(tx: Prisma.TransactionClient, sourceId: string) {
  await lockCreatorCatalog(tx)
  const defaults = await tx.discoverySourceCreator.findMany({ where: { sourceId }, orderBy: { artistId: 'asc' } })
  return defaults.map((row) => row.artistId)
}

export async function bindDiscoveryItems(
  input: z.input<typeof bindDiscoveryCreatorsSchema>,
  userId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = bindDiscoveryCreatorsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: parsed.cancel ? 'CANCEL_PENDING_CREATORS' : 'BIND_CREATORS',
      targetType: 'DISCOVERY_ITEM',
      targetIds: parsed.itemIds,
      requestOptions: { sourceId: parsed.sourceId, artistIds: parsed.artistIds }
    },
    async (tx, id) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(20260902::integer, hashtext(${parsed.sourceId}::text))::text`
      )
      const item = await tx.archiveUploaderCatalogItem.findFirst({
        where: { id, sourceId: parsed.sourceId, matchesQuery: true }
      })
      if (!item) return { result: 'CONFLICT', message: '作品已不在该来源中' }
      await lockDiscoveryCreators(tx, item)
      const identity = { providerKey: item.providerKey, externalId: item.externalId }
      if (parsed.cancel) {
        const pending = await tx.discoveryPendingCreator.findMany({
          where: { ...identity, artistId: { in: parsed.artistIds } }
        })
        for (const row of pending) await cancelDiscoveryCreator(tx, row.id)
        return {
          result: pending.length ? 'APPLIED' : 'SKIPPED',
          message: pending.length ? '已取消待生效绑定' : '绑定已生效或已取消'
        }
      }
      return {
        result: await bindDiscoveryCreators(tx, identity, parsed.artistIds, {
          automatic: false,
          title: item.title,
          requestedByUserId: userId
        })
      }
    },
    { database }
  )
}

export async function cancelPendingCreators(
  input: z.input<typeof cancelPendingCreatorsSchema>,
  userId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = cancelPendingCreatorsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'CANCEL_PENDING_CREATORS',
      targetType: 'PENDING_CREATOR_BINDING',
      targetIds: parsed.pendingIds
    },
    async (tx, id) => {
      await lockCreatorCatalog(tx)
      const pending = await tx.discoveryPendingCreator.findUnique({ where: { id } })
      if (!pending) return { result: 'SKIPPED', message: '绑定已生效或已取消' }
      await lockDiscoveryCreators(tx, pending)
      return { result: (await cancelDiscoveryCreator(tx, id)) ? 'APPLIED' : 'SKIPPED' }
    },
    { database }
  )
}

export async function listPendingCreators(
  input: z.input<typeof listPendingCreatorsSchema>,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = listPendingCreatorsSchema.parse(input)
  const rows = await database.discoveryPendingCreator.findMany({
    where: parsed.cursor
      ? {
          OR: [
            { createdAt: { lt: parsed.cursor.createdAt } },
            { createdAt: parsed.cursor.createdAt, id: { lt: parsed.cursor.id } }
          ]
        }
      : {},
    include: { artist: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1
  })
  const more = rows.length > parsed.limit
  const items = rows.slice(0, parsed.limit)
  const last = items.at(-1)
  return { items, nextCursor: more && last ? { createdAt: last.createdAt, id: last.id } : null }
}
