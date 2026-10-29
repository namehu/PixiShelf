// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it } from 'vitest'
import {
  listArchiveUploaderIgnoredItems,
  restoreArchiveUploaderIgnoredItems
} from '@/services/archive-uploader/archive-uploader-service'

// Explicit opt-in only; the fixture transaction always rolls back.
const isolatedUrl = process.env.DISCOVERY_IGNORED_DATABASE_URL
if (isolatedUrl) {
  const target = new URL(isolatedUrl)
  if (target.hostname !== '127.0.0.1' || target.port !== '5442' || target.pathname !== '/pixishelf_ignore_dev') {
    throw new Error('Requires isolated 127.0.0.1:5442/pixishelf_ignore_dev database')
  }
}
const database = isolatedUrl ? new PrismaClient({ datasourceUrl: isolatedUrl }) : null
afterAll(() => database?.$disconnect())

describe.skipIf(!isolatedUrl)('source-scoped global ignores in PostgreSQL', () => {
  it('uses catalog membership before pagination, keeps filtered results, and restores globally', async () => {
    const prefix = `ignored-scope-${randomUUID()}`
    const sourceA = `${prefix}-a`
    const sourceB = `${prefix}-b`
    const ids = [1, 2, 3, 4].map((value) => `${prefix}-${value}`)
    const galleries = [1, 2, 3, 4].map((value) => `${Date.now()}${value}`)
    const now = new Date()
    const rollback = new Error('rollback fixture')
    try {
      await database!.$transaction(async (transaction) => {
        await transaction.archiveUploaderSource.createMany({
          data: [
            {
              id: sourceA,
              providerKey: 'e-hentai',
              identityKind: 'NAME',
              identityValue: sourceA,
              normalizedIdentity: sourceA,
              displayName: 'Origin uploader'
            },
            {
              id: sourceB,
              providerKey: 'e-hentai',
              sourceKind: 'TITLE_QUERY',
              status: 'ARCHIVED',
              titleQuery: { keyword: 'Fixture' },
              queryKey: randomUUID(),
              displayName: 'Disabled title source'
            }
          ]
        })
        await transaction.archiveUploaderCatalogItem.createMany({
          data: [
            [sourceA, galleries[0], true],
            [sourceB, galleries[0], true],
            [sourceB, galleries[1], false],
            [sourceA, galleries[2], true]
          ].map(([sourceId, externalId, matchesQuery]) => ({
            id: `${sourceId}-${externalId}`,
            sourceId: sourceId as string,
            providerKey: 'e-hentai',
            externalId: externalId as string,
            matchesQuery: matchesQuery as boolean,
            canonicalUrl: `https://e-hentai.org/g/${externalId}/fixture/`,
            title: 'Fixture gallery',
            relationships: [],
            classification: 'NEW',
            firstSeenAt: now,
            lastSeenAt: now
          }))
        })
        await transaction.archiveUploaderIgnoredItem.createMany({
          data: galleries.map((externalId, index) => ({
            id: ids[index],
            providerKey: 'e-hentai',
            externalId,
            sourceId: index < 2 ? sourceA : index === 2 ? sourceB : null,
            sourceDisplayName: 'Original ignore source',
            title: 'Ignored fixture',
            ignoredAt: now
          }))
        })
        const dependencies = { database: transaction as PrismaClient, sourceKind: 'ALL' as const }
        const first = await listArchiveUploaderIgnoredItems({ sourceId: sourceB, limit: 1 }, dependencies)
        expect(first.totalCount).toBe(2)
        expect(first.items.map(({ id }) => id)).toEqual([ids[1]])
        expect(first.items[0]?.catalogItemId).toBe(`${sourceB}-${galleries[1]}`)
        const next = await listArchiveUploaderIgnoredItems(
          { sourceId: sourceB, limit: 1, cursor: first.nextCursor },
          dependencies
        )
        expect(next.totalCount).toBe(2)
        expect(next.items.map(({ id }) => id)).toEqual([ids[0]])
        expect(next.items[0]?.catalogItemId).toBe(`${sourceB}-${galleries[0]}`)
        expect(next.nextCursor).toBeNull()
        const afterEnd = await listArchiveUploaderIgnoredItems(
          { sourceId: sourceB, cursor: { id: ids[0]!, ignoredAt: now } },
          dependencies
        )
        expect(afterEnd.items).toEqual([])
        expect(afterEnd.totalCount).toBe(2)

        await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: [ids[0]!] }, dependencies)
        expect((await listArchiveUploaderIgnoredItems({ sourceId: sourceA }, dependencies)).totalCount).toBe(1)
        expect((await listArchiveUploaderIgnoredItems({ sourceId: sourceB }, dependencies)).totalCount).toBe(1)
        expect(await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: [ids[0]!] }, dependencies)).toEqual({
          restoredCount: 0
        })

        await transaction.archiveUploaderSource.delete({ where: { id: sourceA } })
        const remaining = await listArchiveUploaderIgnoredItems({ sourceId: sourceB }, dependencies)
        expect(remaining.items.map(({ id }) => id)).toEqual([ids[1]])
        expect(remaining.items[0]?.sourceDisplayName).toBe('Original ignore source')
        await transaction.archiveUploaderSource.delete({ where: { id: sourceB } })
        const global = await listArchiveUploaderIgnoredItems({}, dependencies)
        expect(global.items.filter(({ id }) => ids.includes(id)).map(({ catalogItemId }) => catalogItemId)).toEqual([
          null,
          null,
          null
        ])
        await expect(listArchiveUploaderIgnoredItems({ sourceId: sourceB }, dependencies)).rejects.toMatchObject({
          code: 'STATE_CONFLICT'
        })
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
