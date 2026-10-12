'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { CompressedInputCache, PlaybackPressure } from '@pixishelf/webp-player'
import { useWebpPlayerStore } from '@/store/use-webp-player-store'

interface PreviewSession {
  inputCache: CompressedInputCache
  pressure: PlaybackPressure
}
const Context = createContext<PreviewSession | null>(null)
let active: PreviewSession | null = null
const clear = (session: PreviewSession) => {
  session.inputCache.clear()
  session.pressure.reset()
}
export const useWebpPreviewSession = () => useContext(Context)

/** One open preview, one account generation. Never persisted with the manifest store. */
export function WebpPreviewSession({
  open,
  scopeKey,
  children
}: {
  open: boolean
  scopeKey: string
  children: ReactNode
}) {
  const owner = useWebpPlayerStore((state) => state.ownerId)
  const session = useMemo(
    () => ({ inputCache: new CompressedInputCache(), pressure: new PlaybackPressure() }),
    [owner, scopeKey]
  )
  useEffect(() => {
    if (!open || !owner) {
      clear(session)
      return
    }
    if (active && active !== session) clear(active)
    active = session
    // Revoke synchronously on auth changes, before a React render can reuse old bytes.
    const unsubscribe = useWebpPlayerStore.subscribe((state, previous) => {
      if (state.ownerId !== previous.ownerId) clear(session)
    })
    const hidden = () => {
      if (document.hidden) session.inputCache.trim()
    }
    const pagehide = () => clear(session)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', pagehide)
      clear(session)
      if (active === session) active = null
    }
  }, [open, owner, session])
  return <Context.Provider value={open && owner ? session : null}>{children}</Context.Provider>
}
