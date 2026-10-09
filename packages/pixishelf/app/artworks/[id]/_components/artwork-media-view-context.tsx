'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

export type ArtworkMediaView = 'local' | 'source'

export type ReadingMenuAction = 'filter' | 'refresh' | 'mark-all'
export interface ReadingMenuState { unreadOnly: boolean; remaining: number; disabled: boolean }

interface ArtworkMediaViewContextValue {
  readingMenu: ReadingMenuState | null
  setReadingMenu: (value: ReadingMenuState | null) => void
  readingRequest: { action: ReadingMenuAction; nonce: number } | null
  requestReadingAction: (action: ReadingMenuAction) => void
  view: ArtworkMediaView
  setView: (view: ArtworkMediaView) => void
  readerBlocked: boolean
  setReaderBlocked: (blocked: boolean) => void
}

const ArtworkMediaViewContext = createContext<ArtworkMediaViewContextValue | null>(null)

export function ArtworkMediaViewProvider({ children }: { children: ReactNode }) {
  const [readingMenu, setReadingMenu] = useState<ReadingMenuState | null>(null)
  const [readingRequest, setReadingRequest] = useState<{ action: ReadingMenuAction; nonce: number } | null>(null)
  const requestReadingAction = useCallback((action: ReadingMenuAction) => setReadingRequest((prior) => ({ action, nonce: (prior?.nonce ?? 0) + 1 })), [])
  const [view, setView] = useState<ArtworkMediaView>('local')
  const [readerBlocked, setReaderBlocked] = useState(false)
  const value = useMemo(() => ({ view, setView, readerBlocked, setReaderBlocked, readingMenu, setReadingMenu, readingRequest, requestReadingAction }), [readerBlocked, view, readingMenu, readingRequest, requestReadingAction])
  return <ArtworkMediaViewContext.Provider value={value}>{children}</ArtworkMediaViewContext.Provider>
}

export function useArtworkMediaView() {
  return useContext(ArtworkMediaViewContext)
}
