'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useArtworkRating } from '@/hooks/use-artwork-rating'
import type { ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkRatingPanel } from './artwork-rating-panel'
import { MediaAnchorNavigation } from './media-anchor-navigation'
import { useArtworkMediaView } from './artwork-media-view-context'

interface DetailControls {
  container: HTMLDivElement | null
  register: (owner: symbol) => () => void
  openRating: () => void
  ratingOpen: boolean
  ratingLevel: ArtworkRatingLevel
}
const DetailControlsContext = createContext<DetailControls | null>(null)
export const useArtworkDetailControls = () => useContext(DetailControlsContext)

export function ArtworkDetailControlsProvider({ artworkId, children }: { artworkId: number; children: ReactNode }) {
  const rating = useArtworkRating(artworkId)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [owners, setOwners] = useState<Set<symbol>>(() => new Set())
  const previewOpen = useArtworkAutoBrowseStore((state) => state.previewOpen)
  const setReaderBlocked = useArtworkMediaView()?.setReaderBlocked
  const register = useCallback((owner: symbol) => {
    setOwners((previous) => new Set(previous).add(owner))
    return () =>
      setOwners((previous) => {
        const next = new Set(previous)
        next.delete(owner)
        return next
      })
  }, [])
  const openRating = useCallback(() => {
    useArtworkAutoBrowseStore.getState().pause('overlay')
    setFallbackOpen(false)
    setRatingOpen(true)
  }, [])
  useEffect(() => {
    setReaderBlocked?.(ratingOpen, 'rating')
    return () => setReaderBlocked?.(false, 'rating')
  }, [ratingOpen, setReaderBlocked])
  useEffect(() => {
    if (previewOpen) {
      setRatingOpen(false)
      setFallbackOpen(false)
    }
  }, [previewOpen])
  const value = useMemo(
    () => ({ container, register, openRating, ratingOpen, ratingLevel: rating.level }),
    [container, register, openRating, ratingOpen, rating.level]
  )

  return (
    <DetailControlsContext.Provider value={value}>
      {children}
      <div
        ref={setContainer}
        className="artwork-floating-controls"
        hidden={previewOpen}
        data-testid="artwork-floating-controls"
      >
        {owners.size === 0 && (
          <MediaAnchorNavigation
            portaled
            indexes={[]}
            activeIndex={-1}
            currentIndex={0}
            total={0}
            open={fallbackOpen}
            onOpenChange={(open) => {
              if (open) useArtworkAutoBrowseStore.getState().pause('overlay')
              setFallbackOpen(open)
            }}
            onSelect={() => {}}
            collapsible={false}
            expanded={false}
            onToggleExpanded={() => {}}
            onBackToTop={() => window.scrollTo({ top: 0, behavior: 'instant' })}
            onRate={openRating}
            ratingLevel={rating.level}
          />
        )}
      </div>
      <ArtworkRatingPanel
        open={ratingOpen}
        onOpenChange={setRatingOpen}
        rating={rating}
        onReturnFocus={() =>
          container?.querySelector<HTMLButtonElement>('[data-artwork-controls-trigger]')?.focus({ preventScroll: true })
        }
      />
    </DetailControlsContext.Provider>
  )
}

/** Media controls keep their local navigation callbacks; their shared dock stays mounted outside filtered lists. */
export function ArtworkFloatingPortal({ children, active }: { children: ReactNode; active: boolean }) {
  const controls = useArtworkDetailControls()
  const register = controls?.register
  const owner = useRef(Symbol('artwork-media-controls'))
  useLayoutEffect(() => (active ? register?.(owner.current) : undefined), [active, register])
  if (!active) return null
  if (!controls) return children
  return controls.container ? createPortal(children, controls.container) : null
}
