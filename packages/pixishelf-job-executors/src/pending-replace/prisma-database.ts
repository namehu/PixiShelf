import { Prisma, type PrismaClient } from '@pixishelf/db'
import type { QueueSqlExecutor } from '@pixishelf/job-runtime'
import type {
  PendingReplaceDatabasePort,
  PendingReplaceItemCheckpoint,
  PendingReplaceItemSnapshot,
  PendingReplaceMediaSnapshot
} from './types.js'
import { PendingReplacePermanentError } from './types.js'

type PendingPrismaTransaction = Prisma.TransactionClient & QueueSqlExecutor
type PendingPrismaDatabase = Pick<
  PrismaClient,
  'pendingReplaceOperation' | 'pendingReplaceBatch' | 'pendingReplaceItem' | 'artwork' | 'image' | 'tag' | 'artworkTag'
>

const itemSelect = {
  id: true,
  batchId: true,
  artworkId: true,
  externalId: true,
  artworkTitle: true,
  artistName: true,
  sourceDirectory: true,
  sourceDirectoryName: true,
  targetDirectory: true,
  status: true,
  included: true,
  fingerprint: true,
  sourceManifest: true,
  oldMediaSnapshot: true,
  newMediaSnapshot: true,
  targetFileSnapshot: true,
  warnings: true,
  backupDirectory: true,
  completedDirectory: true
} as const

export function createPrismaPendingReplaceDatabase(
  database: PendingPrismaDatabase
): PendingReplaceDatabasePort<PendingPrismaTransaction> {
  return {
    async loadOperation(systemJobId) {
      return database.pendingReplaceOperation.findUnique({ where: { systemJobId } })
    },
    async loadBatch(batchId) {
      return database.pendingReplaceBatch.findUnique({
        where: { id: batchId },
        select: { id: true, status: true, sourceRoot: true, startedAt: true }
      })
    },
    async loadItems(batchId, itemIds) {
      const items = await database.pendingReplaceItem.findMany({
        where: { batchId, ...(itemIds ? { id: { in: [...itemIds] } } : {}) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: itemSelect
      })
      return items.map(mapItem)
    },
    async findArtworksByExternalIds(externalIds) {
      if (externalIds.length === 0) return []
      const artworks = await database.artwork.findMany({
        where: {
          deletedAt: null,
          OR: [{ externalId: { in: [...externalIds] } }, { storageKey: { in: [...externalIds] } }]
        },
        select: {
          id: true,
          externalId: true,
          storageKey: true,
          title: true,
          storagePath: true,
          artist: { select: { name: true } },
          images: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
              path: true,
              sortOrder: true,
              width: true,
              height: true,
              size: true,
              mediaType: true,
              chaptersPath: true
            }
          }
        }
      })
      return artworks.map((artwork) => ({
        id: artwork.id,
        externalId: artwork.externalId,
        storageKey: artwork.storageKey,
        title: artwork.title,
        storagePath: artwork.storagePath,
        artistName: artwork.artist?.name ?? null,
        images: artwork.images.map((image) => ({ ...image, size: bigintToSafeNumber(image.size, 'image.size') }))
      }))
    },
    async createDiscoveredItems(transaction, input) {
      const client = prismaTransaction(transaction)
      await assertOperation(client, input.systemJobId, input.batchId, 'DISCOVER')
      const existing = await client.pendingReplaceItem.count({ where: { batchId: input.batchId } })
      if (existing !== 0) throw new PendingReplacePermanentError('INVALID_OPERATION', 'Discovery batch is not empty')
      if (input.items.length > 0) {
        await client.pendingReplaceItem.createMany({
          data: input.items.map((item) => ({
            batchId: input.batchId,
            artworkId: item.artworkId,
            externalId: item.externalId,
            artworkTitle: item.artworkTitle,
            artistName: item.artistName,
            sourceDirectory: item.sourceDirectory,
            sourceDirectoryName: item.sourceDirectoryName,
            targetDirectory: item.targetDirectory,
            status: item.status,
            included: item.included,
            fingerprint: item.fingerprint,
            sourceManifest: item.sourceManifest as unknown as Prisma.InputJsonValue,
            oldMediaSnapshot: item.oldMediaSnapshot as unknown as Prisma.InputJsonValue,
            newMediaSnapshot: item.newMediaSnapshot as unknown as Prisma.InputJsonValue,
            targetFileSnapshot: item.targetFileSnapshot as unknown as Prisma.InputJsonValue,
            warnings: item.warnings as unknown as Prisma.InputJsonValue,
            error: item.error
          }))
        })
      }
      const readyItems = input.items.filter((item) => item.status === 'READY').length
      const updated = await client.pendingReplaceBatch.updateMany({
        where: { id: input.batchId, status: 'DISCOVERING' },
        data: {
          status: 'PREVIEWED',
          sourceRoot: '/pending-replaces',
          totalItems: input.items.length,
          readyItems,
          invalidItems: input.items.length - readyItems,
          excludedItems: 0,
          succeededItems: 0,
          failedItems: 0,
          restoredItems: 0,
          backupBytes: 0,
          finishedAt: input.now
        }
      })
      if (updated.count !== 1)
        throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Discovery batch status changed')
    },
    async checkpointBatch(transaction, input) {
      const client = prismaTransaction(transaction)
      if (input.systemJobId) {
        const operation = await client.pendingReplaceOperation.findUnique({ where: { systemJobId: input.systemJobId } })
        if (!operation || operation.batchId !== input.batchId) {
          throw new PendingReplacePermanentError('INVALID_OPERATION', 'Queue operation no longer owns the batch')
        }
      }
      const updated = await client.pendingReplaceBatch.updateMany({
        where: { id: input.batchId, status: { in: input.expectedStatuses } },
        data: {
          status: input.status,
          ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
          ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
          ...(input.counters
            ? {
                totalItems: input.counters.totalItems,
                readyItems: input.counters.readyItems,
                invalidItems: input.counters.invalidItems,
                excludedItems: input.counters.excludedItems,
                succeededItems: input.counters.succeededItems,
                failedItems: input.counters.failedItems,
                restoredItems: input.counters.restoredItems,
                backupBytes: BigInt(input.counters.backupBytes)
              }
            : {})
        }
      })
      if (updated.count !== 1)
        throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Pending batch checkpoint CAS failed')
    },
    async checkpointItem(transaction, input) {
      const client = prismaTransaction(transaction)
      await checkpointItem(client, input)
    },
    async publishReplacement(transaction, input) {
      const client = prismaTransaction(transaction)
      await assertPersistedItem(client, input.item, ['COMMITTING'])
      await assertMediaSnapshot(client, input.item, input.expectedOldMedia)
      await replaceMedia(client, input.item.artworkId!, input.newMedia)
      await appendManualTags(client, input.item.artworkId!, input.appendTagIds)
      await syncDerivedMediaTags(client, input.item.artworkId!, input.newMedia)
      await checkpointItem(client, {
        itemId: input.item.id,
        expectedStatuses: ['COMMITTING'],
        status: 'ARCHIVING',
        backupDirectory: input.backupDirectory,
        completedDirectory: input.completedDirectory,
        finishedAt: null,
        backupBytesIncrement: input.backupBytes
      })
    },
    async publishRestore(transaction, input) {
      const client = prismaTransaction(transaction)
      await assertPersistedItem(client, input.item, ['RESTORE_SWAPPING'])
      await assertMediaSnapshot(client, input.item, input.expectedNewMedia)
      await replaceMedia(client, input.item.artworkId!, input.oldMedia)
      await syncDerivedMediaTags(client, input.item.artworkId!, input.oldMedia)
      await checkpointItem(client, {
        itemId: input.item.id,
        expectedStatuses: ['RESTORE_SWAPPING'],
        status: 'RESTORE_COMMITTED',
        finishedAt: input.now
      })
    },
    async assertMediaSnapshot(transaction, input) {
      await assertPersistedItem(prismaTransaction(transaction), input.item, [
        input.item.status,
        'SUCCESS',
        'CLEANING_BACKUP'
      ])
      await assertMediaSnapshot(prismaTransaction(transaction), input.item, input.expectedMedia)
    },
    async countBatch(batchId) {
      const [batch, groups] = await Promise.all([
        database.pendingReplaceBatch.findUnique({ where: { id: batchId }, select: { backupBytes: true } }),
        database.pendingReplaceItem.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } })
      ])
      if (!batch)
        throw new PendingReplacePermanentError('INVALID_OPERATION', 'Pending replacement batch does not exist')
      const counts = new Map(groups.map((group) => [group.status, group._count._all]))
      const count = (...statuses: Array<(typeof groups)[number]['status']>) =>
        statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0)
      return {
        totalItems: groups.reduce((sum, group) => sum + group._count._all, 0),
        readyItems: count('READY'),
        invalidItems: count('INVALID'),
        excludedItems: count('EXCLUDED'),
        succeededItems: count('SUCCESS', 'BACKUP_CLEANED'),
        failedItems: count('FAILED'),
        restoredItems: count('RESTORED'),
        backupBytes: bigintToSafeNumber(batch.backupBytes, 'batch.backupBytes') ?? 0
      }
    }
  }
}

async function assertOperation(
  client: Prisma.TransactionClient,
  systemJobId: string,
  batchId: string,
  mode: 'DISCOVER' | 'BATCH' | 'RESTORE' | 'CLEANUP'
) {
  const operation = await client.pendingReplaceOperation.findUnique({ where: { systemJobId } })
  if (!operation || operation.batchId !== batchId || operation.mode !== mode) {
    throw new PendingReplacePermanentError('INVALID_OPERATION', 'Operation ownership changed')
  }
}

async function assertPersistedItem(
  client: Prisma.TransactionClient,
  expected: PendingReplaceItemSnapshot,
  statuses: PendingReplaceItemSnapshot['status'][]
) {
  const item = await client.pendingReplaceItem.findUnique({ where: { id: expected.id }, select: itemSelect })
  if (
    !item ||
    item.batchId !== expected.batchId ||
    item.artworkId !== expected.artworkId ||
    item.targetDirectory !== expected.targetDirectory ||
    item.sourceDirectory !== expected.sourceDirectory ||
    item.fingerprint !== expected.fingerprint ||
    !statuses.includes(item.status)
  ) {
    throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Pending item ownership or checkpoint changed')
  }
}

async function assertMediaSnapshot(
  client: Prisma.TransactionClient,
  item: PendingReplaceItemSnapshot,
  expected: PendingReplaceMediaSnapshot[]
) {
  if (!item.artworkId) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Pending item has no artwork')
  const images = await client.image.findMany({
    where: { artworkId: item.artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { path: true, sortOrder: true, width: true, height: true, size: true, mediaType: true, chaptersPath: true }
  })
  const normalizedExpected = [...expected].sort((left, right) => left.order - right.order)
  if (
    images.length !== normalizedExpected.length ||
    images.some((image, index) => {
      const snapshot = normalizedExpected[index]!
      return (
        normalizePath(image.path) !== normalizePath(snapshot.path) ||
        image.sortOrder !== snapshot.order ||
        bigintToSafeNumber(image.size, 'image.size') !== (snapshot.databaseSize ?? snapshot.size) ||
        image.width !== snapshot.width ||
        image.height !== snapshot.height ||
        image.mediaType !== (snapshot.mediaType ?? 'UNKNOWN') ||
        normalizeNullablePath(image.chaptersPath) !== normalizeNullablePath(snapshot.chaptersPath)
      )
    })
  ) {
    throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Artwork media no longer matches the frozen snapshot')
  }
}

async function replaceMedia(client: Prisma.TransactionClient, artworkId: number, media: PendingReplaceMediaSnapshot[]) {
  await client.image.deleteMany({ where: { artworkId } })
  if (media.length === 0) return
  await client.image.createMany({
    data: [...media]
      .sort((left, right) => left.order - right.order)
      .map((entry) => ({
        artworkId,
        path: entry.path,
        sortOrder: entry.order,
        width: entry.width,
        height: entry.height,
        size: BigInt(entry.size),
        mediaType: entry.mediaType ?? 'UNKNOWN',
        chaptersPath: entry.chaptersPath ?? null
      }))
  })
}

async function appendManualTags(client: Prisma.TransactionClient, artworkId: number, tagIds: number[]) {
  if (tagIds.length === 0) return
  const tags = await client.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } })
  if (tags.length > 0) {
    await client.artworkTag.createMany({
      data: tags.map((tag) => ({ artworkId, tagId: tag.id, provenance: 'MANUAL' as const })),
      skipDuplicates: true
    })
  }
}

async function syncDerivedMediaTags(
  client: Prisma.TransactionClient,
  artworkId: number,
  media: PendingReplaceMediaSnapshot[]
) {
  const definitions = [
    {
      key: 'media:webp',
      name: 'webp',
      wanted: media.some((entry) => entry.path.toLocaleLowerCase('en-US').endsWith('.webp'))
    },
    { key: 'media:video', name: 'video', wanted: media.some((entry) => entry.mediaType === 'VIDEO') },
    { key: 'media:image', name: 'image', wanted: !media.some((entry) => entry.mediaType === 'VIDEO') }
  ]
  for (const definition of definitions) {
    let tag = await client.tag.findFirst({
      where: { OR: [{ systemKey: definition.key }, { namespace: 'general', name: definition.name }] },
      select: { id: true }
    })
    if (!tag) {
      tag = await client.tag.create({
        data: { name: definition.name, namespace: 'general', isSystem: true, systemKey: definition.key },
        select: { id: true }
      })
    } else {
      tag = await client.tag.update({
        where: { id: tag.id },
        data: { name: definition.name, namespace: 'general', isSystem: true, systemKey: definition.key },
        select: { id: true }
      })
    }
    if (definition.wanted) {
      await client.artworkTag.createMany({
        data: [{ artworkId, tagId: tag.id, provenance: 'DERIVED' }],
        skipDuplicates: true
      })
    } else {
      await client.artworkTag.deleteMany({ where: { artworkId, tagId: tag.id } })
    }
  }
}

async function checkpointItem(client: Prisma.TransactionClient, input: PendingReplaceItemCheckpoint) {
  const updated = await client.pendingReplaceItem.updateMany({
    where: { id: input.itemId, status: { in: input.expectedStatuses } },
    data: {
      status: input.status,
      ...(input.error !== undefined ? { error: sanitizeSummary(input.error) } : {}),
      ...(input.backupDirectory !== undefined ? { backupDirectory: input.backupDirectory } : {}),
      ...(input.completedDirectory !== undefined ? { completedDirectory: input.completedDirectory } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {})
    }
  })
  if (updated.count !== 1)
    throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Pending item checkpoint CAS failed')
  if (input.backupBytesIncrement) {
    const item = await client.pendingReplaceItem.findUnique({ where: { id: input.itemId }, select: { batchId: true } })
    if (!item) throw new PendingReplacePermanentError('DATABASE_CHANGED', 'Pending item disappeared')
    await client.pendingReplaceBatch.update({
      where: { id: item.batchId },
      data: { backupBytes: { increment: BigInt(input.backupBytesIncrement) } }
    })
  }
}

function mapItem(item: Prisma.PendingReplaceItemGetPayload<{ select: typeof itemSelect }>): PendingReplaceItemSnapshot {
  return { ...item }
}

function prismaTransaction(transaction: PendingPrismaTransaction): Prisma.TransactionClient {
  return transaction as unknown as Prisma.TransactionClient
}

function bigintToSafeNumber(value: bigint | null, label: string): number | null {
  if (value === null) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`${label} exceeds the safe integer range`)
  return number
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLocaleLowerCase('en-US')
}

function normalizeNullablePath(value: string | null | undefined) {
  return value ? normalizePath(value) : null
}

function sanitizeSummary(value: string | null): string | null {
  if (value === null) return null
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 240)
}
