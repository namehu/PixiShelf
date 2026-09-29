'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { VirtualItem } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import type { BackgroundHistoryItem } from '@/services/background-task/job-history-service'
import { useOptionalBackgroundJobEventSubscription } from '../../_components/background-job-event-provider'
import { ACTIVE_JOB_STATUSES } from './background-task-format'
import { collectUnseenLiveEvents, type LiveEventCursor } from './live-event-reconciliation'
import {
  emptyHistoryFilters,
  historyDateBoundary,
  mergeHistorySnapshot,
  uniqueHistoryItems,
  type HistoryFilters
} from './background-history-state'

export function useBackgroundHistory(open: boolean, refreshVersion: number) {
  const trpc = useTRPC()
  const live = useOptionalBackgroundJobEventSubscription()
  const [filters, setFilters] = useState(emptyHistoryFilters)
  const [generation, setGeneration] = useState(0)
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, BackgroundHistoryItem>>({})
  const [hasUpdates, setHasUpdates] = useState(false)
  const eventCursor = useRef<LiveEventCursor>({
    resetVersion: live.resetVersion,
    eventId: live.items.at(-1)?.event.id ?? null
  })
  const browsing = useRef({ offset: 0, focusId: null as string | null, measurements: [] as VirtualItem[] })
  const dateInvalid = Boolean(filters.from && filters.to && filters.from > filters.to)
  const input = {
    limit: 50,
    search: filters.search || undefined,
    statuses: filters.statuses,
    types: filters.types,
    triggerSources: filters.triggerSources,
    createdFrom: historyDateBoundary(filters.from),
    createdTo: historyDateBoundary(filters.to, true),
    includeBatchChildren: filters.includeBatchChildren
  }
  const options = trpc.job.backgroundHistory.infiniteQueryOptions(input, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    trpc: { abortOnUnmount: true }
  })
  const query = useInfiniteQuery({
    ...options,
    queryKey: [[...options.queryKey[0], `browse-${generation}`], options.queryKey[1]],
    enabled: open && !dateInvalid,
    staleTime: Infinity,
    gcTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false
  })
  const baseItems = useMemo(() => uniqueHistoryItems(query.data?.pages ?? []), [query.data])
  const headQuery = useQuery(
    trpc.job.backgroundHistory.queryOptions(
      { ...input, limit: 1 },
      {
        enabled: open && !dateInvalid,
        refetchInterval: live.status === 'connected' ? false : 30_000,
        refetchOnWindowFocus: false,
        retry: false
      }
    )
  )
  const items = useMemo(() => {
    const liveById = new Map(live.items.map((entry) => [entry.job.id, entry.job]))
    return baseItems.map((item) => {
      const snapshot = snapshots[item.id]
      let current = snapshot ? mergeHistorySnapshot(item, snapshot) : item
      const liveJob = liveById.get(item.id)
      if (liveJob && Date.parse(liveJob.updatedAt) > Date.parse(current.updatedAt)) {
        current = {
          ...current,
          status: liveJob.status,
          progress: liveJob.progress,
          stage: liveJob.stage,
          message: liveJob.message?.slice(0, 500) ?? null,
          errorCode: liveJob.errorCode,
          updatedAt: liveJob.updatedAt
        }
      }
      return current
    })
  }, [baseItems, snapshots, live.items])
  const visibleItems = useMemo(() => items.filter((item) => visibleIds.includes(item.id)), [items, visibleIds])
  const activeIds = visibleItems.filter((item) => ACTIVE_JOB_STATUSES.includes(item.status)).map((item) => item.id)
  const snapshotQuery = useQuery(
    trpc.job.backgroundHistorySnapshots.queryOptions(
      { ids: visibleIds.length ? visibleIds : ['__none__'] },
      {
        enabled: open && visibleIds.length > 0 && !dateInvalid,
        retry: false,
        refetchInterval: live.status === 'connected' ? false : 30_000,
        refetchOnWindowFocus: false
      }
    )
  )
  const activeSnapshotQuery = useQuery(
    trpc.job.backgroundHistorySnapshots.queryOptions(
      { ids: activeIds.length ? activeIds : ['__none__'] },
      {
        enabled: open && activeIds.length > 0 && !dateInvalid && live.status !== 'connected',
        refetchInterval: 3_000,
        refetchOnWindowFocus: false,
        retry: false
      }
    )
  )
  const snapshotItems = useMemo(
    () => [...(snapshotQuery.data?.items ?? []), ...(activeSnapshotQuery.data?.items ?? [])],
    [snapshotQuery.data, activeSnapshotQuery.data]
  )

  useEffect(() => {
    setSnapshots((previous) => {
      let next = previous
      const baseById = new Map(baseItems.map((item) => [item.id, item]))
      for (const item of items) {
        const base = baseById.get(item.id)
        if (!base || item.updatedAt === base.updatedAt || previous[item.id]?.updatedAt === item.updatedAt) continue
        if (next === previous) next = { ...previous }
        next[item.id] = item
      }
      return next
    })
  }, [items, baseItems])

  useEffect(() => {
    const head = headQuery.data?.items[0]
    if (query.data && head && !baseItems.some((item) => item.id === head.id)) setHasUpdates(true)
  }, [headQuery.data, query.data, baseItems])

  useEffect(() => {
    if (!snapshotItems.length) return
    setSnapshots((previous) => {
      const next = { ...previous }
      for (const item of snapshotItems) {
        const current = next[item.id]
        next[item.id] = !current || Date.parse(item.updatedAt) >= Date.parse(current.updatedAt) ? item : current
      }
      return next
    })
    if (
      snapshotItems.some((item) => {
        const base = baseItems.find((entry) => entry.id === item.id)
        return (
          base &&
          (base.status !== item.status ||
            (filters.search && (base.message !== item.message || base.error !== item.error)))
        )
      })
    ) {
      setHasUpdates(true)
    }
  }, [snapshotItems, baseItems, filters.search])

  useEffect(() => {
    const unseen = collectUnseenLiveEvents(live.items, live.resetVersion, eventCursor.current)
    eventCursor.current = unseen.cursor
    if (filters.search && unseen.items.length > 0) setHasUpdates(true)
    if (unseen.items.some(({ event }) => event.type !== 'job.progress' && event.type !== 'job.stage_changed')) {
      setHasUpdates(true)
      if (open && visibleIds.length) void snapshotQuery.refetch()
    }
  }, [live.items, live.resetVersion, open, visibleIds.length, snapshotQuery.refetch, filters.search])

  useEffect(() => {
    if (!open || dateInvalid) return
    if (visibleIds.length) void snapshotQuery.refetch()
    void headQuery.refetch()
  }, [
    open,
    live.readyVersion,
    live.resetVersion,
    refreshVersion,
    snapshotQuery.refetch,
    headQuery.refetch,
    visibleIds.length,
    dateInvalid
  ])

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1)
    setHasUpdates(false)
    setSnapshots({})
    setVisibleIds([])
    browsing.current = { offset: 0, focusId: null, measurements: [] }
  }, [])
  const changeFilters = useCallback(
    (next: HistoryFilters) => {
      setFilters(next)
      refresh()
    },
    [refresh]
  )
  const observeIds = useCallback((ids: string[]) => {
    setVisibleIds((previous) => (previous.join('\0') === ids.join('\0') ? previous : ids.slice(0, 100)))
  }, [])
  const retrySnapshots = useCallback(
    () =>
      Promise.all([
        snapshotQuery.refetch(),
        ...(live.status !== 'connected' && activeIds.length ? [activeSnapshotQuery.refetch()] : [])
      ]),
    [snapshotQuery.refetch, activeSnapshotQuery.refetch, live.status, activeIds.length]
  )
  return {
    query,
    items,
    filters,
    changeFilters,
    refresh,
    hasUpdates,
    dateInvalid,
    observeIds,
    browsing,
    generation,
    snapshotError: snapshotQuery.isError || (live.status !== 'connected' && activeSnapshotQuery.isError),
    retrySnapshots
  }
}

export type BackgroundHistoryController = ReturnType<typeof useBackgroundHistory>
