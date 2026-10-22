import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { MediaIndex, ReaderInitialization } from '@/schemas/artwork-reader.dto'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider } from '../artwork-media-view-context'
import { ArtworkSummaryProvider, useArtworkSummary } from '../artwork-summary-context'

const mocks = vi.hoisted(() => ({
  reader: null as unknown,
  observedReading: null as ArtworkReadingHandle | null,
  completeNavigation: undefined as (() => void) | undefined,
  observe: vi.fn(),
  toast: vi.fn(),
  settled: vi.fn()
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/artworks/7' }))
vi.mock('sonner', () => ({ toast: { custom: mocks.toast, dismiss: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({ useArtworkReader: () => mocks.reader }))
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: vi.fn() }))
vi.mock('../use-artwork-auto-scroll', () => ({ getAutoBrowseViewport: () => ({ top: 64, bottom: 1000 }) }))
vi.mock('../artwork-summary-navigation', () => ({
  settleSummaryNavigation: ({ mediaId, isCurrent, onSettled }: { mediaId?: number; isCurrent: () => boolean; onSettled: () => void }) => {
    mocks.settled(mediaId)
    mocks.completeNavigation = () => { if (isCurrent()) onSettled() }
  }
}))
vi.mock('../artwork-images', () => ({
  default: ({ images, reading, continueRequest, onContinueHandled }: {
    images: ArtworkImageResponseDto[]; reading: ArtworkReadingHandle; continueRequest?: { index: number }; onContinueHandled?: () => void
  }) => {
    mocks.observedReading = reading
    useEffect(() => { if (continueRequest) onContinueHandled?.() }, [continueRequest])
    return <div data-testid="media" data-continue-index={continueRequest?.index}>
      {images.map((image, index) => <div key={image.id} data-summary-anchor={image.id} ref={(node) => {
        if (node) node.getBoundingClientRect = () => ({ top: 200 + index * 1000, bottom: 1200 + index * 1000, height: 1000 }) as DOMRect
      }} />)}
    </div>
  }
}))

const index: MediaIndex = {
  fingerprint: 'a'.repeat(64), mediaRevision: 1,
  items: [11, 12, 13, 14].map((mediaId, index) => ({
    mediaId, memberMediaIds: [mediaId], index, width: 720, height: 990,
    mediaType: 'image', isAnimated: false, reliableDimensions: true
  }))
}
const images = index.items.map((item) => ({ id: item.mediaId })) as ArtworkImageResponseDto[]
const initialization: ReaderInitialization = {
  title: '续读作品', index,
  reading: {
    artworkId: 7, mediaRevision: 1, seenMediaIds: [13], resume: { mediaId: 13, index: 2 },
    summary: {
      artworkId: 7, mediaRevision: 1, stateVersion: 1, viewCount: 1, seenCount: 1, totalCount: 4,
      status: 'IN_PROGRESS', lastViewedAt: '2026-10-22T00:00:00.000Z', lastActiveAt: null,
      lastMediaId: 13, lastMediaIndex: 2
    }
  }
}

function reader(loaded: boolean) {
  const context = loaded ? { ...initialization.reading, media: index.items } : undefined
  return {
    images, initialization: loaded ? initialization : undefined, isFetching: !loaded, invalidated: false,
    reading: {
      ownerUserId: 'alice', context, summary: context?.summary ?? null, resume: context?.resume ?? null,
      isLoading: !loaded, observe: mocks.observe, markRead: vi.fn(), invalidated: false
    } as unknown as ArtworkReadingHandle
  }
}

function NavigationState() {
  const summary = useArtworkSummary()
  return <output data-testid="navigation" data-anchor={summary?.anchor?.mediaId} data-mode={summary?.mode} />
}

function Content() {
  return <ArtworkMediaViewProvider><ArtworkSummaryProvider artworkId={7}>
    <NavigationState />
    <ArtworkMediaSection artworkId={7} images={images} resumeOnEntry />
  </ArtworkSummaryProvider></ArtworkMediaViewProvider>
}

beforeEach(() => {
  window.history.replaceState({}, '', '/artworks/7?resume=1')
  window.sessionStorage.clear()
  mocks.reader = reader(false)
  mocks.observedReading = null
  mocks.completeNavigation = undefined
  mocks.observe.mockReset()
  mocks.toast.mockReset()
  mocks.settled.mockReset()
})
afterEach(cleanup)

describe('explicit resume with the real summary navigation provider', () => {
  it('keeps the saved third-media intent when the first reader index initializes over the visible first media', () => {
    const view = render(<Content />)
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBeNull()

    act(() => { mocks.reader = reader(true) })
    view.rerender(<Content />)

    expect(screen.getByTestId('navigation').getAttribute('data-mode')).toBe('complete')
    expect(screen.getByTestId('navigation').getAttribute('data-anchor')).toBe('13')
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBe('2')
    expect(mocks.settled).toHaveBeenLastCalledWith(13)
    expect(mocks.toast).not.toHaveBeenCalled()
    const observation = { mediaId: 13, ready: true, visible: true, active: true, automatic: false }
    mocks.observedReading!.observe('adaptive-preview', observation)
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(false)
    act(() => mocks.completeNavigation?.())
    mocks.observedReading!.observe('adaptive-preview', observation)
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
  })
})
