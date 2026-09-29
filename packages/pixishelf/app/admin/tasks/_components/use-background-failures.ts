'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { VirtualItem } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { uniqueHistoryItems } from './background-history-state'
import { useOptionalBackgroundJobEventSubscription } from '../../_components/background-job-event-provider'
import { collectUnseenLiveEvents, type LiveEventCursor } from './live-event-reconciliation'

export const MAX_SELECTED_FAILURES = 100

export function useBackgroundFailures(enabled: boolean, totalCount: number, refreshDashboard?: () => Promise<unknown>) {
  const trpc = useTRPC()
  const live = useOptionalBackgroundJobEventSubscription()
  const eventCursor = useRef<LiveEventCursor>({
    resetVersion: live.resetVersion,
    eventId: live.items.at(-1)?.event.id ?? null
  })
  const [eventUpdates, setEventUpdates] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null)
  const pruneAfterRefresh = useRef(false)
  const browsing = useRef({ offset: 0, focusId: null as string | null, measurements: [] as VirtualItem[] })
  const options = trpc.job.backgroundFailures.infiniteQueryOptions(
    { limit: 50 },
    {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      trpc: { abortOnUnmount: true }
    }
  )
  const query = useInfiniteQuery({
    ...options,
    queryKey: [[...options.queryKey[0], `browse-${generation}`], options.queryKey[1]],
    enabled,
    staleTime: Infinity,
    gcTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false
  })
  const head = useQuery(
    trpc.job.backgroundFailures.queryOptions(
      { limit: 1 },
      {
        enabled,
        refetchInterval: enabled ? 30_000 : false,
        refetchOnWindowFocus: false,
        retry: false
      }
    )
  )
  const items = useMemo(() => uniqueHistoryItems(query.data?.pages ?? []), [query.data])

  useEffect(() => {
    if (!query.data) return
    if (snapshotCount === null) setSnapshotCount(totalCount)
    if (pruneAfterRefresh.current) {
      pruneAfterRefresh.current = false
      const available = new Set(items.map(({ id }) => id))
      setSelectedIds((previous) => new Set([...previous].filter((id) => available.has(id))))
    }
  }, [query.data, items, totalCount, snapshotCount])

  useEffect(() => {
    if (enabled) void head.refetch()
  }, [enabled, generation, head.refetch])

  useEffect(() => {
    const unseen = collectUnseenLiveEvents(live.items, live.resetVersion, eventCursor.current)
    eventCursor.current = unseen.cursor
    if (unseen.items.some(({ event, job }) => job.status === 'FAILED' || event.type === 'job.queued')) {
      setEventUpdates(true)
    }
  }, [live.items, live.resetVersion])

  const refresh = useCallback(
    (clearSelection = false) => {
      if (!clearSelection) void refreshDashboard?.()
      if (clearSelection) setSelectedIds(new Set())
      pruneAfterRefresh.current = true
      setSnapshotCount(null)
      setEventUpdates(false)
      browsing.current = { offset: 0, focusId: null, measurements: [] }
      setGeneration((value) => value + 1)
    },
    [refreshDashboard]
  )
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const toggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (!checked) next.delete(id)
      else if (next.size < MAX_SELECTED_FAILURES) next.add(id)
      return next
    })
  }, [])
  const selectLoaded = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(items.slice(0, MAX_SELECTED_FAILURES).map(({ id }) => id)) : new Set())
    },
    [items]
  )

  return {
    query,
    items,
    generation,
    browsing,
    selectedIds,
    toggle,
    selectLoaded,
    clearSelection,
    refresh,
    hasUpdates: Boolean(
      query.data &&
        (eventUpdates ||
          (snapshotCount !== null && snapshotCount !== totalCount) ||
          (head.data && head.data.items[0]?.id !== items[0]?.id))
    )
  }
}

export type BackgroundFailuresController = ReturnType<typeof useBackgroundFailures>
