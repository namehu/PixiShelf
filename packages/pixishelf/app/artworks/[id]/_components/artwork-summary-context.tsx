'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { buildArtworkStacks } from '@/lib/reading/artwork-stacks'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'
import { settleSummaryNavigation } from './artwork-summary-navigation'
import { saveStackRecovery, takeStackRecovery } from './artwork-stack-recovery'

const SummaryContext = createContext<ReturnType<typeof useStackSession> | null>(null)

function visibleMediaId(): number | undefined {
  const top = getAutoBrowseViewport().top
  const element = [...document.querySelectorAll<HTMLElement>('[data-summary-anchor]')]
    .find((element) => element.getBoundingClientRect().bottom > top)
  return element ? Number(element.dataset.summaryAnchor) : undefined
}

function useStackSession(artworkId: number, suppressRecoveryNavigation: boolean) {
  const reader = useArtworkReader()
  const index = reader?.initialization?.index
  const [mode, setMode] = useState<'complete' | 'stack'>('complete')
  const lastVisible = useRef<number | undefined>(undefined)
  const restored = useRef(false)
  const [activeByGroup, setActiveByGroup] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [snapshot, setSnapshot] = useState(index)
  const groups = useMemo(() => snapshot ? buildArtworkStacks(snapshot.items) : [], [snapshot])
  const byMediaId = useMemo(() => new Map(groups.flatMap((group) => group.mediaIds.map((id) => [id, group] as const))), [groups])
  const ready = Boolean(snapshot && !reader?.invalidated)
  const changingSnapshot = snapshot?.fingerprint !== index?.fingerprint
  const [anchor, setAnchor] = useState<{ mediaId: number; nonce: number } | null>(null)
  const [navigating, setNavigating] = useState(false)
  const navigationRef = useRef({ active: false, nonce: 0 })
  const beginNavigation = useCallback(() => {
    navigationRef.current = { active: true, nonce: navigationRef.current.nonce + 1 }
    setNavigating(true)
    return navigationRef.current.nonce
  }, [])
  const finishNavigation = useCallback((nonce: number, _focusGroupId?: string, mediaId?: number) => {
    settleSummaryNavigation({ mediaId,
      isCurrent: () => navigationRef.current.nonce === nonce && navigationRef.current.active,
      onSettled: () => { navigationRef.current.active = false; setNavigating(false) }
    })
  }, [])
  useEffect(() => () => { navigationRef.current.active = false }, [])
  const availableMediaIds = useRef<number[] | null>(null)
  const jump = useCallback((mediaId: number) => setAnchor({ mediaId, nonce: beginNavigation() }), [beginNavigation])
  const selectMedia = useCallback((mediaId: number) => {
    lastVisible.current = mediaId
    const group = byMediaId.get(mediaId)
    if (group) setActiveByGroup((prior) => new Map(prior).set(group.id, mediaId))
  }, [byMediaId])
  const reveal = useCallback((mediaId: number) => { selectMedia(mediaId); jump(mediaId) }, [selectMedia, jump])
  const rememberPreviewMedia = useCallback((mediaId: number) => { lastVisible.current = mediaId }, [])
  useEffect(() => {
    if (!ready) return
    const remember = () => {
      if (!navigationRef.current.active && !useArtworkAutoBrowseStore.getState().previewOpen) {
        lastVisible.current = visibleMediaId() ?? lastVisible.current
      }
    }
    remember()
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [ready])
  useEffect(() => {
    const owner = reader?.reading.ownerUserId
    if (!ready || !owner || restored.current) return
    restored.current = true
    const recovery = takeStackRecovery(() => window.sessionStorage, artworkId, owner)
    if (!recovery) return
    const target = byMediaId.has(recovery.mediaId) ? recovery.mediaId : groups[0]?.representativeMediaId
    if (target === undefined) return
    setMode(recovery.mode)
    if (!suppressRecoveryNavigation) reveal(target)
  }, [ready, reader?.reading.ownerUserId, artworkId, byMediaId, groups, reveal, suppressRecoveryNavigation])
  const reopen = () => {
    const owner = reader?.reading.ownerUserId
    const mediaId = lastVisible.current
    if (owner && mediaId !== undefined) saveStackRecovery(() => window.sessionStorage, artworkId, owner, { mediaId, mode, savedAt: Date.now() })
    reader?.reading.reopen()
  }
  useLayoutEffect(() => {
    if (!changingSnapshot) return
    const id = visibleMediaId()
    useArtworkAutoBrowseStore.getState().pause('manual')
    setSnapshot(index)
    const nextGroups = index ? buildArtworkStacks(index.items) : []
    const nextGroup = nextGroups.find((group) => group.mediaIds.includes(id ?? -1))
    setActiveByGroup(nextGroup && id !== undefined ? new Map([[nextGroup.id, id]]) : new Map())
    if (id !== undefined && nextGroup) jump(id)
  }, [changingSnapshot, index, jump])
  const changeMode = (next: 'complete' | 'stack') => {
    if (next === mode || (next === 'stack' && !ready)) return
    useArtworkAutoBrowseStore.getState().stop()
    const id = visibleMediaId()
    setMode(next)
    if (id !== undefined) reveal(id)
  }
  return { ready, mode: ready ? mode : 'complete' as const, groups, byMediaId, activeByGroup, anchor, reveal, selectMedia, changeMode, reopen, rememberPreviewMedia,
    fingerprint: snapshot?.fingerprint, availableMediaIds,
    navigating: navigating || changingSnapshot, navigationRef, beginNavigation, finishNavigation }
}

export function ArtworkSummaryProvider({ children, artworkId, suppressRecoveryNavigation = false }: React.PropsWithChildren<{ artworkId: number; suppressRecoveryNavigation?: boolean }>) {
  const value = useStackSession(artworkId, suppressRecoveryNavigation)
  return <SummaryContext.Provider value={value}>{children}</SummaryContext.Provider>
}
export function useArtworkSummary() { return useContext(SummaryContext) }
