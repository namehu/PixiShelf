'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthUser } from '@/components/auth/auth-provider'
import { useTRPC } from '@/lib/trpc'
import { useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'
import { settleSummaryNavigation } from './artwork-summary-navigation'

const SummaryContext = createContext<ReturnType<typeof useSummarySession> | null>(null)

function visibleMediaId(): number | undefined {
  const top = getAutoBrowseViewport().top
  const element = [...document.querySelectorAll<HTMLElement>('[data-summary-anchor]')]
    .find((element) => element.getBoundingClientRect().bottom > top)
  return element ? Number(element.dataset.summaryAnchor) : undefined
}

function useSummarySession(artworkId: number) {
  const user = useAuthUser()
  const reader = useArtworkReader()
  const trpc = useTRPC()
  const query = useQuery({ ...trpc.artwork.summaryGet.queryOptions({ artworkId, expectedUserId: user?.id ?? '' }),
    enabled: Boolean(user), refetchInterval: (query) => query.state.data?.state === 'BUILDING' ? 3_000 : 30_000,
    refetchOnWindowFocus: true })
  const generate = useMutation(trpc.artwork.summaryGenerate.mutationOptions({
    onSuccess: () => { void query.refetch() }, onError: (error) => toast.error(error.message)
  }))
  const [requestedMode, setMode] = useState<'complete' | 'summary'>('complete')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<{ mediaId: number; nonce: number; focusGroupId?: string } | null>(null)
  const [navigating, setNavigating] = useState(false)
  const navigationRef = useRef({ active: false, nonce: 0 })
  const beginNavigation = useCallback(() => {
    navigationRef.current = { active: true, nonce: navigationRef.current.nonce + 1 }
    setNavigating(true)
    return navigationRef.current.nonce
  }, [])
  const finishNavigation = useCallback((nonce: number, focusGroupId?: string, mediaId?: number) => {
    settleSummaryNavigation({
      mediaId,
      isCurrent: () => navigationRef.current.nonce === nonce && navigationRef.current.active,
      onSettled: () => {
        navigationRef.current.active = false
        setNavigating(false)
        if (focusGroupId) document.querySelector<HTMLButtonElement>(`[data-summary-toggle="${CSS.escape(focusGroupId)}"]`)?.focus({ preventScroll: true })
      }
    })
  }, [])
  useEffect(() => () => { navigationRef.current.active = false }, [])
  const ready = query.data?.state === 'READY' && !reader?.invalidated
  // Hold the old projection until its visible ID is captured, before React replaces its DOM.
  const [snapshot, setSnapshot] = useState({ data: query.data, ready })
  const changingSnapshot = snapshot.data?.generationId !== query.data?.generationId || snapshot.ready !== ready
  const mode = snapshot.ready ? requestedMode : 'complete'
  const groups = useMemo(() => snapshot.ready ? snapshot.data!.groups : [], [snapshot])
  const availableMediaIds = useRef<number[] | null>(null)
  const jump = useCallback((mediaId: number, focusGroupId?: string) => setAnchor({ mediaId, nonce: beginNavigation(), focusGroupId }), [beginNavigation])
  useLayoutEffect(() => {
    if (changingSnapshot && snapshot.ready) {
      const id = visibleMediaId()
      setMode('complete')
      setExpanded(new Set())
      useArtworkAutoBrowseStore.getState().pause('manual')
      if (id !== undefined) jump(id)
    }
    if (snapshot.data !== query.data || snapshot.ready !== ready) setSnapshot({ data: query.data, ready })
  }, [query.data, ready, changingSnapshot, snapshot, jump])
  const reveal = useCallback((mediaId: number) => {
    const group = groups.find((group) => group.mediaIds.includes(mediaId))
    const representativeId = group?.mediaIds.find((id) => availableMediaIds.current === null || availableMediaIds.current.includes(id))
    if (group && representativeId !== mediaId) setExpanded((prior) => new Set(prior).add(group.id))
    jump(mediaId)
  }, [groups, jump])
  const changeMode = (next: 'complete' | 'summary') => {
    if (next === mode || (next === 'summary' && !ready)) return
    useArtworkAutoBrowseStore.getState().pause('manual')
    const id = visibleMediaId()
    setMode(next)
    if (id !== undefined) reveal(id)
  }
  const toggleGroup = (groupId: string, representativeId: number) => {
    useArtworkAutoBrowseStore.getState().pause('manual')
    setExpanded((prior) => { const next = new Set(prior); if (next.has(groupId)) next.delete(groupId); else next.add(groupId); return next })
    jump(representativeId, groupId)
  }
  return { query, generate, ready, mode, groups, expanded, anchor, reveal, changeMode, toggleGroup,
    availableMediaIds, navigating: navigating || changingSnapshot || (requestedMode === 'summary' && !ready), navigationRef, beginNavigation, finishNavigation,
    start: () => generate.mutate({ artworkId, expectedUserId: user?.id ?? '', requestId: crypto.randomUUID(), force: Boolean(query.data?.generationId) }) }
}

export function ArtworkSummaryProvider({ artworkId, children }: React.PropsWithChildren<{ artworkId: number }>) {
  const value = useSummarySession(artworkId)
  return <SummaryContext.Provider value={value}>{children}</SummaryContext.Provider>
}
export function useArtworkSummary() { return useContext(SummaryContext) }
