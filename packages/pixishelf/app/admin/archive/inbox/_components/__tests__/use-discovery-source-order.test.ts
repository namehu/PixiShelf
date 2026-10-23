import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { sortDiscoverySources, type SourceListSort } from '../archive-discovery-filter-state'
import { useDiscoverySourceOrder } from '../use-discovery-source-order'
import { source } from './archive-uploader-sources-fixtures'

type Source = Parameters<typeof sortDiscoverySources>[0][number]
const baseSource: Source = {
  ...source,
  status: 'ACTIVE',
  identityKind: 'UID',
  uidBindingState: 'BOUND',
  latestCoverage: 'CURRENT',
  historyCoverage: 'HAS_MORE',
  sourceKind: 'UPLOADER',
  titleQuery: null,
  defaultCreators: [],
  latestRun: null,
  createdAt: source.createdAt.toISOString(),
  updatedAt: source.updatedAt.toISOString(),
  lastScanAt: source.lastScanAt.toISOString(),
  lastSuccessAt: source.lastSuccessAt.toISOString()
}
const sources: Source[] = [
  {
    ...baseSource,
    id: 'a',
    displayName: '画集 2',
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-02-03T00:00:00Z',
    catalogCounts: { ...source.catalogCounts, actionable: 10 }
  },
  {
    ...baseSource,
    id: 'b',
    displayName: '画集 10',
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    catalogCounts: { ...source.catalogCounts, actionable: 0 }
  },
  {
    ...baseSource,
    id: 'c',
    displayName: '画集 1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    catalogCounts: { ...source.catalogCounts, actionable: 2 }
  }
]
const ids = (rows: readonly Source[]) => rows.map((row) => row.id)
afterEach(cleanup)

describe('discovery source sorting', () => {
  it.each<[SourceListSort, string[]]>([
    ['name-asc', ['c', 'a', 'b']],
    ['name-desc', ['b', 'a', 'c']],
    ['created-asc', ['c', 'a', 'b']],
    ['created-desc', ['b', 'a', 'c']],
    ['updated-asc', ['b', 'c', 'a']],
    ['updated-desc', ['a', 'c', 'b']],
    ['actionable-asc', ['b', 'c', 'a']],
    ['actionable-desc', ['a', 'c', 'b']]
  ])('sorts the entire collection by %s without mutating query data', (sort, expected) => {
    expect(ids(sortDiscoverySources(sources, sort))).toEqual(expected)
    expect(ids(sources)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties by ID and never treats unknown counts as zero', () => {
    const sameName = sources.map((item) => ({ ...item, displayName: '相同名称' })).reverse()
    expect(ids(sortDiscoverySources(sameName, 'name-desc'))).toEqual(['a', 'b', 'c'])
    const unknown = { ...sources[0]!, id: 'unknown', catalogCounts: null }
    for (const sort of ['actionable-asc', 'actionable-desc'] as const) {
      expect(sortDiscoverySources([unknown, ...sources], sort).at(-1)?.id).toBe('unknown')
    }
  })

  it('updates values without moving existing rows, and reapplies sorting when conditions change', () => {
    const { result, rerender } = renderHook(
      ({ rows, sort, filterKey }) => useDiscoverySourceOrder(rows, sort, filterKey, true),
      { initialProps: { rows: sources, sort: 'actionable-desc' as SourceListSort, filterKey: 'all' } }
    )
    expect(ids(result.current)).toEqual(['a', 'c', 'b'])
    const changed = sources
      .map((item) => ({ ...item, catalogCounts: { ...item.catalogCounts!, actionable: item.id === 'b' ? 100 : 1 } }))
      .reverse()
    rerender({ rows: changed, sort: 'actionable-desc', filterKey: 'all' })
    expect(ids(result.current)).toEqual(['a', 'c', 'b'])
    expect(result.current[2]?.catalogCounts?.actionable).toBe(100)
    rerender({ rows: changed, sort: 'actionable-desc', filterKey: 'search' })
    expect(ids(result.current)).toEqual(['b', 'a', 'c'])
    rerender({ rows: changed, sort: 'name-asc', filterKey: 'search' })
    expect(ids(result.current)).toEqual(['c', 'a', 'b'])
  })

  it('waits for statistics before fixing the first order, then appends newly discovered sources', () => {
    const { result, rerender } = renderHook(
      ({ rows, ready }) => useDiscoverySourceOrder(rows, 'actionable-desc', 'all', ready),
      { initialProps: { rows: sources.map((item) => ({ ...item, catalogCounts: null })) as Source[], ready: false } }
    )
    expect(result.current).toEqual([])
    rerender({ rows: sources, ready: true })
    expect(ids(result.current)).toEqual(['a', 'c', 'b'])
    const added = { ...sources[0]!, id: 'new', catalogCounts: { ...source.catalogCounts, actionable: 200 } }
    rerender({ rows: [added, ...sources], ready: true })
    expect(ids(result.current)).toEqual(['a', 'c', 'b', 'new'])
    rerender({ rows: [sources[1]!, added], ready: true })
    expect(ids(result.current)).toEqual(['b', 'new'])
  })
})
