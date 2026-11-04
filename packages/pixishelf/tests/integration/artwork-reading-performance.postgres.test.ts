// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
const databaseUrl = process.env.READING_VALIDATION_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    url.pathname !== '/pixishelf_reading_position_20261104_runtime'
  ) {
    throw new Error('Requires isolated reading-position runtime database')
  }
}
const db = databaseUrl
  ? new PrismaClient({ datasourceUrl: databaseUrl, log: [{ emit: 'event', level: 'query' }] })
  : null
const ctx = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return ctx.db
  }
}))
import { reportReading } from '@/services/reading-service'
const token = `reading-bounded-${randomUUID()}`
const queries: Array<{ query: string; params: string }> = []
db?.$on('query', (event) => queries.push({ query: event.query, params: event.params }))
describe.skipIf(!databaseUrl).sequential('batch-scaled reading report queries', () => {
  beforeAll(async () => {
    ctx.db = db
    await db!.userBA.create({ data: { id: token } })
  })
  afterAll(async () => {
    if (!db) return
    await db.image.deleteMany({ where: { artwork: { storageKey: { startsWith: token } } } })
    await db.artwork.deleteMany({ where: { storageKey: { startsWith: token } } })
    await db.userBA.delete({ where: { id: token } })
    await db.$disconnect()
  })
  it.each([100, 1000, 10000])(
    'returns only two media anchors and one progress row with %i logical items',
    async (count) => {
      const a = await db!.artwork.create({
        data: { title: `${token}-${count}`, storageKey: `${token}-${count}`, logicalMediaCount: count }
      })
      await db!.$executeRawUnsafe(
        `INSERT INTO "Image" ("artworkId",path,"sortOrder","mediaType","updatedAt") SELECT $1,$2 || g || '.jpg',g,'IMAGE'::"MediaType",NOW() FROM generate_series(0,$3::int-1) g`,
        a.id,
        `${token}/`,
        count
      )
      const images = await db!.image.findMany({
        where: { artworkId: a.id },
        orderBy: { sortOrder: 'asc' },
        take: 2,
        select: { id: true }
      })
      queries.length = 0
      const result = await reportReading(token, {
        artworkId: a.id,
        expectedUserId: token,
        readingLayoutVersion: 1,
        events: images.map(({ id }, index) => ({
          type: 'VIEW',
          mediaId: id,
          index,
          observedAt: new Date().toISOString()
        }))
      })
      const mediaReads = queries.filter(
        ({ query }) => query.startsWith('SELECT') && query.includes('FROM "public"."Image"')
      )
      expect(mediaReads).toHaveLength(1)
      expect(mediaReads[0]!.query).toContain('"id" IN')
      expect(mediaReads[0]!.query).not.toContain('ORDER BY')
      expect(JSON.parse(mediaReads[0]!.params).slice(0, 3)).toEqual([a.id, ...images.map(({ id }) => id)])
      const progressReads = queries.filter(
        ({ query }) => query.startsWith('SELECT') && query.includes('FROM "public"."artwork_reading_progress"')
      )
      expect(progressReads).toHaveLength(1)
      expect(result.summary).toMatchObject({ totalCount: count, progressCount: 2 })
      expect(JSON.stringify(result).length).toBeLessThan(650)
      expect(await db!.artworkReadingProgress.count({ where: { artworkId: a.id } })).toBe(1)
      process.stdout.write(
        JSON.stringify({
          logicalMediaCount: count,
          mediaAnchors: images.length,
          progressRows: 1,
          queryCount: queries.length - 1,
          responseBytes: JSON.stringify(result).length
        }) + '\n'
      )
    },
    30_000
  )
})
