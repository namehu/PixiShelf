import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { createPrismaPendingReplaceDatabase } from '../prisma-database.ts'
import type { PendingReplaceMediaSnapshot } from '../types.ts'

const databaseUrl =
  process.env.PIXISHELF_TEST_DATABASE_URL ??
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ??
  (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const prefix = `reading-pending-replace-${randomUUID()}`
const database = databaseUrl ? createDatabaseClient({ datasourceUrl: databaseUrl }) : null

describePostgres('pending replacement reading invalidation', () => {
  afterAll(async () => {
    if (!database) return
    await database.pendingReplaceBatch.deleteMany({ where: { id: { startsWith: prefix } } })
    await database.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await database.userBA.deleteMany({ where: { id: { startsWith: prefix } } })
    await disconnectDatabase(database)
  })

  it('invalidates on publish and restore, and rolls back a failed snapshot check', async () => {
    const userId = `${prefix}-user`
    await db().userBA.create({ data: { id: userId, name: userId } })
    const artwork = await db().artwork.create({ data: { title: `${prefix}-artwork` } })
    const oldMedia = media('old.jpg', 0)
    const newMedia = media('new.jpg', 0)
    const original = await db().image.create({
      data: {
        artworkId: artwork.id,
        path: oldMedia.path,
        sortOrder: 0,
        size: BigInt(oldMedia.size),
        width: oldMedia.width,
        height: oldMedia.height,
        mediaType: 'IMAGE'
      }
    })
    await markRead(userId, artwork.id, original.id)

    const batch = await db().pendingReplaceBatch.create({ data: { id: `${prefix}-batch`, sourceRoot: '/pending-replaces' } })
    await db().pendingReplaceItem.create({
      data: {
        id: `${prefix}-item`,
        batchId: batch.id,
        artworkId: artwork.id,
        sourceDirectory: '/pending-replaces/fixture',
        sourceDirectoryName: 'fixture',
        targetDirectory: '/media/fixture',
        status: 'COMMITTING',
        fingerprint: 'reading-fixture',
        sourceManifest: [],
        oldMediaSnapshot: [{ ...oldMedia }],
        newMediaSnapshot: [{ ...newMedia }],
        targetFileSnapshot: [],
        warnings: []
      }
    })
    const port = createPrismaPendingReplaceDatabase(db())
    const [initialItem] = await port.loadItems(batch.id)
    if (!initialItem) throw new Error('pending replacement fixture missing')

    await expect(
      db().$transaction((tx) =>
        port.publishReplacement(tx, {
          item: initialItem,
          expectedOldMedia: [{ ...oldMedia, path: `${prefix}/wrong.jpg` }],
          newMedia: [newMedia],
          appendTagIds: [],
          backupDirectory: '/backup/fixture',
          completedDirectory: '/completed/fixture',
          now: new Date(),
          backupBytes: 10
        })
      )
    ).rejects.toThrow('frozen snapshot')
    await expectRevisionAndReading(artwork.id, 1, 1)

    await db().$transaction((tx) =>
      port.publishReplacement(tx, {
        item: initialItem,
        expectedOldMedia: [oldMedia],
        newMedia: [newMedia],
        appendTagIds: [],
        backupDirectory: '/backup/fixture',
        completedDirectory: '/completed/fixture',
        now: new Date(),
        backupBytes: 10
      })
    )
    await expectRevisionAndReading(artwork.id, 2, 0)
    const installed = await db().image.findFirstOrThrow({ where: { artworkId: artwork.id } })
    expect(installed.path).toBe(newMedia.path)

    await markRead(userId, artwork.id, installed.id)
    await db().pendingReplaceItem.update({ where: { id: initialItem.id }, data: { status: 'RESTORE_SWAPPING' } })
    const [restoreItem] = await port.loadItems(batch.id)
    if (!restoreItem) throw new Error('restore fixture missing')
    await db().$transaction((tx) =>
      port.publishRestore(tx, { item: restoreItem, expectedNewMedia: [newMedia], oldMedia: [oldMedia], now: new Date() })
    )
    await expectRevisionAndReading(artwork.id, 3, 0)
    expect(await db().image.findFirstOrThrow({ where: { artworkId: artwork.id }, select: { path: true } })).toEqual({
      path: oldMedia.path
    })
  })
})

function db() {
  if (!database) throw new Error('isolated PostgreSQL URL required')
  return database
}

function media(name: string, order: number): PendingReplaceMediaSnapshot {
  return {
    sourceName: name,
    targetName: name,
    path: `${prefix}/${name}`,
    size: 10,
    sha256: 'fixture',
    width: 0,
    height: 0,
    order,
    mtimeMs: 0,
    mediaType: 'IMAGE'
  }
}

async function markRead(userId: string, artworkId: number, mediaId: number) {
  const now = new Date('2026-09-24T08:00:00.000Z')
  await db().artworkReadingSummary.create({
    data: { userId, artworkId, viewCount: 1, seenCount: 1, totalCount: 1, lastViewedAt: now, lastActiveAt: now, lastMediaId: mediaId }
  })
  await db().artworkReadMedia.create({ data: { userId, artworkId, mediaId } })
}

async function expectRevisionAndReading(artworkId: number, revision: number, records: number) {
  expect(await db().artwork.findUniqueOrThrow({ where: { id: artworkId }, select: { mediaRevision: true } })).toEqual({
    mediaRevision: revision
  })
  expect(await db().artworkReadingSummary.count({ where: { artworkId } })).toBe(records)
  expect(await db().artworkReadMedia.count({ where: { artworkId } })).toBe(records)
}
