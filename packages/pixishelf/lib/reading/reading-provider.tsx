'use client'

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ReadingSummaryDto, ReadingMarkReadInput } from '@pixishelf/db/reading-contract'
import { useAuthUser, useAuthStore } from '@/components/auth/auth-provider'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { ReadingCollector, isRevisionConflict, type ReadingObservation } from './reading-collector'
import { patchReadingSummaryInCache, reconcileReadingCache } from './reading-cache'

type SurfaceObservation = Omit<ReadingObservation, 'artworkId'>

interface ReadingProviderValue {
  collector: ReadingCollector
  ownerUserId: string | null
  revision: number
  invalidated: Set<number>
  errors: Map<number, unknown>
}

const ReadingContext = createContext<ReadingProviderValue | null>(null)
const EMPTY_INVALIDATED = new Set<number>()
const EMPTY_ERRORS = new Map<number, unknown>()

function useReadingProvider() {
  const value = useContext(ReadingContext)
  if (!value) throw new Error('ReadingProvider is required')
  return value
}

export function ReadingProvider({ children }: React.PropsWithChildren) {
  const ownerUserId = useAuthUser()?.id ?? null
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const [revision, setRevision] = useState(0)
  const [invalidated, setInvalidated] = useState<Set<number>>(() => new Set())
  const [errors, setErrors] = useState<Map<number, unknown>>(() => new Map())
  const availableRef = useRef<boolean | null>(null)
  const stateOwnerRef = useRef(ownerUserId)
  const collector = useMemo(() => {
    const engine = new ReadingCollector({
      report: (input, signal) => trpcClient.reading.report.mutate(input, { signal }),
      onSummary: (summary, expectedUserId, result) => {
        if (useAuthStore.getState().user?.id !== expectedUserId) return
        setErrors((prior) => {
          if (!prior.has(summary.artworkId)) return prior
          const next = new Map(prior)
          next.delete(summary.artworkId)
          return next
        })
        patchReadingSummaryInCache(queryClient, summary, expectedUserId, result)
      },
      onInvalidated: (artworkId, expectedUserId) => {
        if (useAuthStore.getState().user?.id !== expectedUserId) return
        setInvalidated((prior) => new Set(prior).add(artworkId))
        setRevision((prior) => prior + 1)
      },
      onCompleted: (summary, expectedUserId) => {
        if (useAuthStore.getState().user?.id !== expectedUserId) return
        toast.custom(() => (
          <div className="flex w-[var(--width)] justify-center max-[600px]:w-full">
            <span className="rounded-full border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-sm">
              已看完
            </span>
          </div>
        ), {
          id: `reading-completed-${expectedUserId}-${summary.artworkId}`,
          position: 'bottom-center',
          duration: 2000
        })
      },
      onError: (error, artworkId, expectedUserId) => {
        if (useAuthStore.getState().user?.id !== expectedUserId) return
        setErrors((prior) => new Map(prior).set(artworkId, error))
      }
    })
    engine.setAccount(ownerUserId)
    return engine
  }, [ownerUserId, queryClient, trpcClient])

  useLayoutEffect(() => {
    collector.setAccount(ownerUserId)
    collector.setAvailability(!document.hidden, navigator.onLine)
    stateOwnerRef.current = ownerUserId
    setInvalidated(new Set())
    setErrors(new Map())
    setRevision((prior) => prior + 1)
    return () => collector.dispose()
  }, [collector, ownerUserId])

  useEffect(() => {
    if (!ownerUserId) return
    let reconciling = false
    return queryClient.getQueryCache().subscribe((event) => {
      if (reconciling || event.type !== 'updated' || event.action.type !== 'success') return
      reconciling = true
      try { reconcileReadingCache(queryClient, ownerUserId) } finally { reconciling = false }
    })
  }, [queryClient, ownerUserId])

  useEffect(() => {
    const syncAvailability = () => {
      const available = !document.hidden && navigator.onLine
      collector.setAvailability(!document.hidden, navigator.onLine)
      if (available && availableRef.current === false) setRevision((prior) => prior + 1)
      availableRef.current = available
    }
    const handlePageHide = () => { void collector.flush() }
    syncAvailability()
    document.addEventListener('visibilitychange', syncAvailability)
    window.addEventListener('online', syncAvailability)
    window.addEventListener('offline', syncAvailability)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', syncAvailability)
      window.removeEventListener('online', syncAvailability)
      window.removeEventListener('offline', syncAvailability)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [collector])

  return (
    <ReadingContext.Provider value={{
      collector,
      ownerUserId,
      revision,
      invalidated: stateOwnerRef.current === ownerUserId ? invalidated : EMPTY_INVALIDATED,
      errors: stateOwnerRef.current === ownerUserId ? errors : EMPTY_ERRORS
    }}>
      {children}
    </ReadingContext.Provider>
  )
}

export function useArtworkReading(artworkId: number) {
  const { collector, ownerUserId, revision, invalidated, errors } = useReadingProvider()
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const markingRef = useRef(false)
  const [marking, setMarking] = useState(false)
  const [markError, setMarkError] = useState<string | null>(null)
  const contextQuery = useQuery(trpc.reading.context.queryOptions(
    { artworkId, expectedUserId: ownerUserId ?? '' },
    { enabled: Boolean(ownerUserId && artworkId > 0), staleTime: 0 }
  ))
  const context = !invalidated.has(artworkId) && ownerUserId ? contextQuery.data : undefined

  useEffect(() => {
    if (context && ownerUserId) collector.setContext(context, ownerUserId)
  }, [collector, context, ownerUserId])
  useEffect(() => () => collector.clearArtwork(artworkId), [artworkId, collector])

  const observe = useCallback((surfaceId: string, observation: SurfaceObservation) => {
    collector.observe(surfaceId, { ...observation, artworkId })
  }, [collector, artworkId])
  const clearSurface = useCallback((surfaceId: string) => collector.clearSurface(surfaceId), [collector])
  const flush = useCallback(() => collector.flush(), [collector])
  const reopenReader = useCallback(() => {
    // Reload the displayed media and reading revision together across all reader entry points.
    // Keep the old collector invalidated until navigation destroys it.
    window.location.reload()
  }, [])

  const markRead = useCallback(async (target: ReadingMarkReadInput['target']) => {
    if (!context || !ownerUserId || markingRef.current || invalidated.has(artworkId)) return
    markingRef.current = true
    setMarking(true)
    setMarkError(null)
    try {
      const result = await trpcClient.reading.markRead.mutate({
        artworkId, expectedUserId: ownerUserId, mediaRevision: context.mediaRevision, target
      })
      if (useAuthStore.getState().user?.id !== ownerUserId) return
      patchReadingSummaryInCache(queryClient, result.summary, ownerUserId, result)
      collector.setContext({ ...context, ...result }, ownerUserId)
    } catch (error) {
      if (useAuthStore.getState().user?.id !== ownerUserId) return
      if (isRevisionConflict(error)) collector.invalidateArtwork(artworkId)
      else setMarkError('标记未保存，请重试。')
    } finally {
      markingRef.current = false
      setMarking(false)
    }
  }, [artworkId, collector, context, invalidated, ownerUserId, queryClient, trpcClient])

  useEffect(() => { setMarkError(null) }, [ownerUserId, artworkId])

  return {
    ownerUserId,
    markRead,
    marking,
    markError,
    context,
    summary: context?.summary ?? null,
    resume: context?.resume ?? null,
    isLoading: contextQuery.isLoading,
    observationEpoch: revision,
    error: errors.get(artworkId) ?? contextQuery.error,
    invalidated: invalidated.has(artworkId),
    observe,
    clearSurface,
    flush,
    reopen: reopenReader
  }
}

export type ArtworkReadingHandle = ReturnType<typeof useArtworkReading>

/** One request per 100 artworks, independent of the number of mounted cards. */
export function useReadingSummaries(artworkIds: number[]) {
  const { ownerUserId } = useReadingProvider()
  const trpcClient = useTRPCClient()
  const ids = useMemo(() => [...new Set(artworkIds)].filter((id) => id > 0).sort((a, b) => a - b), [artworkIds])
  const idsKey = ids.join(',')
  const query = useQuery({
    queryKey: ['reading', 'summaries', ownerUserId, idsKey],
    enabled: Boolean(ownerUserId && ids.length),
    queryFn: async ({ signal }) => {
      if (!ownerUserId) return []
      const chunks: number[][] = []
      for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100))
      const results = await Promise.all(chunks.map((chunk) => trpcClient.reading.summaries.query(
        { artworkIds: chunk, expectedUserId: ownerUserId }, { signal }
      )))
      return results.flatMap((result) => result.summaries)
    }
  })
  const byArtworkId = useMemo(() => {
    const map = new Map<number, ReadingSummaryDto>()
    for (const summary of query.data ?? []) map.set(summary.artworkId, summary)
    return map
  }, [query.data])
  return { ...query, byArtworkId }
}
