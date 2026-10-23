'use client'

import { useMemo, useState } from 'react'
import { sortDiscoverySources, type SourceListSort } from './archive-discovery-filter-state'

const EMPTY_IDS: string[] = []

export function useDiscoverySourceOrder(
  sources: Parameters<typeof sortDiscoverySources>[0],
  sort: SourceListSort,
  filterKey: string,
  ready: boolean
) {
  const key = JSON.stringify([filterKey, sort])
  const [snapshot, setSnapshot] = useState({ key, ids: EMPTY_IDS })
  const previousIds = snapshot.key === key ? snapshot.ids : EMPTY_IDS
  const ordered = useMemo(() => {
    if (!ready) return []
    const sorted = sortDiscoverySources(sources, sort)
    const byId = new Map(sorted.map((source) => [source.id, source]))
    const previous = previousIds.flatMap((id) => {
      const source = byId.get(id)
      byId.delete(id)
      return source ? [source] : []
    })
    // Polling updates row data in place; only an explicit sort/filter change resets order.
    return [...previous, ...byId.values()]
  }, [sources, sort, previousIds, ready])

  if (
    ready &&
    (snapshot.key !== key ||
      snapshot.ids.length !== ordered.length ||
      ordered.some((source, index) => source.id !== snapshot.ids[index]))
  ) {
    setSnapshot({ key, ids: ordered.map((source) => source.id) })
  }

  return ordered
}
