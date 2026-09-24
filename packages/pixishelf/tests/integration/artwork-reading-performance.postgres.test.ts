// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

const databaseUrl = process.env.READING_VALIDATION_DATABASE_URL
function isDedicatedDatabase(value: string | undefined) {
  if (!value) return false
  const url = new URL(value)
  return url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55432' && url.pathname === '/reading_perf'
}
if (databaseUrl && !isDedicatedDatabase(databaseUrl)) throw new Error('Reading performance test requires the dedicated reading_perf database')

const db = databaseUrl
  ? new PrismaClient({ datasourceUrl: databaseUrl, log: [{ level: 'query', emit: 'event' }] })
  : null
const context = vi.hoisted(() => ({ prisma: null as unknown }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return context.prisma } }))

let artworkService: typeof import('@/services/artwork-service')
let readingService: typeof import('@/services/reading-service')
let readingPage: typeof import('@/services/artwork-service/reading-page-query')
beforeAll(async () => {
  context.prisma = db
  ;[artworkService, readingService, readingPage] = await Promise.all([
    import('@/services/artwork-service'),
    import('@/services/reading-service'),
    import('@/services/artwork-service/reading-page-query')
  ])
})
afterAll(async () => { await db?.$disconnect() })

const prefix = 'reading-perf-v1'
const comparisonOnly = process.env.READING_PERF_COMPARISON_ONLY === '1'
const users = [`${prefix}-user-a`, `${prefix}-user-b`]
type QueryTrace = { query: string; params: string; duration: number }
const recorded: QueryTrace[] = []
let capture: QueryTrace[] | null = null
db?.$on('query', (event) => {
  if (capture) capture.push({ query: event.query, params: event.params, duration: event.duration })
})

async function measure<T>(name: string, fn: () => Promise<T>) {
  const trace: QueryTrace[] = []
  capture = trace
  const start = performance.now()
  try {
    const result = await fn()
    return { name, result, elapsedMs: Number((performance.now() - start).toFixed(2)), queryCount: trace.length, queries: trace }
  } finally {
    capture = null
    recorded.push(...trace)
  }
}

async function cleanup() {
  if (!db) return
  await db.$executeRawUnsafe(`DELETE FROM "Image" i USING "Artwork" a WHERE i."artworkId" = a.id AND a."storageKey" LIKE $1`, `${prefix}-%`)
  await db.$executeRawUnsafe(`DELETE FROM "Artwork" WHERE "storageKey" LIKE $1`, `${prefix}-%`)
  await db.$executeRawUnsafe(`DELETE FROM "Artist" WHERE name LIKE $1`, `${prefix}-%`)
  await db.$executeRawUnsafe(`DELETE FROM "Tag" WHERE name LIKE $1`, `${prefix}-%`)
  await db.userBA.deleteMany({ where: { id: { in: users } } })
}

async function seed() {
  if (!db) return
  await db.userBA.createMany({ data: users.map((id) => ({ id })) })
  await db.$executeRawUnsafe(`INSERT INTO "Artist" (name, "updatedAt") SELECT $1 || '-' || g, NOW() FROM generate_series(1,100) g`, prefix)
  const tagA = await db.tag.create({ data: { name: `${prefix}-tag-a` } })
  const tagB = await db.tag.create({ data: { name: `${prefix}-tag-b` } })
  await db.$executeRawUnsafe(`
    INSERT INTO "Artwork" (title, "storageKey", "imageCount", "sourceDate", "createdAt", "updatedAt")
    SELECT CASE WHEN g <= 30 OR g BETWEEN 30001 AND 30030 THEN 'boundary-' || g ELSE 'Artwork ' || g END,
      $1 || '-' || g,
      CASE WHEN g = 1 THEN 504 ELSE 4 END,
      CASE WHEN g % 7 = 0 THEN NULL ELSE TIMESTAMP '2024-01-01' + g * INTERVAL '1 minute' END,
      TIMESTAMP '2024-01-01' + g * INTERVAL '30 seconds', NOW()
    FROM generate_series(1,50000) g`, prefix)
  await db.$executeRawUnsafe(`
    INSERT INTO "Image" (path, "artworkId", "sortOrder", "mediaType", "updatedAt")
    SELECT '/reading-perf/' || a.id || '/' || page || '.jpg', a.id, page, 'IMAGE'::"MediaType", NOW()
    FROM "Artwork" a CROSS JOIN generate_series(0,3) page
    WHERE a."storageKey" LIKE $1`, `${prefix}-%`)
  await db.$executeRawUnsafe(`
    INSERT INTO "Image" (path, "artworkId", "sortOrder", "mediaType", "updatedAt")
    SELECT '/reading-perf/' || a.id || '/' || page || '.jpg', a.id, page, 'IMAGE'::"MediaType", NOW()
    FROM "Artwork" a CROSS JOIN generate_series(4,503) page
    WHERE a."storageKey" = $1`, `${prefix}-1`)
  await db.$executeRawUnsafe(`
    INSERT INTO artwork_artists (id, "artworkId", "artistId")
    SELECT md5($1 || ':' || a.id), a.id, ar.id
    FROM "Artwork" a
    JOIN "Artist" ar ON ar.name = $1 || '-' || ((substring(a."storageKey" FROM char_length($1) + 2)::int % 100) + 1)
    WHERE a."storageKey" LIKE $2 AND substring(a."storageKey" FROM char_length($1) + 2)::int <= 25000
      AND substring(a."storageKey" FROM char_length($1) + 2)::int % 3 = 0`, prefix, `${prefix}-%`)
  await db.$executeRawUnsafe(`
    INSERT INTO artwork_artist_evidence (id, "membershipId", "evidenceKey", provenance, present, "createdAt", "updatedAt")
    SELECT md5('evidence:' || m.id), m.id, 'READING_PERF', 'MANUAL'::"CreatorEvidenceKind", TRUE, NOW(), NOW()
    FROM artwork_artists m JOIN "Artwork" a ON a.id = m."artworkId"
    WHERE a."storageKey" LIKE $1`, `${prefix}-%`)
  await db.$executeRawUnsafe(`
    INSERT INTO "ArtworkTag" ("artworkId", "tagId")
    SELECT a.id, $2 FROM "Artwork" a WHERE a."storageKey" LIKE $1`, `${prefix}-%`, tagA.id)
  await db.$executeRawUnsafe(`
    INSERT INTO "ArtworkTag" ("artworkId", "tagId")
    SELECT a.id, $2 FROM "Artwork" a
    WHERE a."storageKey" LIKE $1 AND substring(a."storageKey" FROM char_length($3) + 2)::int % 3 = 0`, `${prefix}-%`, tagB.id, prefix)
  for (const [userIndex, userId] of users.entries()) {
    await db.$executeRawUnsafe(`
      INSERT INTO artwork_reading_summaries
        ("userId", "artworkId", "viewCount", "seenCount", "totalCount", "lastViewedAt", "lastActiveAt", "lastMediaId", "lastMediaIndex", "updatedAt")
      SELECT $2, a.id, 1 + (g % 5),
        CASE WHEN g = 1 THEN 100 WHEN $3::int = 0 AND g % 2 = 0 THEN 4 WHEN $3::int = 0 THEN 2 ELSE 1 END,
        CASE WHEN g = 1 THEN 504 ELSE 4 END,
        NOW() - (g % 7200) * INTERVAL '1 minute', NOW() - (g % 7200) * INTERVAL '1 minute',
        (SELECT i.id FROM "Image" i WHERE i."artworkId" = a.id ORDER BY i."sortOrder", i.id LIMIT 1), 0, NOW()
      FROM "Artwork" a
      CROSS JOIN LATERAL (SELECT substring(a."storageKey" FROM char_length($1) + 2)::int AS g) n
      WHERE a."storageKey" LIKE $4 AND (($3::int = 0 AND g <= 30000) OR ($3::int = 1 AND g BETWEEN 10001 AND 30000))`,
      prefix, userId, userIndex, `${prefix}-%`)
  }
  await db.$executeRawUnsafe(`
    INSERT INTO artwork_read_media ("userId", "artworkId", "mediaId")
    SELECT s."userId", s."artworkId", i.id
    FROM artwork_reading_summaries s
    JOIN "Artwork" a ON a.id = s."artworkId"
    JOIN "Image" i ON i."artworkId" = a.id AND i."sortOrder" < s."seenCount"
    WHERE a."storageKey" LIKE $1 AND s."userId" IN ($2, $3)`, `${prefix}-%`, ...users)
  for (const table of ['"Artwork"', '"Image"', 'artwork_reading_summaries', 'artwork_read_media', 'artwork_artists', 'artwork_artist_evidence', '"ArtworkTag"']) {
    await db.$executeRawUnsafe(`ANALYZE ${table}`)
  }
  return { tagIds: [tagA.id, tagB.id] }
}

async function explain(trace: QueryTrace | undefined) {
  if (!db || !trace) return []
  const params = JSON.parse(trace.params) as unknown[]
  const rows = await db.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) ${trace.query}`, ...params)
  return rows.map((row) => row['QUERY PLAN'])
}

describe.skipIf(!databaseUrl)('50k artwork reading query performance on dedicated PostgreSQL', () => {
  it('fills realistic reading data and verifies all keyset sorts, account isolation, history and query plans', async () => {
    await cleanup()
    const report: Record<string, unknown> = { dataset: {}, pages: [], plans: {} }
    try {
      const fixture = await seed()
      const volume = await db!.$queryRawUnsafe<Array<{ artworks: bigint; media: bigint; summaries: bigint; readMedia: bigint }>>(`
        SELECT (SELECT count(*) FROM "Artwork" WHERE "storageKey" LIKE $1) AS artworks,
          (SELECT count(*) FROM "Image" i JOIN "Artwork" a ON a.id=i."artworkId" WHERE a."storageKey" LIKE $1) AS media,
          (SELECT count(*) FROM artwork_reading_summaries s JOIN "Artwork" a ON a.id=s."artworkId" WHERE a."storageKey" LIKE $1) AS summaries,
          (SELECT count(*) FROM artwork_read_media m JOIN "Artwork" a ON a.id=m."artworkId" WHERE a."storageKey" LIKE $1) AS "readMedia"`, `${prefix}-%`)
      expect(volume[0]).toMatchObject({ artworks: 50000n, media: 200500n, summaries: 50000n })
      expect(Number(volume[0]?.readMedia)).toBeGreaterThan(100000)
      report.dataset = Object.fromEntries(Object.entries(volume[0]!).map(([key, value]) => [key, Number(value)]))

      if (!comparisonOnly) {
        const sortOptions = ['title_asc', 'title_desc', 'artist_asc', 'artist_desc', 'images_asc', 'images_desc', 'source_date_asc', 'source_date_desc', 'created_at_asc', 'created_at_desc', 'random'] as const
        for (const readingStatus of ['UNREAD', 'IN_PROGRESS', 'COMPLETED'] as const) {
          for (const sortBy of sortOptions) {
            const seed = sortBy === 'random' ? 42 : undefined
            const params = ArtworksInfiniteQuerySchema.parse({ readingStatus, sortBy, randomSeed: seed, search: 'boundary', pageSize: 7 })
            const all = await readingPage.queryReadingArtworkIdsPage({ ...params, pageSize: 100 }, users[0]!)
            const expected = all.ids
            const traversed: number[] = []
            let cursor: string | undefined
            do {
              const page = await readingPage.queryReadingArtworkIdsPage({ ...params, readingCursor: cursor }, users[0]!)
              traversed.push(...page.ids)
              cursor = page.nextReadingCursor
            } while (cursor)
            expect(traversed, `${readingStatus}/${sortBy}`).toEqual(expected)
            expect(new Set(traversed).size).toBe(traversed.length)
            const boundaryPage = await readingPage.queryReadingArtworkIdsPage(params, users[0]!)
            const boundaryId = boundaryPage.ids.at(-1)!
            expect(boundaryPage.nextReadingCursor).toBeDefined()
            await db!.artwork.update({ where: { id: boundaryId }, data: { deletedAt: new Date() } })
            try {
              const next = await readingPage.queryReadingArtworkIdsPage({ ...params, readingCursor: boundaryPage.nextReadingCursor }, users[0]!)
              expect(next.ids, `removed boundary ${readingStatus}/${sortBy}`).toEqual(expected.slice(7, 14))
            } finally {
              await db!.artwork.update({ where: { id: boundaryId }, data: { deletedAt: null } })
            }
            ;(report.pages as Array<unknown>).push({ readingStatus, sortBy, rows: traversed.length })
          }
        }
      }

      const complex = ArtworksInfiniteQuerySchema.parse({
        readingStatus: 'IN_PROGRESS', sortBy: 'source_date_desc', pageSize: 24,
        tagIds: fixture?.tagIds, sources: ['PIXIV_IMPORTED'], mediaTypes: ['.jpg'],
        startDate: '2024-01-01', createdStartDate: '2024-01-01', mediaCountMin: 4
      })
      const card = await measure('card-complex-first', () => artworkService.getArtworkCardsPage(complex, users[0]!))
      const cardIds = card.result.items.map((item) => item.id)
      expect(cardIds).toHaveLength(24)
      const cardNext = await measure('card-complex-next', () => artworkService.getArtworkCardsPage({ ...complex, readingCursor: card.result.nextReadingCursor }, users[0]!))
      expect(cardNext.result.items).toHaveLength(24)
      expect(cardNext.result.items.every((item) => !cardIds.includes(item.id))).toBe(true)
      const summaries = await measure('page-summaries', () => readingService.getReadingSummaries(users[0]!, cardIds))
      expect(summaries.result.summaries).toHaveLength(24)
      const history = await measure('history-first', () => readingService.getReadingHistory(users[0]!, 24))
      expect(history.result.items).toHaveLength(24)
      const historyNext = await readingService.getReadingHistory(users[0]!, 24, history.result.nextCursor)
      expect(historyNext.items).toHaveLength(24)
      expect(historyNext.items.every((item) => !history.result.items.some((firstItem) => firstItem.artwork.id === item.artwork.id))).toBe(true)
      const random = await measure('random-first', () => readingPage.queryReadingArtworkIdsPage(
        ArtworksInfiniteQuerySchema.parse({ readingStatus: 'UNREAD', sortBy: 'random', randomSeed: 42, pageSize: 24 }), users[0]!
      ))
      const artist = await measure('artist-first', () => readingPage.queryReadingArtworkIdsPage(
        ArtworksInfiniteQuerySchema.parse({ readingStatus: 'IN_PROGRESS', sortBy: 'artist_asc', pageSize: 24 }), users[0]!
      ))
      const defaultPage = await measure('default-first', () => readingPage.queryReadingArtworkIdsPage(
        ArtworksInfiniteQuerySchema.parse({ readingStatus: 'UNREAD', sortBy: 'source_date_desc', pageSize: 24 }), users[0]!
      ))
      await expect(readingPage.queryReadingArtworkIdsPage(
        { ...ArtworksInfiniteQuerySchema.parse({ readingStatus: 'UNREAD', sortBy: 'source_date_desc', pageSize: 24 }), readingCursor: defaultPage.result.nextReadingCursor },
        users[1]!
      )).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      const measurements = [card, cardNext, summaries, history, random, artist, defaultPage]
      report.measurements = measurements.map(({ name, elapsedMs, queryCount, queries }) => ({
        name, elapsedMs, queryCount, databaseMs: Number(queries.reduce((sum, item) => sum + item.duration, 0).toFixed(2))
      }))
      report.plans = {
        cardCount: await explain(card.queries.find((item) => item.query.includes('COUNT(*)'))),
        cardPage: await explain(card.queries.find((item) => item.query.includes('reading_sort_value'))),
        nextPage: await explain(cardNext.queries.find((item) => item.query.includes('reading_sort_value'))),
        randomPage: await explain(random.queries.find((item) => item.query.includes('reading_sort_value'))),
        artistPage: await explain(artist.queries.find((item) => item.query.includes('reading_sort_value'))),
        history: await explain(history.queries.find((item) => item.query.includes('artwork_reading_summaries'))),
        summaries: await explain(summaries.queries.find((item) => item.query.includes('artwork_reading_summaries')))
      }
      const controlCases = [
        { name: 'default', input: { sortBy: 'source_date_desc', pageSize: 24 }, readingStatus: 'UNREAD' },
        { name: 'complex', input: { sortBy: 'source_date_desc', pageSize: 24, tagIds: fixture?.tagIds, sources: ['PIXIV_IMPORTED'], mediaTypes: ['.jpg'], startDate: '2024-01-01', createdStartDate: '2024-01-01', mediaCountMin: 4 }, readingStatus: 'IN_PROGRESS' },
        { name: 'artist', input: { sortBy: 'artist_asc', pageSize: 24 }, readingStatus: 'IN_PROGRESS' },
        { name: 'random', input: { sortBy: 'random', randomSeed: 42, pageSize: 24 }, readingStatus: 'UNREAD' }
      ] as const
      report.controls = []
      for (const control of controlCases) {
        const unfiltered = await measure(`${control.name}-without-reading`, () => artworkService.getArtworkCardsPage(ArtworksInfiniteQuerySchema.parse(control.input)))
        const filtered = await measure(`${control.name}-with-reading`, () => artworkService.getArtworkCardsPage(
          ArtworksInfiniteQuerySchema.parse({ ...control.input, readingStatus: control.readingStatus }), users[0]!
        ))
        const toSummary = async (measurement: typeof filtered) => {
          const selection = measurement.queries.find((item) => item.query.includes('SELECT a.id'))
          const plan = await explain(selection)
          return {
            elapsedMs: measurement.elapsedMs,
            queryCount: measurement.queryCount,
            selectionPlanMs: plan.find((line) => line.startsWith('Execution Time:')) ?? null,
            selectionBuffers: plan.find((line) => line.includes('Buffers:')) ?? null
          }
        }
        ;(report.controls as Array<unknown>).push({
          name: control.name,
          withoutReading: await toSummary(unfiltered),
          withReading: await toSummary(filtered)
        })
      }
      const output = path.join(process.cwd(), '.local-data', 'reading-validation', 'backend-performance.json')
      mkdirSync(path.dirname(output), { recursive: true })
      writeFileSync(output, JSON.stringify(report, null, 2))
    } finally {
      await cleanup()
    }
  }, 300_000)
})
