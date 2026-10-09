import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getArchiveUploaderCatalogCounts, listArchiveUploaderCatalogState } from '../archive-uploader-catalog-state'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const sourceId = `discovery-filter-${randomUUID()}`
const stamp = new Date('2026-10-09T00:00:00Z')

;(databaseUrl ? describe.sequential : describe.skip)('discovery SQL filters', () => {
  beforeAll(async () => {
    await database!.archiveUploaderSource.create({
      data: {
        id: sourceId,
        providerKey: 'e-hentai',
        identityKind: 'NAME',
        identityValue: sourceId,
        normalizedIdentity: sourceId,
        displayName: sourceId
      }
    })
    await database!.archiveUploaderCatalogItem.createMany({
      data: Array.from({ length: 64 }, (_, index) => ({
        id: `${sourceId}-${index}`,
        sourceId,
        providerKey: 'e-hentai',
        externalId: `${sourceId}-${index}`,
        canonicalUrl: `https://e-hentai.org/g/${index}/test/`,
        title: index === 63 ? 'Literal 100%_ title' : `Gallery ${index}`,
        relationships: {},
        classification: 'NEW',
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        postedAt: index === 0 ? null : new Date(stamp.getTime() + index * 1000),
        comparisonSnapshot:
          index === 0
            ? Prisma.JsonNull
            : {
                category: index > 60 ? 'Manga' : 'Doujinshi',
                tags: [
                  { namespace: 'language', name: index > 60 ? 'chinese' : 'english' },
                  { namespace: 'language', name: 'translated' }
                ],
                titles: { aliases: index === 63 ? ['別名'] : [] }
              }
      }))
    })
  })
  afterAll(async () => {
    if (database) {
      await database.archiveUploaderSource.deleteMany({ where: { id: sourceId } })
      await database.$disconnect()
    }
  })

  it('filters before the cursor limit and shares criteria with counts', async () => {
    const filters = { categories: ['Manga'], languages: ['chinese'] }
    const first = await listArchiveUploaderCatalogState(database!, { sourceId, view: 'ALL', filters, limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual([`${sourceId}-63`, `${sourceId}-62`])
    expect(first.items[0]).toMatchObject({ category: 'Manga', languages: ['chinese'] })
    const second = await listArchiveUploaderCatalogState(database!, {
      sourceId,
      view: 'ALL',
      filters,
      cursor: first.nextCursor,
      limit: 2
    })
    expect(second.items.map((item) => item.id)).toEqual([`${sourceId}-61`])
    expect(second.nextCursor).toBeNull()
    expect((await getArchiveUploaderCatalogCounts(database!, [sourceId], false, filters)).get(sourceId)?.total).toBe(3)
    expect((await getArchiveUploaderCatalogCounts(database!, [sourceId])).get(sourceId)?.total).toBe(64)
  })

  it('does not guess missing language/category/date, or treat translated as a language', async () => {
    const filters = { categories: ['__unknown__'], languages: ['__unknown__'], unknownDate: true }
    const result = await listArchiveUploaderCatalogState(database!, { sourceId, view: 'ALL', filters, limit: 50 })
    expect(result.items.map((item) => item.id)).toEqual([`${sourceId}-0`])
    expect(result.items[0]).toMatchObject({ category: null, languages: [], postedAt: null })
    expect((await getArchiveUploaderCatalogCounts(database!, [sourceId], false, filters)).get(sourceId)?.total).toBe(1)
  })

  it('supports literal title search, aliases, OR within dimensions and exclusive date boundaries', async () => {
    for (const search of ['100%_', '別名']) {
      const result = await listArchiveUploaderCatalogState(database!, {
        sourceId,
        view: 'ALL',
        filters: { search },
        limit: 50
      })
      expect(result.items.map((item) => item.id)).toEqual([`${sourceId}-63`])
    }
    const filters = {
      languages: ['english', 'chinese'],
      postedFrom: new Date(stamp.getTime() + 60_000),
      postedBefore: new Date(stamp.getTime() + 62_000)
    }
    const result = await listArchiveUploaderCatalogState(database!, { sourceId, view: 'ALL', filters, limit: 50 })
    expect(result.items.map((item) => item.id)).toEqual([`${sourceId}-61`, `${sourceId}-60`])
    expect((await getArchiveUploaderCatalogCounts(database!, [sourceId], false, filters)).get(sourceId)?.total).toBe(2)
  })
})
