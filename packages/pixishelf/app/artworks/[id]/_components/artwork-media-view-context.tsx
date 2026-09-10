'use client'

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

export type ArtworkMediaView = 'local' | 'source'

interface ArtworkMediaViewContextValue {
  view: ArtworkMediaView
  setView: (view: ArtworkMediaView) => void
}

const ArtworkMediaViewContext = createContext<ArtworkMediaViewContextValue | null>(null)

export function ArtworkMediaViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ArtworkMediaView>('local')
  const value = useMemo(() => ({ view, setView }), [view])
  return <ArtworkMediaViewContext.Provider value={value}>{children}</ArtworkMediaViewContext.Provider>
}

export function useArtworkMediaView() {
  return useContext(ArtworkMediaViewContext)
}
