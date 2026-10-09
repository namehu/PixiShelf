import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ counts: vi.fn(), items: vi.fn() }))
vi.mock('../archive-uploader-catalog-state', async (original) => ({
  ...(await original<typeof import('../archive-uploader-catalog-state')>()),
  getArchiveUploaderCatalogCounts: mocks.counts,
  listArchiveUploaderCatalogState: mocks.items
}))
import {
  archiveDiscoveryCatalogCountsSchema,
  getArchiveDiscoveryCatalogCounts,
  getArchiveUploaderSource,
  listArchiveUploaderSources,
  listArchiveUploaderScanItems
} from '../archive-uploader-service'

const counts = { actionable: 2, processing: 1, archived: 3, attention: 0, total: 6 }
const source = {
  lastErrorMessage: null,
  id: 'source',
  runs: [],
  lastSuccessAt: null,
  incrementalCursor: null,
  historyCursor: null
}
function database() {
  return {
    archiveUploaderSource: {
      findMany: vi.fn().mockResolvedValue([source]),
      findUnique: vi.fn().mockResolvedValue(source)
    },
    artworkExternalRef: { findMany: vi.fn().mockResolvedValue([]) },
    discoveryPendingCreator: { findMany: vi.fn().mockResolvedValue([]) }
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.counts.mockResolvedValue(new Map([['source', counts]]))
  mocks.items.mockResolvedValue({ items: [], nextCursor: null })
})

describe('independent discovery counts', () => {
  it.each(['sources', 'detail', 'items'] as const)(
    '%s can omit counts without executing the aggregate',
    async (kind) => {
      const deps = { database: database() as never, includeCounts: false }
      if (kind === 'sources') expect((await listArchiveUploaderSources({}, deps))[0]?.catalogCounts).toBeNull()
      if (kind === 'detail') {
        expect((await getArchiveUploaderSource({ sourceId: 'source' }, deps)).source.catalogCounts).toBeNull()
      }
      if (kind === 'items') expect((await listArchiveUploaderScanItems({ sourceId: 'source' }, deps)).counts).toBeNull()
      expect(mocks.counts).not.toHaveBeenCalled()
    }
  )

  it('preserves legacy counts when includeCounts is omitted', async () => {
    const deps = { database: database() as never }
    expect((await listArchiveUploaderSources({}, deps))[0]?.catalogCounts).toEqual(counts)
    expect((await getArchiveUploaderSource({ sourceId: 'source' }, deps)).source.catalogCounts).toEqual(counts)
    expect((await listArchiveUploaderScanItems({ sourceId: 'source' }, deps)).counts).toEqual(counts)
    expect(mocks.counts).toHaveBeenCalledTimes(3)
  })

  it('includes inactive and empty sources and fills zero counts only for known sources', async () => {
    const db = database()
    db.archiveUploaderSource.findMany.mockResolvedValue([{ ...source, id: 'empty' }, source])
    expect(await getArchiveDiscoveryCatalogCounts({}, { database: db as never, sourceKind: 'ALL' })).toEqual({
      source: counts,
      empty: { actionable: 0, processing: 0, archived: 0, attention: 0, total: 0 }
    })
    expect(db.archiveUploaderSource.findMany).toHaveBeenCalledWith({ where: {}, select: { id: true } })
  })

  it('validates unbound scope and rejects a missing source before aggregation', async () => {
    expect(archiveDiscoveryCatalogCountsSchema.safeParse({ unboundOnly: true }).success).toBe(false)
    const db = database()
    db.archiveUploaderSource.findMany.mockResolvedValue([])
    await expect(
      getArchiveDiscoveryCatalogCounts({ sourceId: 'missing' }, { database: db as never })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.counts).not.toHaveBeenCalled()
  })

  it('scopes content filters to a source and passes the same filters to items and counts', async () => {
    const filters = { search: 'hello', languages: ['chinese'] }
    expect(archiveDiscoveryCatalogCountsSchema.safeParse({ filters }).success).toBe(false)
    const db = database()
    await listArchiveUploaderScanItems({ sourceId: 'source', filters }, { database: db as never })
    const itemFilters = mocks.items.mock.calls[0]?.[1].filters
    expect(mocks.counts).toHaveBeenLastCalledWith(db, ['source'], false, itemFilters)
    await getArchiveDiscoveryCatalogCounts({ sourceId: 'source', filters }, { database: db as never })
    expect(mocks.counts).toHaveBeenLastCalledWith(db, ['source'], false, itemFilters)
  })

  it('passes only the selected source and unbound filter to the aggregate', async () => {
    const db = database()
    await getArchiveDiscoveryCatalogCounts(
      { sourceId: 'source', unboundOnly: true },
      { database: db as never, sourceKind: 'ALL' }
    )
    expect(db.archiveUploaderSource.findMany).toHaveBeenCalledWith({ where: { id: 'source' }, select: { id: true } })
    expect(mocks.counts).toHaveBeenCalledWith(db, ['source'], true, undefined)
  })
})
