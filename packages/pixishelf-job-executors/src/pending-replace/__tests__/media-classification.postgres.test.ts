import type { InitialMediaType as MediaType } from '@pixishelf/job-contracts'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { createPrismaPendingReplaceDatabase } from '../prisma-database.ts'
import type { PendingReplaceMediaSnapshot } from '../types.ts'

const databaseUrl = process.env.PIXISHELF_TEST_DATABASE_URL ?? process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const describePostgres = databaseUrl ? describe : describe.skip
const prefix = `media-classification-${randomUUID()}`
const database = databaseUrl ? createDatabaseClient({ datasourceUrl: databaseUrl }) : null

describePostgres('pending media classification publication and frozen snapshot compatibility', () => {
  afterAll(async () => {
    if (!database) return
    await database.pendingReplaceBatch.deleteMany({ where: { id: { startsWith: prefix } } })
    await database.image.deleteMany({ where: { artwork: { title: { startsWith: prefix } } } })
    await database.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await disconnectDatabase(database)
  })

  it.each(['IMAGE', 'ANIMATION'] as const)(
    'publishes %s WebP snapshots pending, accepts content correction, restores frozen old type',
    async (kind) => {
      const { port, item, oldMedia, newMedia, artworkId } = await fixture('webp', kind)
      await db().$transaction((tx) =>
        port.publishReplacement(tx, {
          item,
          expectedOldMedia: [oldMedia],
          newMedia: [newMedia],
          appendTagIds: [],
          backupDirectory: '/backup',
          completedDirectory: '/completed',
          now: new Date(),
          backupBytes: 10
        })
      )
      expect(await db().image.findFirstOrThrow({ where: { artworkId } })).toMatchObject({
        mediaType: kind,
        webpAnimationStatus: 0
      })
      await db().image.updateMany({
        where: { artworkId },
        data: { mediaType: kind === 'IMAGE' ? 'ANIMATION' : 'IMAGE', webpAnimationStatus: kind === 'IMAGE' ? 2 : 1 }
      })
      await db().pendingReplaceItem.update({ where: { id: item.id }, data: { status: 'RESTORE_SWAPPING' } })
      const [restoring] = await port.loadItems(item.batchId)
      await db().$transaction((tx) =>
        port.publishRestore(tx, {
          item: restoring!,
          expectedNewMedia: [newMedia],
          oldMedia: [oldMedia],
          now: new Date()
        })
      )
      expect(await db().image.findFirstOrThrow({ where: { artworkId } })).toMatchObject({
        path: oldMedia.path,
        mediaType: 'ANIMATION',
        webpAnimationStatus: 0
      })
    }
  )

  it.each([
    ['webp', 'IMAGE', 0, 'ANIMATION'],
    ['webp', 'IMAGE', null, 'ANIMATION'],
    ['webp', 'IMAGE', 2, 'ANIMATION'],
    ['webp', 'VIDEO', 1, 'ANIMATION'],
    ['jpg', 'IMAGE', 1, 'ANIMATION'],
    ['webp', 'IMAGE', 1, 'VIDEO']
  ] as const)(
    'rejects unexplained frozen type change: %s %s %s from %s',
    async (extension, currentKind, status, frozenKind) => {
      const { port, item, oldMedia, artworkId } = await fixture(extension, 'IMAGE')
      await db().image.updateMany({
        where: { artworkId },
        data: { mediaType: currentKind, webpAnimationStatus: status }
      })
      await expect(
        db().$transaction((tx) =>
          port.assertMediaSnapshot(tx, {
            item,
            expectedMedia: [{ ...oldMedia, mediaType: frozenKind }]
          })
        )
      ).rejects.toThrow('frozen snapshot')
    }
  )

  it('keeps geometry checks strict even when content classification is confirmed', async () => {
    const { port, item, oldMedia, artworkId } = await fixture('webp', 'IMAGE')
    await db().image.updateMany({
      where: { artworkId },
      data: { mediaType: 'IMAGE', webpAnimationStatus: 1, width: 99 }
    })
    await expect(
      db().$transaction((tx) => port.assertMediaSnapshot(tx, { item, expectedMedia: [oldMedia] }))
    ).rejects.toThrow('frozen snapshot')
  })

  it.each([false, true])('accepts equivalent stored paths with database leading slash = %s', async (leadingSlash) => {
    const { port, item, oldMedia, newMedia, artworkId } = await fixture('webp', 'IMAGE')
    const chaptersPath = `${oldMedia.path}.chapters.json`
    await db().image.updateMany({
      where: { artworkId },
      data: {
        path: leadingSlash ? `/${oldMedia.path}` : oldMedia.path,
        chaptersPath: leadingSlash ? `/${chaptersPath}` : chaptersPath
      }
    })
    await db().$transaction((tx) =>
      port.publishReplacement(tx, {
        item,
        expectedOldMedia: [
          {
            ...oldMedia,
            path: leadingSlash ? oldMedia.path : `/${oldMedia.path}`,
            chaptersPath: leadingSlash ? chaptersPath : `/${chaptersPath}`
          }
        ],
        newMedia: [newMedia],
        appendTagIds: [],
        backupDirectory: '/backup',
        completedDirectory: '/completed',
        now: new Date(),
        backupBytes: 10
      })
    )
    expect(await db().image.findFirstOrThrow({ where: { artworkId } })).toMatchObject({ path: newMedia.path })
  })

  it.each(['path', 'chaptersPath'] as const)('rejects a real %s change despite leading slash normalization', async (field) => {
    const { port, item, oldMedia, artworkId } = await fixture('webp', 'IMAGE')
    await db().image.updateMany({
      where: { artworkId },
      data: { [field]: `/different/${field === 'path' ? 'old.webp' : 'chapters.json'}` }
    })
    await expect(
      db().$transaction((tx) =>
        port.assertMediaSnapshot(tx, {
          item,
          expectedMedia: [{ ...oldMedia, path: `/${oldMedia.path}` }]
        })
      )
    ).rejects.toThrow('frozen snapshot')
  })
})

async function fixture(extension: string, kind: MediaType) {
  const id = `${prefix}-${randomUUID()}`
  const artwork = await db().artwork.create({ data: { title: id } })
  const oldMedia = media(`old.${extension}`, 'ANIMATION')
  const newMedia = media(`new.${extension}`, kind)
  await db().image.create({
    data: {
      artworkId: artwork.id,
      path: oldMedia.path,
      sortOrder: 0,
      size: 10n,
      width: 0,
      height: 0,
      mediaType: 'ANIMATION'
    }
  })
  const batch = await db().pendingReplaceBatch.create({ data: { id, sourceRoot: '/pending-replaces' } })
  await db().pendingReplaceItem.create({
    data: {
      id,
      batchId: batch.id,
      artworkId: artwork.id,
      sourceDirectory: '/pending-replaces/fixture',
      sourceDirectoryName: 'fixture',
      targetDirectory: '/media/fixture',
      status: 'COMMITTING',
      fingerprint: 'fixture',
      sourceManifest: [],
      oldMediaSnapshot: [{ ...oldMedia }],
      newMediaSnapshot: [{ ...newMedia }],
      targetFileSnapshot: [],
      warnings: []
    }
  })
  const port = createPrismaPendingReplaceDatabase(db())
  const [item] = await port.loadItems(batch.id)
  return { port, item: item!, oldMedia, newMedia, artworkId: artwork.id }
}
function media(name: string, mediaType: MediaType): PendingReplaceMediaSnapshot {
  return {
    sourceName: name,
    targetName: name,
    path: `${prefix}/${name}`,
    size: 10,
    sha256: 'a'.repeat(64),
    width: 0,
    height: 0,
    order: 0,
    mtimeMs: 0,
    mediaType
  }
}
function db() {
  if (!database) throw new Error('isolated PostgreSQL required')
  return database
}
