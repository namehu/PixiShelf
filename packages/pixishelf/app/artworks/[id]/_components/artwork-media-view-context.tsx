'use client'

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

export type ArtworkMediaView = 'local' | 'source'

interface ArtworkMediaViewContextValue {
  view: ArtworkMediaView
  setView: (view: ArtworkMediaView) => void
  readerBlocked: boolean
  setReaderBlocked: (blocked: boolean) => void
}

const ArtworkMediaViewContext = createContext<ArtworkMediaViewContextValue | null>(null)

export function ArtworkMediaViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ArtworkMediaView>('local')
  const [readerBlocked, setReaderBlocked] = useState(false)
  const value = useMemo(() => ({ view, setView, readerBlocked, setReaderBlocked }), [readerBlocked, view])
  return <ArtworkMediaViewContext.Provider value={value}>{children}</ArtworkMediaViewContext.Provider>
}

export function useArtworkMediaView() {
  return useContext(ArtworkMediaViewContext)
}
