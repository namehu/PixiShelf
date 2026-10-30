// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'
import { ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema, RandomArtworksGetSchema } from '@/schemas/artwork.dto'
import { mediaKinds, readingStatuses, type MediaKind, type ReadingStatusFilter } from '@/schemas/artwork-filter.dto'
import { artworkQuerySnapshotSchema, QUICK_FILTER_PREFIX } from '@/schemas/artwork-quick-filter.dto'

const url = process.env.MULTISELECT_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55438' || target.pathname !== '/filter_test') {
    throw new Error('Requires isolated 127.0.0.1:55438/filter_test database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : undefined
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.db
  }
}))
import { getArtworkCardsPage, getArtworksList, getRandomArtworks, getViewerFeed } from '@/services/artwork-service'
import { createQuickFilter, listQuickFilters, updateQuickFilter } from '@/services/artwork-quick-filter-service'

const token = `multiselect-${randomUUID()}`
const user = `${token}-a`
const other = `${token}-b`
let artistId: number
let outsideId: number
const rows: Array<{ id: number; kinds: MediaKind[]; status: ReadingStatusFilter }> = []
const selections = <T>(values: readonly T[]) =>
  Array.from({ length: 1 << values.length }, (_, mask) => values.filter((_, index) => mask & (1 << index)))
const ids = (items: Array<{ id: number }>) => items.map((item) => item.id)
const input = (extra: Record<string, unknown> = {}) =>
  ArtworksInfiniteQuerySchema.parse({ artistId, sortBy: 'title_asc', pageSize: 2, ...extra })

async function cards(params: ArtworksInfiniteQuerySchema, account = user) {
  const result: number[] = []
  let cursor = 1
  let readingCursor: string | undefined
  let randomCursor: string | undefined
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    const page = await getArtworkCardsPage({ ...params, cursor, readingCursor, randomCursor }, account)
    result.push(...ids(page.items))
    if (!page.hasNextPage) {
      expect(new Set(result).size).toBe(result.length)
      return result
    }
    readingCursor = page.nextReadingCursor
    randomCursor = page.nextRandomCursor
    cursor = readingCursor || randomCursor ? 1 : page.page + 1
  }
  throw new Error('Multi-select pagination did not terminate')
}

describe.skipIf(!url).sequential('multi-select artwork queries on isolated PostgreSQL', () => {
  beforeAll(async () => {
    context.db = db
    await db!.userBA.createMany({ data: [user, other].map((id) => ({ id })) })
    artistId = (await db!.artist.create({ data: { name: token } })).id
    // Each kind below records the legacy single-filter result, including no-media and mixed works.
    const fixtures = [
      { kinds: ['image'], media: [] },
      { kinds: ['image'], media: [{ mediaType: 'IMAGE', path: 'static.jpg' }] },
      { kinds: ['image', 'animation'], media: [{ mediaType: 'ANIMATION', path: 'animation.apng' }] },
      { kinds: ['image', 'animation'], media: [{ mediaType: 'IMAGE', path: 'detected.webp', webpAnimationStatus: 2 }] },
      { kinds: ['video'], media: [{ mediaType: 'VIDEO', path: 'video.mp4' }] },
      {
        kinds: ['video'],
        media: [
          { mediaType: 'IMAGE', path: 'mixed.jpg' },
          { mediaType: 'VIDEO', path: 'mixed.mp4' }
        ]
      },
      {
        kinds: ['animation', 'video'],
        media: [
          { mediaType: 'ANIMATION', path: 'mixed.apng' },
          { mediaType: 'VIDEO', path: 'mixed.webm' }
        ]
      },
      { kinds: ['image'], media: [{ mediaType: 'IMAGE', path: 'still.webp', webpAnimationStatus: 1 }] }
    ] as const
    for (const [index, fixture] of fixtures.entries()) {
      const artwork = await db!.artwork.create({
        data: {
          title: `${token}-${index}`,
          artistId,
          storageKey: `${token}-${index}`,
          images: {
            create: fixture.media.map((media, sortOrder) => ({ ...media, path: `/${token}/${media.path}`, sortOrder }))
          }
        }
      })
      const status = readingStatuses[index % 3]!
      rows.push({ id: artwork.id, kinds: [...fixture.kinds], status })
      if (status !== 'UNREAD' || index === 0) {
        await db!.artworkReadingSummary.create({
          data: {
            userId: user,
            artworkId: artwork.id,
            viewCount: status === 'UNREAD' ? 0 : 1,
            totalCount: 10,
            seenCount: status === 'COMPLETED' ? 9 : status === 'IN_PROGRESS' ? 1 : 0
          }
        })
      }
      await db!.artworkReadingSummary.create({
        data: {
          userId: other,
          artworkId: artwork.id,
          totalCount: 10,
          seenCount: 10
        }
      })
    }
    outsideId = (await db!.artwork.create({ data: { title: `${token}-outside`, storageKey: `${token}-outside` } })).id
  })
  afterAll(async () => {
    await db?.artwork.deleteMany({ where: { id: { in: [...rows.map((row) => row.id), outsideId].filter(Boolean) } } })
    if (artistId) await db?.artist.delete({ where: { id: artistId } })
    await db?.userBA.deleteMany({ where: { id: { in: [user, other] } } })
    await db?.$disconnect()
  })

  it.each(selections(mediaKinds))('preserves the union of legacy media predicates for %j', async (...selected) => {
    // it.each spreads array rows, so reconstruct the selected values.
    const kinds = selected.filter((value): value is MediaKind => typeof value === 'string')
    const expected = rows
      .filter((row) => !kinds.length || kinds.some((kind) => row.kinds.includes(kind)))
      .map((row) => row.id)
    expect(await cards(input({ mediaKinds: kinds }))).toEqual(expected)
    if (kinds.length === 1) expect(await cards(input({ mediaType: kinds[0] }))).toEqual(expected)
  })

  it.each(selections(readingStatuses))('combines account reading statuses with OR for %j', async (...selected) => {
    const statuses = selected.filter((value): value is ReadingStatusFilter => typeof value === 'string')
    const expected = rows.filter((row) => !statuses.length || statuses.includes(row.status)).map((row) => row.id)
    expect(await cards(input({ readingStatuses: statuses }))).toEqual(expected)
    const list = await getArtworksList(input({ readingStatuses: statuses, pageSize: 100 }), user)
    expect(list.total).toBe(expected.length)
    expect(ids(list.items)).toEqual(expected)
    expect(await cards(input({ readingStatuses: statuses }), other)).toEqual(
      !statuses.length || statuses.includes('COMPLETED') ? rows.map((row) => row.id) : []
    )
    if (statuses.length === 1) expect(await cards(input({ readingStatus: statuses[0] }))).toEqual(expected)
  })

  it('ANDs groups, extensions and fixed artist scope in ordinary, random and viewer paths', async () => {
    const selectedKinds = ['animation', 'video']
    const statuses = ['UNREAD', 'COMPLETED']
    const expected = rows
      .filter(
        (row) => selectedKinds.some((kind) => row.kinds.includes(kind as MediaKind)) && statuses.includes(row.status)
      )
      .map((row) => row.id)
    const filters = { mediaKinds: selectedKinds, readingStatuses: statuses }
    expect(await cards(input(filters))).toEqual(expected)
    expect((await cards(input({ ...filters, sortBy: 'random', randomSeed: 76 }))).sort()).toEqual([...expected].sort())
    for (const mode of ['ordered', 'random'] as const) {
      const result: number[] = []
      let readingCursor: string | undefined
      let randomCursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const feed = await getViewerFeed({
          ...ViewerFeedQuerySchema.parse({
            ...filters,
            source: 'artist',
            sourceId: artistId,
            mode,
            sortBy: 'title_asc',
            randomSeed: 76,
            readingCursor,
            randomCursor,
            pageSize: 2
          }),
          userId: user
        })
        result.push(...ids(feed.items))
        readingCursor = feed.nextReadingCursor
        randomCursor = feed.nextRandomCursor
        if (!readingCursor && !randomCursor) break
      }
      expect(result.sort()).toEqual([...expected].sort())
    }
    expect(await cards(input({ mediaKinds: ['animation', 'video'], mediaTypes: '.jpg' }))).toEqual([rows[5]!.id])
    expect(
      await cards(input({ mediaType: 'video', mediaKinds: [], readingStatus: 'COMPLETED', readingStatuses: '' }))
    ).toEqual(rows.map((row) => row.id))
    const legacyRandom = await getRandomArtworks({
      ...RandomArtworksGetSchema.parse({ mediaKinds: ['image', 'video'], pageSize: 100, count: 100 }),
      userId: user
    })
    expect(legacyRandom.items.map((item) => item.id)).toEqual(expect.arrayContaining(rows.map((row) => row.id)))
  })

  it.each(['ordered', 'random'])(
    'normalizes %s cursor context and rejects a changed selection or account',
    async (mode) => {
      const filters = {
        mediaKinds: ['video', 'animation'],
        readingStatuses: ['COMPLETED', 'UNREAD'],
        sortBy: mode === 'random' ? 'random' : 'title_asc',
        randomSeed: 12,
        pageSize: 1
      }
      const first = await getArtworkCardsPage(input(filters), user)
      const continuation = { readingCursor: first.nextReadingCursor, randomCursor: first.nextRandomCursor }
      expect(continuation.readingCursor ?? continuation.randomCursor).toBeTruthy()
      await expect(
        getArtworkCardsPage(
          input({
            ...filters,
            ...continuation,
            mediaKinds: 'animation,video,animation',
            readingStatuses: 'UNREAD,COMPLETED'
          }),
          user
        )
      ).resolves.toMatchObject({ items: expect.any(Array) })
      for (const change of [{ mediaKinds: ['video'] }, { readingStatuses: ['COMPLETED'] }]) {
        await expect(
          getArtworkCardsPage(input({ ...filters, ...continuation, ...change }), user)
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      }
      await expect(getArtworkCardsPage(input({ ...filters, ...continuation }), other)).rejects.toMatchObject({
        code: 'BAD_REQUEST'
      })
    }
  )

  it('upgrades old presets and saves every multi-selection within its account and artist scope', async () => {
    const id = randomUUID()
    await db!.userSetting.create({
      data: {
        userId: user,
        key: QUICK_FILTER_PREFIX + id,
        type: 'json',
        value: JSON.stringify({
          id,
          schemaVersion: 1,
          revision: 1,
          name: 'legacy',
          query: { mediaType: 'animation', readingStatus: 'IN_PROGRESS' },
          createdAt: new Date().toISOString()
        })
      }
    })
    expect((await listQuickFilters(user)).items[0]!.query).toMatchObject({
      mediaKinds: ['animation'],
      readingStatuses: ['IN_PROGRESS']
    })
    const scope = { kind: 'artist' as const, artistId }
    const query = artworkQuerySnapshotSchema.parse({
      mediaKinds: ['video', 'animation'],
      readingStatuses: ['UNREAD', 'COMPLETED']
    })
    const saved = await createQuickFilter(user, { name: 'multi', query, pin: false, scope })
    expect((await listQuickFilters(user, scope)).items[0]!.query).toEqual(query)
    expect((await listQuickFilters(other, scope)).items).toEqual([])
    await expect(createQuickFilter(user, { name: 'pin', query, pin: true, scope })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    const edited = artworkQuerySnapshotSchema.parse({
      mediaKinds: [...mediaKinds],
      readingStatuses: [...readingStatuses]
    })
    await updateQuickFilter(user, { ...saved, query: edited, scope })
    expect((await listQuickFilters(user, scope)).items[0]!.query).toEqual(edited)
    expect((await listQuickFilters(user)).items.map((item) => item.name)).toEqual(['legacy'])
  })
})
