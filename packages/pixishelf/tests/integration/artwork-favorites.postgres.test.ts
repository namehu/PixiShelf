// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
import { ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema } from '@/schemas/artwork.dto'

// Deliberately never fall back to DATABASE_URL or the application's environment file.
const url = process.env.FAVORITES_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55434' || target.pathname !== '/favorites_verification') {
    throw new Error('Requires isolated 127.0.0.1:55434/favorites_verification database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : undefined
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.db
  }
}))
import { getArtworkCardsPage, getArtworksList, getViewerFeed } from '@/services/artwork-service'
import { randomPageContext } from '@/services/artwork-service/random-page-query'

const prefix = `favorites-${randomUUID()}`
const user = `${prefix}-a`
const other = `${prefix}-b`
const empty = `${prefix}-empty`
const activeCount = 18
let artistId: number
let tagIds: number[] = []
let artworkIds: number[] = []

const input = (extra: Record<string, unknown> = {}) =>
  ArtworksInfiniteQuerySchema.parse({ artistId, likedOnly: true, sortBy: 'source_date_asc', pageSize: 3, ...extra })
const selectedIds = (predicate: (index: number) => boolean) =>
  artworkIds.slice(0, activeCount).filter((_, index) => predicate(index))
const likesA = () => selectedIds((index) => index % 2 === 0)
const likesB = () => selectedIds((index) => index % 3 === 0)
const ids = (items: Array<{ id: number }>) => items.map((item) => item.id)

async function walkCards(params: ArtworksInfiniteQuerySchema, userId: string) {
  const collected: number[] = []
  let readingCursor: string | undefined
  let randomCursor: string | undefined
  for (let pageNumber = 0; pageNumber <= activeCount; pageNumber++) {
    const page = await getArtworkCardsPage({ ...params, readingCursor, randomCursor }, userId)
    expect(page.items.length).toBeLessThanOrEqual(params.pageSize)
    expect(page).not.toHaveProperty('total')
    for (const item of page.items) {
      expect(collected).not.toContain(item.id)
      expect(item.images).toHaveLength(1)
      collected.push(item.id)
    }
    if (!page.hasNextPage) return collected
    readingCursor = page.nextReadingCursor
    randomCursor = page.nextRandomCursor
    expect(readingCursor ?? randomCursor).toBeTruthy()
  }
  throw new Error('Favorites pagination did not terminate')
}

describe.skipIf(!url).sequential('account favorites with isolated PostgreSQL', () => {
  beforeAll(async () => {
    context.db = db
    await db!.userBA.createMany({ data: [user, other, empty].map((id) => ({ id })) })
    artistId = (await db!.artist.create({ data: { name: prefix } })).id
    for (const suffix of ['first', 'second']) {
      tagIds.push((await db!.tag.create({ data: { name: `${prefix}-${suffix}` } })).id)
    }
    for (let index = 0; index < activeCount + 2; index++) {
      const artwork = await db!.artwork.create({
        data: {
          title: `${prefix} ${String(index).padStart(2, '0')}`,
          storageKey: `${prefix}-${index}`,
          artistId,
          source: 'LOCAL_IMPORT',
          sourceDate: new Date(Date.UTC(2024, 0, 1, 0, Math.floor(index / 3))),
          deletedAt: index === activeCount ? new Date() : undefined,
          archiveLifecycleState: index === activeCount + 1 ? 'TRASHED' : 'ACTIVE',
          images: {
            create: Array.from({ length: 3 }, (_, page) => ({
              path: `/${prefix}/${index}/${page}.jpg`,
              sortOrder: page,
              mediaType: 'IMAGE'
            }))
          }
        }
      })
      artworkIds.push(artwork.id)
      if (index % 2 === 0 || index >= activeCount) {
        await db!.artworkLike.create({ data: { userId: user, artworkId: artwork.id, level: 2 + (index % 3) } })
      } else {
        // A normal rating is persisted but must never enter My Likes.
        await db!.artworkLike.create({ data: { userId: user, artworkId: artwork.id, level: 1 } })
      }
      if (index % 3 === 0 || index >= activeCount) {
        await db!.artworkLike.create({ data: { userId: other, artworkId: artwork.id } })
      }
      if (index % 4 < 2) await db!.artworkTag.create({ data: { artworkId: artwork.id, tagId: tagIds[0]! } })
      if (index % 3 < 2) await db!.artworkTag.create({ data: { artworkId: artwork.id, tagId: tagIds[1]! } })
      if (index % 3 !== 0) {
        await db!.artworkReadingSummary.create({
          data: { userId: user, artworkId: artwork.id, seenCount: index % 3 === 1 ? 1 : 3, totalCount: 3, viewCount: 1 }
        })
      }
      if (index % 3 === 0) {
        await db!.artworkReadingSummary.create({
          data: { userId: other, artworkId: artwork.id, seenCount: 3, totalCount: 3, viewCount: 1 }
        })
      }
    }
  }, 30_000)

  afterAll(async () => {
    if (!db) return
    try {
      await db.image.deleteMany({ where: { artwork: { storageKey: { startsWith: prefix } } } })
      await db.artwork.deleteMany({ where: { storageKey: { startsWith: prefix } } })
      await db.artist.deleteMany({ where: { name: prefix } })
      await db.tag.deleteMany({ where: { name: { startsWith: prefix } } })
      await db.userBA.deleteMany({ where: { id: { in: [user, other, empty] } } })
    } finally {
      await db.$disconnect()
    }
  })

  it('isolates A/B likes, excludes inactive works and preserves all-works queries', async () => {
    expect(await walkCards(input(), user)).toEqual(likesA())
    expect(await walkCards(input(), other)).toEqual(likesB())
    expect(await walkCards(input(), empty)).toEqual([])
    for (const likedOnly of [undefined, false]) {
      const page = await getArtworkCardsPage(input({ likedOnly, pageSize: 30 }), user)
      expect(new Set(ids(page.items))).toEqual(new Set(artworkIds.slice(0, activeCount)))
    }
    const management = await getArtworksList(input({ pageSize: 30 }), user)
    expect(management.total).toBe(likesA().length)
    expect(ids(management.items)).toEqual(likesA())
    await expect(getArtworkCardsPage(input())).rejects.toThrow('Authenticated user required')
  })

  it('combines likes with account reading state and all selected tags in ordinary and random pages', async () => {
    for (const sortBy of ['source_date_asc', 'random']) {
      for (const [statusIndex, readingStatus] of ['UNREAD', 'IN_PROGRESS', 'COMPLETED'].entries()) {
        const params = input({
          readingStatus,
          tagIds: [tagIds[0]],
          sortBy,
          randomSeed: sortBy === 'random' ? 73476 : undefined
        })
        const expected = selectedIds((index) => index % 2 === 0 && index % 4 < 2 && index % 3 === statusIndex)
        expect(new Set(await walkCards(params, user))).toEqual(new Set(expected))
      }
      const bothTags = input({ tagIds, sortBy, randomSeed: sortBy === 'random' ? 73476 : undefined })
      expect(new Set(await walkCards(bothTags, user))).toEqual(
        new Set(selectedIds((index) => index % 2 === 0 && index % 4 < 2 && index % 3 < 2))
      )
    }
    expect(await walkCards(input({ readingStatus: 'UNREAD' }), other)).toEqual([])
    expect(await walkCards(input({ readingStatus: 'COMPLETED' }), other)).toEqual(likesB())
  })

  it('walks keyset ties and the complete random ring exactly once', async () => {
    for (const sortBy of ['source_date_asc', 'source_date_desc', 'title_asc', 'title_desc']) {
      expect(await walkCards(input({ sortBy, pageSize: 2 }), user)).toEqual(
        sortBy.endsWith('_desc') ? [...likesA()].reverse() : likesA()
      )
    }
    for (const randomSeed of [0, 73476]) {
      const params = input({ sortBy: 'random', randomSeed, pageSize: 2 })
      const pivot = randomPageContext(params, user).pivot
      const hash = (id: number) => createHash('md5').update(`${id}:artwork-random-v1`).digest('hex')
      const expected = [...likesA()].sort(
        (a, b) => Number(hash(a) < pivot) - Number(hash(b) < pivot) || hash(a).localeCompare(hash(b)) || a - b
      )
      expect(await walkCards(params, user)).toEqual(expected)
    }
  })

  it('continues after the boundary and a future work are rated normal without duplicates or omissions', async () => {
    for (const sortBy of ['source_date_asc', 'random']) {
      const params = input({ sortBy, randomSeed: sortBy === 'random' ? 73476 : undefined, pageSize: 2 })
      const before = await walkCards(params, user)
      const first = await getArtworkCardsPage(params, user)
      const removed = [before[1]!, before[3]!]
      await db!.artworkLike.updateMany({ where: { userId: user, artworkId: { in: removed } }, data: { level: 1 } })
      try {
        const remaining: number[] = []
        let readingCursor = first.nextReadingCursor
        let randomCursor = first.nextRandomCursor
        for (let pageNumber = 0; readingCursor || randomCursor; pageNumber++) {
          expect(pageNumber).toBeLessThan(activeCount)
          const next = await getArtworkCardsPage({ ...params, readingCursor, randomCursor }, user)
          remaining.push(...ids(next.items))
          readingCursor = next.nextReadingCursor
          randomCursor = next.nextRandomCursor
        }
        expect(remaining).toEqual(before.slice(2).filter((id) => !removed.includes(id)))
        expect(new Set([...ids(first.items), ...remaining]).size).toBe(first.items.length + remaining.length)
      } finally {
        await db!.artworkLike.updateMany({ where: { userId: user, artworkId: { in: removed } }, data: { level: 2 } })
      }
    }
  })

  it('rejects cursors replayed for another account or changed filters', async () => {
    for (const sortBy of ['source_date_asc', 'random']) {
      const params = input({ sortBy, randomSeed: sortBy === 'random' ? 73476 : undefined })
      const first = await getArtworkCardsPage(params, user)
      const cursor = { readingCursor: first.nextReadingCursor, randomCursor: first.nextRandomCursor }
      const error = sortBy === 'random' ? 'ARTWORK_RANDOM_CURSOR_INVALID' : 'Invalid reading cursor'
      await expect(getArtworkCardsPage({ ...params, ...cursor }, other)).rejects.toThrow(error)
      for (const changes of [{ tagIds: [tagIds[0]!] }, { readingStatus: 'UNREAD' as const }, { likedOnly: false }]) {
        await expect(getArtworkCardsPage({ ...params, ...changes, ...cursor }, user)).rejects.toThrow(error)
      }
    }
  })

  it('keeps bounded cards and viewer pages on the same complete favorite collection', async () => {
    for (const mode of ['ordered', 'random'] as const) {
      const extra = {
        artistId,
        likedOnly: true,
        pageSize: 1,
        readingStatus: 'UNREAD',
        tagIds: [tagIds[0]!],
        randomSeed: 73476
      }
      const cardInput = input({
        ...extra,
        sortBy: mode === 'random' ? 'random' : 'source_date_asc',
        randomSeed: mode === 'random' ? 73476 : undefined
      })
      const viewerInput = ViewerFeedQuerySchema.parse({ ...extra, mode, sortBy: 'source_date_asc' })
      const cardIds = await walkCards(cardInput, user)
      const viewerIds: number[] = []
      let readingCursor: string | undefined
      let randomCursor: string | undefined
      do {
        const page = await getViewerFeed({ ...viewerInput, userId: user, readingCursor, randomCursor })
        expect(page.items.length).toBeLessThanOrEqual(viewerInput.pageSize)
        expect(page.items.every((item) => item.isLike && item.ratingLevel !== null && item.ratingLevel! >= 2)).toBe(true)
        viewerIds.push(...ids(page.items))
        readingCursor = page.nextReadingCursor
        randomCursor = page.nextRandomCursor
        expect(page.nextPage).toBeNull()
        expect(viewerIds.length).toBeLessThanOrEqual(activeCount)
      } while (readingCursor || randomCursor)
      expect(viewerIds).toEqual(cardIds)
    }
  })
})
