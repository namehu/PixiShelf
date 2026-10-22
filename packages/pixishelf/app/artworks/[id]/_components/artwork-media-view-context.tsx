'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

export type ReadingMenuAction = 'filter' | 'refresh' | 'mark-all'
export interface ReadingMenuState {
  unreadOnly: boolean
  remaining: number
  disabled: boolean
}

interface ArtworkMediaViewContextValue {
  readingMenu: ReadingMenuState | null
  setReadingMenu: (value: ReadingMenuState | null) => void
  readingRequest: { action: ReadingMenuAction; nonce: number } | null
  requestReadingAction: (action: ReadingMenuAction) => void
  readerBlocked: boolean
  setReaderBlocked: (blocked: boolean, source?: string) => void
}

const ArtworkMediaViewContext = createContext<ArtworkMediaViewContextValue | null>(null)

export function ArtworkMediaViewProvider({ children }: { children: ReactNode }) {
  const [readingMenu, setReadingMenu] = useState<ReadingMenuState | null>(null)
  const [readingRequest, setReadingRequest] = useState<{ action: ReadingMenuAction; nonce: number } | null>(null)
  const requestReadingAction = useCallback(
    (action: ReadingMenuAction) => setReadingRequest((prior) => ({ action, nonce: (prior?.nonce ?? 0) + 1 })),
    []
  )
  const [blockers, setBlockers] = useState<ReadonlySet<string>>(() => new Set())
  const setReaderBlocked = useCallback((blocked: boolean, source = 'toolbar') => {
    setBlockers((previous) => {
      if (previous.has(source) === blocked) return previous
      const next = new Set(previous)
      if (blocked) next.add(source)
      else next.delete(source)
      return next
    })
  }, [])
  const readerBlocked = blockers.size > 0
  const value = useMemo(
    () => ({ readerBlocked, setReaderBlocked, readingMenu, setReadingMenu, readingRequest, requestReadingAction }),
    [readerBlocked, readingMenu, readingRequest, requestReadingAction]
  )
  return <ArtworkMediaViewContext.Provider value={value}>{children}</ArtworkMediaViewContext.Provider>
}

export function useArtworkMediaView() {
  return useContext(ArtworkMediaViewContext)
}
