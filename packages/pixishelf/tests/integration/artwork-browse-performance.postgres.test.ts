// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { cpus, platform, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

const url = process.env.BROWSE_PERF_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55434' || parsed.pathname !== '/browse_perf') {
    throw new Error('Requires isolated localhost:55434/browse_perf database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : undefined
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.db
  }
}))
import {
  queryRandomArtworkIdsPage,
  buildRandomRangeQuery,
  randomPageContext
} from '@/services/artwork-service/random-page-query'
import { getArtworkCardsByIds, getArtworkCardsPage, getViewerFeed } from '@/services/artwork-service'
import { ViewerFeedQuerySchema } from '@/schemas/artwork.dto'
import { buildArtworkWhereClause } from '@/services/artwork-service/query-builder'
import { appendReadingPredicate } from '@/services/artwork-service/reading-keyset'
import { diagnoseArtworkBrowse } from '@/services/artwork-service/browse-diagnostics'

const suite = url ? describe : describe.skip
const user = 'browse-perf-user'
const other = 'browse-perf-other'
const emptyUser = 'browse-perf-empty'
let firstId = 0
let size = 0
const hash = (id: number) => createHash('md5').update(`${id}:artwork-random-v1`).digest('hex')
const input = (extra = {}) =>
  ArtworksInfiniteQuerySchema.parse({
    sortBy: 'random',
    randomSeed: 73476,
    pageSize: 24,
    readingStatus: 'UNREAD',
    ...extra
  })

async function cleanup() {
  await db!.$executeRawUnsafe(
    `DELETE FROM "Image" i USING "Artwork" a WHERE i."artworkId" = a.id AND a."storageKey" LIKE 'browse-perf-%'`
  )
  await db!.$executeRawUnsafe(`DELETE FROM "Artwork" WHERE "storageKey" LIKE 'browse-perf-%'`)
  await db!.artist.deleteMany({ where: { name: 'browse-perf-artist' } })
  await db!.tag.deleteMany({ where: { name: { startsWith: 'browse-perf-' } } })
  await db!.userBA.deleteMany({ where: { id: { in: [user, other, emptyUser] } } })
}
let artistId: number
let tagIds: number[]
async function grow(target: number) {
  await db!.$executeRawUnsafe(
    `INSERT INTO "Artwork" (title, "storageKey", "artistId", "sourceDate", "createdAt", "updatedAt")
    SELECT 'browse perf ' || g, 'browse-perf-' || g, $3, TIMESTAMP '2024-01-01' + g * INTERVAL '1 minute',
      TIMESTAMP '2024-01-01', NOW() FROM generate_series($1::int, $2::int) g`,
    size + 1,
    target,
    artistId
  )
  if (!size) firstId = (await db!.artwork.findFirstOrThrow({ where: { storageKey: 'browse-perf-1' } })).id
  await db!.$executeRawUnsafe(
    `INSERT INTO "Image" (path, "artworkId", "sortOrder", "mediaType", "updatedAt")
    SELECT '/browse-perf/' || a.id || '/' || p || '.jpg', a.id, p, 'IMAGE'::"MediaType", NOW()
    FROM "Artwork" a CROSS JOIN generate_series(0,3) p
    WHERE a.id BETWEEN $1 AND $2`,
    firstId + size,
    firstId + target - 1
  )
  await db!.$executeRawUnsafe(
    `INSERT INTO artwork_reading_summaries ("userId", "artworkId", "seenCount", "totalCount", "updatedAt")
    SELECT $1, id, CASE WHEN id % 4 = 0 THEN 4 ELSE 1 END, 4, NOW() FROM "Artwork"
    WHERE id BETWEEN $2 AND $3 AND id % 2 = 0`,
    user,
    firstId + size,
    firstId + target - 1
  )
  await db!.$executeRawUnsafe(
    `INSERT INTO artwork_reading_summaries ("userId", "artworkId", "seenCount", "totalCount", "updatedAt")
    SELECT $1, id, 1, 4, NOW() FROM "Artwork"
    WHERE id BETWEEN $2 AND $3 AND id % 100 <> 0`,
    other,
    firstId + size,
    firstId + target - 1
  )
  for (const [index, tagId] of tagIds.entries()) {
    await db!.$executeRawUnsafe(
      `INSERT INTO "ArtworkTag" ("artworkId", "tagId")
      SELECT id, $1 FROM "Artwork" WHERE id BETWEEN $2 AND $3 AND id % $4 = 0`,
      tagId,
      firstId + size,
      firstId + target - 1,
      index * 2 + 3
    )
  }
  size = target
  for (const table of [
    'Artwork',
    'Image',
    'ArtworkTag',
    'artwork_reading_summaries',
    'artwork_artists',
    'artwork_artist_evidence'
  ]) {
    await db!.$executeRawUnsafe(`ANALYZE "${table}"`)
  }
}

suite('artwork browse correctness and performance', () => {
  beforeAll(async () => {
    context.db = db
    await cleanup()
    await db!.userBA.createMany({ data: [{ id: user }, { id: other }, { id: emptyUser }] })
    artistId = (await db!.artist.create({ data: { name: 'browse-perf-artist' } })).id
    tagIds = await Promise.all(
      ['a', 'b'].map(async (suffix) => (await db!.tag.create({ data: { name: `browse-perf-${suffix}` } })).id)
    )
    await grow(120)
  }, 60000)
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  }, 120000)

  it('walks the entire ring exactly once for all reading states, after boundary deletion and account changes', async () => {
    for (const readingStatus of [undefined, 'UNREAD', 'IN_PROGRESS', 'COMPLETED'] as const) {
      const params = input({ readingStatus, pageSize: 7, randomSeed: 0 })
      const pivot = randomPageContext(params, user).pivot
      const candidates = (await db!.artwork.findMany({ select: { id: true } }))
        .map(({ id }) => id)
        .filter(
          (id) =>
            !readingStatus ||
            (readingStatus === 'UNREAD' ? id % 2 !== 0 : readingStatus === 'COMPLETED' ? id % 4 === 0 : id % 4 === 2)
        )
        .sort((a, b) => Number(hash(a) < pivot) - Number(hash(b) < pivot) || hash(a).localeCompare(hash(b)) || a - b)
      const actual: number[] = []
      let randomCursor: string | undefined
      do {
        const page = await queryRandomArtworkIdsPage({ ...params, randomCursor }, user)
        actual.push(...page.ids)
        randomCursor = page.nextRandomCursor
      } while (randomCursor)
      expect(actual).toEqual(candidates)
      const first = await queryRandomArtworkIdsPage(params, user)
      const last = first.ids.at(-1)!
      await db!.artwork.update({ where: { id: last }, data: { deletedAt: new Date() } })
      const next = await queryRandomArtworkIdsPage({ ...params, randomCursor: first.nextRandomCursor }, user)
      expect(next.ids).toEqual(candidates.slice(7, 14))
      await db!.artwork.update({ where: { id: last }, data: { deletedAt: null } })
      await expect(
        queryRandomArtworkIdsPage({ ...params, randomCursor: first.nextRandomCursor }, other)
      ).rejects.toThrow('ARTWORK_RANDOM_CURSOR_INVALID')
    }
    expect((await queryRandomArtworkIdsPage(input({ search: 'does-not-exist' }), user)).ids).toEqual([])
    const card = await getArtworkCardsPage(input(), user)
    expect(card).not.toHaveProperty('total')
    const viewer = await getViewerFeed({
      ...ViewerFeedQuerySchema.parse({ mode: 'random', randomSeed: 73476, readingStatus: 'UNREAD', pageSize: 24 }),
      userId: user
    })
    expect(viewer.items.map((item) => item.id)).toEqual(card.items.map((item) => item.id))
  })

  it('keeps an unread cursor valid after its boundary becomes read and new works are added', async () => {
    const params = input({ pageSize: 7 })
    const first = await queryRandomArtworkIdsPage(params, user)
    const expectedNext = await queryRandomArtworkIdsPage({ ...params, randomCursor: first.nextRandomCursor }, user)
    const boundary = first.ids.at(-1)!
    await db!.artworkReadingSummary.create({ data: { userId: user, artworkId: boundary, seenCount: 1, totalCount: 4 } })
    expect((await queryRandomArtworkIdsPage({ ...params, randomCursor: first.nextRandomCursor }, user)).ids).toEqual(
      expectedNext.ids
    )
    await grow(125)
    const next = await queryRandomArtworkIdsPage({ ...params, randomCursor: first.nextRandomCursor }, user)
    expect(next.ids.every((id) => !first.ids.includes(id))).toBe(true)
    await db!.artworkReadingSummary.delete({ where: { userId_artworkId: { userId: user, artworkId: boundary } } })
  })

  it('bounds covers even for a work with thousands of media and preserves video metadata', async () => {
    await db!.$executeRawUnsafe(
      `INSERT INTO "Image" (path, "artworkId", "sortOrder", "mediaType", "updatedAt")
      SELECT '/browse-perf/large/' || g || '.jpg', $1, g, 'IMAGE'::"MediaType", NOW() FROM generate_series(4,3000) g`,
      firstId
    )
    const cards = await getArtworkCardsByIds([firstId])
    expect(cards[0]?.images).toHaveLength(1)
    expect(cards[0]?.images[0]?.path).toContain('/0.jpg')
    const cover = await db!.image.findFirstOrThrow({
      where: { artworkId: firstId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    })
    await db!.image.update({ where: { id: cover.id }, data: { mediaType: 'VIDEO' } })
    await db!.mediaVideoMetadata.create({
      data: {
        imageId: cover.id,
        posterStatus: 'COMPLETED',
        posterPath: 'browse-cover.webp',
        posterUpdatedAt: new Date('2026-01-01T00:00:00Z')
      }
    })
    const video = await getArtworkCardsByIds([firstId])
    expect(video[0]?.images[0]?.posterUrl).toContain('browse-cover.webp?v=1767225600000')
    await db!.mediaVideoMetadata.delete({ where: { imageId: cover.id } })
    await db!.image.update({ where: { id: cover.id }, data: { mediaType: 'IMAGE' } })
  })

  it('measures old/new selection and new hydration at 50k, 100k and 200k', async () => {
    const report: unknown[] = []
    const environment = {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      platform: platform(),
      memoryBytes: totalmem(),
      postgres: await db!.$queryRawUnsafe('SELECT version()')
    }

    for (const target of [50000, 100000, 200000]) {
      await grow(target)
      let indexBuildMs: number | undefined
      if (target === 100000) {
        const started = performance.now()
        await db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('DROP INDEX "artwork_active_random_v1_idx"')
            await tx.$executeRawUnsafe('DROP INDEX "Image_artworkId_sortOrder_id_idx"')
            const migration = readFileSync(
              '../pixishelf-db/prisma/migrations/20261016090000_artwork_browse_indexes/migration.sql',
              'utf8'
            )
            for (const statement of migration.split(';').filter((sql) => sql.trim())) {
              await tx.$executeRawUnsafe(statement)
            }
          },
          { timeout: 120000 }
        )
        indexBuildMs = performance.now() - started
      }
      const params = input()
      const legacy = `SELECT a.id FROM "Artwork" a WHERE a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM artwork_reading_summaries rs WHERE rs."artworkId"=a.id AND rs."userId"=$1 AND rs."seenCount">0)
        ORDER BY md5(a.id::text || '73476'), a.id LIMIT 25`
      const samples: Array<{ oldMs: number; selectionMs: number; serviceMs: number }> = []
      let firstObservation: unknown
      for (let repeat = 0; repeat < 21; repeat++) {
        const start = performance.now()
        await db!.$queryRawUnsafe(legacy, user)
        const oldMs = performance.now() - start
        const next = performance.now()
        const selected = await queryRandomArtworkIdsPage(params, user)
        const selectionMs = performance.now() - next
        await getArtworkCardsByIds(selected.ids)
        const sample = { oldMs, selectionMs, serviceMs: performance.now() - next }
        if (repeat) samples.push(sample)
        else firstObservation = sample
      }
      const p95 = (key: keyof (typeof samples)[number]) => samples.map((row) => row[key]).sort((a, b) => a - b)[18]!
      const diagnostics = await diagnoseArtworkBrowse(db!, params, user)
      expect(JSON.stringify(diagnostics.plans)).toContain('artwork_active_random_v1_idx')
      const variants = []
      for (const extra of [
        { readingStatus: undefined },
        { readingStatus: 'COMPLETED' },
        { tagIds },
        { id: firstId % 2 ? firstId : firstId + 1 },
        { artistName: 'browse-perf-artist' },
        { tagIds, mediaType: 'image', mediaTypes: ['.jpg'], startDate: '2024-01-01', createdEndDate: '2024-12-31' }
      ]) {
        const start = performance.now()
        const variantInput = input(extra)
        const page = await getArtworkCardsPage(variantInput, user)
        const ms = performance.now() - start
        let base = buildArtworkWhereClause(variantInput)
        if (variantInput.readingStatus) base = appendReadingPredicate(variantInput.readingStatus, user, base)
        const oldStart = performance.now()
        await db!.$queryRawUnsafe(
          `SELECT a.id FROM "Artwork" a ${base.whereSQL}
          ORDER BY md5(a.id::text || $${base.paramIndex}::text), a.id LIMIT 25`,
          ...base.sqlParams,
          '73476'
        )
        variants.push({
          filters: Object.keys(extra),
          ms,
          oldSelectionMs: performance.now() - oldStart,
          returned: page.items.length
        })
        if (extra.id === undefined) expect(page.items.length).toBe(24)
      }
      const density = []
      for (const [account, seenPercent] of [
        [emptyUser, 0],
        [user, 50],
        [other, 99]
      ] as const) {
        const start = performance.now()
        const page = await getArtworkCardsPage(params, account)
        density.push({ seenPercent, serviceMs: performance.now() - start, returned: page.items.length })
      }
      let randomCursor: string | undefined
      const seen = new Set<number>()
      const deepStart = performance.now()
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page = await queryRandomArtworkIdsPage({ ...params, randomCursor }, user)
        for (const id of page.ids) {
          expect(seen.has(id)).toBe(false)
          seen.add(id)
        }
        randomCursor = page.nextRandomCursor
      }
      const firstRange = buildRandomRangeQuery(params, user, 0, 25)
      const plan = await db!.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) ${firstRange.sql}`,
        ...firstRange.values
      )
      report.push({
        size: target,
        environment,
        firstObservation,
        density,
        indexBuildMs,
        oldP95: p95('oldMs'),
        selectionP95: p95('selectionMs'),
        serviceP95: p95('serviceMs'),
        deep100PagesMs: performance.now() - deepStart,
        variants,
        diagnostics,
        plan
      })
      mkdirSync('.local-data/browse-performance', { recursive: true })
      writeFileSync('.local-data/browse-performance/report.json', JSON.stringify(report, null, 2))
      if (target === 100000) {
        expect(p95('selectionMs')).toBeLessThanOrEqual(100)
        expect(p95('serviceMs')).toBeLessThanOrEqual(300)
      }
    }
  }, 600000)
})
