import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  addArchiveUploaderScanItems,
  createArchiveTitleSource,
  getArchiveUploaderSource,
  listArchiveUploaderScanItems,
  listArchiveUploaderSources,
  renameArchiveTitleSource,
  setArchiveUploaderSourceArchived,
  setArchiveUploaderUid,
  triggerArchiveUploaderScan,
  ignoreArchiveUploaderScanItems,
  restoreArchiveUploaderIgnoredItems
} from '../archive-uploader-service'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `title-test-${randomUUID()}`
const sourceIds: string[] = []
const deps = { database: database!, sourceKind: 'ALL' as const }
async function source(suffix: string) {
  const result = await createArchiveTitleSource(
    { displayName: `${prefix}-${suffix}`, keyword: `${prefix} ${suffix}` },
    deps
  )
  sourceIds.push(result.id)
  return result
}

describe.skipIf(!database).sequential('title discovery PostgreSQL workflow', () => {
  afterAll(async () => {
    if (!database) return
    await database.archiveUploaderIgnoredItem.deleteMany({ where: { sourceId: { in: sourceIds } } })
    await database.archiveUploaderSource.deleteMany({ where: { id: { in: sourceIds } } })
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
    await database.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
    await database.$disconnect()
  })

  it.each([1, 2, 3, 4, 5])('deduplicates concurrent first creation with no source (round %i)', async (round) => {
    const displayName = `${prefix}-first-create-${round}`
    const keyword = `${prefix} first-create ${round}`
    expect(await database!.archiveUploaderSource.count({ where: { displayName } })).toBe(0)
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        createArchiveTitleSource({ displayName, keyword: index % 2 ? ` ${keyword.toUpperCase()} ` : keyword }, deps)
      )
    )
    const created = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    sourceIds.push(...created.map((item) => item.id))
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(created).toHaveLength(12)
    expect(new Set(created.map((item) => item.id)).size).toBe(1)
    expect(await database!.archiveUploaderSource.count({ where: { displayName } })).toBe(1)
  })

  it('deduplicates concurrent normalized queries without overwriting a disabled source or its name', async () => {
    const first = await source('dedup')
    await setArchiveUploaderSourceArchived({ sourceId: first.id, archived: true }, deps)
    const duplicates = await Promise.all(
      Array.from({ length: 3 }, () =>
        createArchiveTitleSource({ displayName: 'must not rename', keyword: ` ${prefix.toUpperCase()} DEDUP ` }, deps)
      )
    )
    expect(
      duplicates.every(
        (item) => item.id === first.id && item.status === 'ARCHIVED' && item.displayName === first.displayName
      )
    ).toBe(true)
    await setArchiveUploaderSourceArchived({ sourceId: first.id, archived: false }, deps)
    await expect(getArchiveUploaderSource({ sourceId: first.id }, deps)).resolves.toMatchObject({
      source: { status: 'ACTIVE' }
    })
  })

  it('freezes the query into one resolver job, permits renaming but rejects legacy UID operations', async () => {
    const first = await source('frozen')
    const run = await triggerArchiveUploaderScan({ sourceId: first.id, mode: 'LATEST' }, prefix, deps)
    await renameArchiveTitleSource({ sourceId: first.id, displayName: `${prefix}-renamed` }, deps)
    expect(run).toMatchObject({ titleQuery: first.titleQuery, searchIdentityKind: null, searchIdentityValue: null })
    await expect(database!.systemJob.findUniqueOrThrow({ where: { id: run.systemJobId } })).resolves.toMatchObject({
      type: 'ARCHIVE_SEARCH_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      payload: { scanRunId: run.id }
    })
    await expect(
      triggerArchiveUploaderScan({ sourceId: first.id, mode: 'LATEST' }, prefix, deps)
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(setArchiveUploaderUid({ sourceId: first.id, uploaderUid: '123' }, deps)).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    await expect(getArchiveUploaderSource({ sourceId: first.id }, { database: database! })).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    const legacy = await listArchiveUploaderSources({}, { database: database! })
    expect(legacy.some((item) => item.id === first.id)).toBe(false)
    await expect(database!.archiveUploaderSource.findUniqueOrThrow({ where: { id: first.id } })).resolves.toMatchObject(
      { titleQuery: first.titleQuery, uploaderUid: null }
    )
  })

  it('hides stale nonmatches from counts and refuses their intake without global ignore', async () => {
    const first = await source('stale')
    const item = await catalog(first.id, false)
    await expect(listArchiveUploaderScanItems({ sourceId: first.id }, deps)).resolves.toMatchObject({ items: [] })
    await expect(getArchiveUploaderSource({ sourceId: first.id }, deps)).resolves.toMatchObject({
      source: { catalogCounts: { total: 0 } }
    })
    await expect(
      addArchiveUploaderScanItems(
        { sourceId: first.id, itemIds: [item.id], submissionAttemptId: randomUUID() },
        prefix,
        deps
      )
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(await database!.archiveUploaderIgnoredItem.count({ where: { externalId: item.externalId } })).toBe(0)
  })

  it('shares global ignore and a single intake identity across matching sources', async () => {
    const a = await source('cross-a')
    const b = await source('cross-b')
    const itemA = await catalog(a.id, true)
    const itemB = await catalog(b.id, true, itemA.externalId)
    const ignored = await ignoreArchiveUploaderScanItems({ sourceId: a.id, itemIds: [itemA.id] }, prefix, deps)
    await expect(listArchiveUploaderScanItems({ sourceId: b.id }, deps)).resolves.toMatchObject({ items: [] })
    await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: ignored.ignoredItemIds }, deps)
    const results = await Promise.allSettled([
      addArchiveUploaderScanItems(
        { sourceId: a.id, itemIds: [itemA.id], submissionAttemptId: randomUUID() },
        prefix,
        deps
      ),
      addArchiveUploaderScanItems(
        { sourceId: b.id, itemIds: [itemB.id], submissionAttemptId: randomUUID() },
        prefix,
        deps
      )
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const items = await database!.archiveUploaderCatalogItem.findMany({ where: { id: { in: [itemA.id, itemB.id] } } })
    expect(new Set(items.map((item) => item.lastIntakeItemId)).size).toBe(1)
    expect(items[0]?.lastIntakeItemId).not.toBeNull()
    expect(await database!.archiveIntakeItem.count({ where: { submittedUrl: itemA.canonicalUrl } })).toBe(1)
  })
})

async function catalog(sourceId: string, matchesQuery: boolean, gid?: string) {
  const externalId = gid ?? BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`).toString()
  return database!.archiveUploaderCatalogItem.create({
    data: {
      sourceId,
      providerKey: 'e-hentai',
      externalId,
      canonicalUrl: `https://e-hentai.org/g/${externalId}/token/`,
      title: 'test title',
      relationships: [],
      classification: 'NEW',
      matchesQuery,
      firstSeenAt: new Date(),
      lastSeenAt: new Date()
    }
  })
}
