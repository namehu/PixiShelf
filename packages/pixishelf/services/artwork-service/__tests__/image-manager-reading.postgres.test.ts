import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { addImage, deleteImage, reorderArtworkImages, updateArtworkImagesWithTransactionClient } from '../image-manager'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const prefix = `reading-media-rebuild-${randomUUID()}`
const database = databaseUrl ? createDatabaseClient({ datasourceUrl: databaseUrl }) : null

describePostgres('complete media replacement reading invalidation', () => {
  afterAll(async () => {
    if (!database) return
    await database.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await database.userBA.deleteMany({ where: { id: { startsWith: prefix } } })
    await disconnectDatabase(database)
  })

  it('clears every account and increments the revision in the same publish transaction', async () => {
    const { artworkId, oldMediaId } = await seedReadingState('publish')

    await db().$transaction(async (tx) => {
      await updateArtworkImagesWithTransactionClient(tx, artworkId, [
        { fileName: 'new.jpg', order: 0, width: 100, height: 100, size: 512, path: `${prefix}/new.jpg` }
      ])
    })

    expect(await db().artwork.findUniqueOrThrow({ where: { id: artworkId }, select: { mediaRevision: true } })).toEqual({
      mediaRevision: 2
    })
    expect(await db().artworkReadingSummary.count({ where: { artworkId } })).toBe(0)
    expect(await db().artworkReadMedia.count({ where: { artworkId } })).toBe(0)
    expect(await db().image.findMany({ where: { artworkId }, select: { path: true } })).toEqual([
      { path: `${prefix}/new.jpg` }
    ])
    expect(await db().image.findUnique({ where: { id: oldMediaId } })).toBeNull()
  })

  it('rolls back the revision, reading records, and media when publication fails', async () => {
    const { artworkId, oldMediaId } = await seedReadingState('rollback')

    await expect(
      db().$transaction(async (tx) => {
        await updateArtworkImagesWithTransactionClient(tx, artworkId, [
          { fileName: 'replacement.jpg', order: 0, width: 100, height: 100, size: 512, path: `${prefix}/rollback-new.jpg` }
        ])
        throw new Error('publication failed')
      })
    ).rejects.toThrow('publication failed')

    expect(await db().artwork.findUniqueOrThrow({ where: { id: artworkId }, select: { mediaRevision: true } })).toEqual({
      mediaRevision: 1
    })
    expect(await db().artworkReadingSummary.count({ where: { artworkId } })).toBe(2)
    expect(await db().artworkReadMedia.count({ where: { artworkId } })).toBe(2)
    expect(await db().image.findUnique({ where: { id: oldMediaId }, select: { id: true } })).toEqual({ id: oldMediaId })
  })

  it('keeps reading visits through ordinary add, reorder, and single-media delete', async () => {
    const { artworkId, oldMediaId } = await seedReadingState('incremental')
    const added = await addImage(artworkId, {
      fileName: 'added.jpg',
      order: 1,
      width: 100,
      height: 100,
      size: 512,
      path: `${prefix}/incremental-added.jpg`
    })
    await reorderArtworkImages({ artworkId, expectedImageIds: [oldMediaId, added.id], imageIds: [added.id, oldMediaId] })
    await deleteImage(oldMediaId, false)

    expect(await db().artwork.findUniqueOrThrow({ where: { id: artworkId }, select: { mediaRevision: true } })).toEqual({
      mediaRevision: 1
    })
    const summaries = await db().artworkReadingSummary.findMany({ where: { artworkId }, select: { viewCount: true } })
    expect(summaries).toEqual([{ viewCount: 3 }, { viewCount: 3 }])
    expect(await db().artworkReadMedia.count({ where: { artworkId } })).toBe(0)
  })
})

function db() {
  if (!database) throw new Error('isolated PostgreSQL URL required')
  return database
}

async function seedReadingState(label: string) {
  const artwork = await db().artwork.create({ data: { title: `${prefix}-${label}` } })
  const oldMedia = await db().image.create({ data: { artworkId: artwork.id, path: `${prefix}/${label}-old.jpg` } })
  const now = new Date('2026-09-24T08:00:00.000Z')
  for (const account of ['a', 'b']) {
    const userId = `${prefix}-${label}-${account}`
    await db().userBA.create({ data: { id: userId, name: userId } })
    await db().artworkReadingSummary.create({
      data: {
        userId,
        artworkId: artwork.id,
        viewCount: 3,
        seenCount: 1,
        totalCount: 1,
        lastViewedAt: now,
        lastActiveAt: now,
        lastMediaId: oldMedia.id,
        lastMediaIndex: 0
      }
    })
    await db().artworkReadMedia.create({ data: { userId, artworkId: artwork.id, mediaId: oldMedia.id } })
  }
  return { artworkId: artwork.id, oldMediaId: oldMedia.id }
}
