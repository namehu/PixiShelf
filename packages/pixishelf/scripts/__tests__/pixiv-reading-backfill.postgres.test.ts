// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { backfillStatements, snapshotQuery, type ReadingBackfillSnapshot } from '../pixiv-reading-backfill-sql'

const url = process.env.READING_VALIDATION_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe : describe.skip
afterAll(async () => { await db?.$disconnect() })

suite('Pixiv historical reading backfill', () => {
  it('preserves visits, groups media, skips changed snapshots and other sources, and rolls back atomically', async () => {
    const client = db!
    const userId = randomUUID()
    await client.userBA.create({ data: { id: userId } })
    const ids: number[] = []
    try {
      for (const createdVia of ['PIXIV_SCAN', 'PIXIV_SCAN', 'PIXIV_SCAN', 'URL_ARCHIVE'] as const) {
        const artwork = await client.artwork.create({ data: { title: userId, createdVia } })
        ids.push(artwork.id)
        await client.image.createMany({ data: [
          { artworkId: artwork.id, path: `${artwork.id}/a.apng`, sortOrder: 0 },
          { artworkId: artwork.id, path: `${artwork.id}/a.mp4`, mediaType: 'VIDEO', sortOrder: 1 },
          { artworkId: artwork.id, path: `${artwork.id}/b.jpg`, sortOrder: 2 }
        ] })
      }
      const [existingId, changedId, newId, archiveId] = ids as [number, number, number, number]
      const date = new Date('2026-01-01T00:00:00Z')
      const media = await client.image.findFirstOrThrow({ where: { artworkId: existingId } })
      await client.artworkReadMedia.create({ data: { userId, artworkId: existingId, mediaId: media.id } })
      await client.artworkReadingSummary.create({ data: {
        userId, artworkId: existingId, viewCount: 7, seenCount: 1, totalCount: 2, stateVersion: 4,
        lastViewedAt: date, lastActiveAt: date, lastMediaId: media.id, lastMediaIndex: 0
      } })
      const before = await client.$queryRawUnsafe<ReadingBackfillSnapshot[]>(snapshotQuery(userId, existingId - 1, archiveId))
      expect(before).toHaveLength(3)
      await client.artwork.update({ where: { id: changedId }, data: { mediaRevision: { increment: 1 } } })
      const statements = backfillStatements(userId, before)
      const apply = (fail: boolean) => client.$transaction(async (tx) => {
        for (const statement of statements.slice(0, -1)) await tx.$executeRawUnsafe(statement)
        const result = await tx.$queryRawUnsafe(statements.at(-1)!)
        if (fail) throw new Error('forced rollback')
        return result
      })
      await expect(apply(true)).rejects.toThrow('forced rollback')
      expect(await client.artworkReadMedia.count({ where: { userId } })).toBe(1)
      expect(await apply(false)).toEqual([{ planned: 3, eligible: 2, insertedMedia: 5, updatedSummaries: 2 }])
      expect(await client.artworkReadingSummary.findUnique({ where: { userId_artworkId: { userId, artworkId: existingId } } })).toMatchObject({
        viewCount: 7, seenCount: 2, totalCount: 2, stateVersion: 5,
        lastViewedAt: date, lastActiveAt: date, lastMediaId: media.id, lastMediaIndex: 0
      })
      expect(await client.artworkReadingSummary.findUnique({ where: { userId_artworkId: { userId, artworkId: newId } } })).toMatchObject({
        viewCount: 0, seenCount: 2, totalCount: 2, lastViewedAt: null, lastActiveAt: null
      })
      expect(await client.artworkReadingSummary.count({ where: { userId, artworkId: { in: [changedId, archiveId] } } })).toBe(0)
      expect(await apply(false)).toEqual([{ planned: 3, eligible: 0, insertedMedia: 0, updatedSummaries: 0 }])
      const after = await client.$queryRawUnsafe<ReadingBackfillSnapshot[]>(snapshotQuery(userId, existingId - 1, archiveId))
      const unchanged = backfillStatements(userId, after.filter(({ id }) => id !== changedId))
      const result = await client.$transaction(async (tx) => {
        for (const statement of unchanged.slice(0, -1)) await tx.$executeRawUnsafe(statement)
        return tx.$queryRawUnsafe(unchanged.at(-1)!)
      })
      expect(result).toEqual([{ planned: 2, eligible: 2, insertedMedia: 0, updatedSummaries: 0 }])
    } finally {
      await client.artwork.deleteMany({ where: { id: { in: ids } } })
      await client.userBA.delete({ where: { id: userId } })
    }
  })
})
