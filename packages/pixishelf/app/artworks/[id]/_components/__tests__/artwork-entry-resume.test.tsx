import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { MediaIndex, ReaderInitialization } from '@/schemas/artwork-reader.dto'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider } from '../artwork-media-view-context'
import { ArtworkSummaryProvider, useArtworkSummary } from '../artwork-summary-context'
import { saveStackRecovery } from '../artwork-stack-recovery'

const mocks = vi.hoisted(() => ({
  reader: null as unknown,
  observedReading: null as ArtworkReadingHandle | null,
  completeNavigation: undefined as (() => void) | undefined,
  observe: vi.fn(),
  toast: vi.fn(),
  settled: vi.fn()
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/artworks/7' }))
vi.mock('@/hooks/use-media-mark', () => ({ useLikedMediaIds: () => ({ data: undefined }) }))
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

function Content({ mediaIdOnEntry }: { mediaIdOnEntry?: number | null }) {
  return <ArtworkMediaViewProvider><ArtworkSummaryProvider artworkId={7} suppressRecoveryNavigation={mediaIdOnEntry !== undefined}>
    <NavigationState />
    <ArtworkMediaSection artworkId={7} images={images} resumeOnEntry mediaIdOnEntry={mediaIdOnEntry} />
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

describe('explicit media links with the real summary navigation provider', () => {
  it('waits for the current index, consumes only navigation parameters once and prioritizes mediaId over resume', () => {
    window.history.replaceState({ keep: true }, '', '/artworks/7?mediaId=14&resume=1&entry=direct&other=value#media')
    const view = render(<StrictMode><Content mediaIdOnEntry={14} /></StrictMode>)
    expect(window.location.search).toBe('?entry=direct&other=value')
    expect(window.location.hash).toBe('#media')
    expect(window.history.state).toEqual({ keep: true })
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBeNull()
    const observation = { mediaId: 11, ready: true, visible: true, active: true, automatic: false }
    mocks.observedReading!.observe('adaptive-preview', observation)
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(false)

    mocks.reader = reader(true)
    view.rerender(<StrictMode><Content mediaIdOnEntry={14} /></StrictMode>)
    expect(screen.getByTestId('navigation').getAttribute('data-anchor')).toBe('14')
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBe('3')
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.settled.mock.calls.filter(([id]) => id === 14)).toHaveLength(1)
    mocks.observedReading!.observe('adaptive-preview', observation)
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(false)
    act(() => mocks.completeNavigation?.())
    mocks.observedReading!.observe('adaptive-preview', { ...observation, mediaId: 14 })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
    view.rerender(<StrictMode><Content mediaIdOnEntry={14} /></StrictMode>)
    expect(mocks.settled.mock.calls.filter(([id]) => id === 14)).toHaveLength(1)
  })

  it('reveals the exact member in a restored stack without restoring the old anchor', () => {
    window.history.replaceState({}, '', '/artworks/7?mediaId=14&resume=1')
    saveStackRecovery(window.sessionStorage, 7, 'alice', { mediaId: 11, mode: 'stack', savedAt: Date.now() })
    mocks.reader = reader(true)
    render(<Content mediaIdOnEntry={14} />)
    expect(screen.getByTestId('navigation').getAttribute('data-mode')).toBe('stack')
    expect(screen.getByTestId('navigation').getAttribute('data-anchor')).toBe('14')
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBe('0')
    expect(document.querySelector('[data-summary-anchor="14"]')).not.toBeNull()
    expect(document.querySelector('[data-summary-anchor="11"]')).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('requests a distant target page directly and waits for its details before navigating', () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...initialization.index.items[0]!, index, mediaId: index + 11, memberMediaIds: [index + 11] }))
    const store = { request: vi.fn(), release: vi.fn(), failed: vi.fn(() => false), retry: vi.fn() }
    const loaded = reader(true)
    const distant = { ...loaded, store, initialization: { ...initialization, index: { ...initialization.index, items } },
      images: items.map((item) => ({ id: item.mediaId, detailsPending: item.index >= 24 })) }
    mocks.reader = distant
    window.history.replaceState({}, '', '/artworks/7?mediaId=94')
    const view = render(<Content mediaIdOnEntry={94} />)
    expect(store.request).toHaveBeenCalledWith('entry-media-7', [83])
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBeNull()
    expect(screen.getByText('正在定位图片…')).toBeTruthy()
    mocks.reader = { ...distant, images: distant.images.map((image) => image.id === 94 ? { ...image, detailsPending: false } : image) }
    view.rerender(<Content mediaIdOnEntry={94} />)
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBe('83')
    expect(store.release).toHaveBeenCalledWith('entry-media-7')
  })

  it.each([['missing', 99, '这张图片已失效，无法定位。'], ['invalid', null, '图片链接无效。']] as const)('keeps %s media explicit until the user chooses normal browsing', (_kind, mediaIdOnEntry, message) => {
    window.history.replaceState({}, '', `/artworks/7?mediaId=${mediaIdOnEntry ?? 'bad'}&resume=1`)
    mocks.reader = reader(true)
    render(<Content mediaIdOnEntry={mediaIdOnEntry} />)
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByTestId('media')).toBeNull()
    expect(mocks.settled).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '查看全部图片' }))
    expect(screen.getByTestId('media')).toBeTruthy()
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBeNull()
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 11, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
  })

  it('retries a failed target page without falling back to the reading resume', () => {
    window.history.replaceState({}, '', '/artworks/7?mediaId=14&resume=1')
    const store = { request: vi.fn(), release: vi.fn(), failed: vi.fn(() => true), retry: vi.fn() }
    const pending = { ...reader(true), store, images: images.map((image) => ({ ...image, detailsPending: image.id === 14 })) }
    mocks.reader = pending
    const view = render(<Content mediaIdOnEntry={14} />)
    expect(screen.getByText('图片定位加载失败。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试定位' }))
    expect(store.retry).toHaveBeenCalledOnce()
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBeNull()
    store.failed.mockReturnValue(false)
    mocks.reader = { ...pending, images }
    view.rerender(<Content mediaIdOnEntry={14} />)
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).toBe('3')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('retries reader initialization and cancels a pending target when the account changes', () => {
    window.history.replaceState({}, '', '/artworks/7?mediaId=14')
    const retry = vi.fn()
    const failed = { ...reader(false), isFetching: false, error: new Error('offline') }
    failed.reading.retry = retry
    mocks.reader = failed
    const view = render(<Content mediaIdOnEntry={14} />)
    fireEvent.click(screen.getByRole('button', { name: '重试定位' }))
    expect(retry).toHaveBeenCalledOnce()
    const changed = reader(true)
    changed.reading.ownerUserId = 'bob'
    mocks.reader = changed
    view.rerender(<Content mediaIdOnEntry={14} />)
    expect(screen.getByTestId('navigation').getAttribute('data-anchor')).not.toBe('14')
    expect(screen.getByTestId('media').getAttribute('data-continue-index')).not.toBe('3')
    expect(screen.queryByText('图片定位加载失败。')).toBeNull()
    act(() => mocks.completeNavigation?.())
    mocks.observedReading!.observe('adaptive-preview', { mediaId: 11, ready: true, visible: true, active: true, automatic: false })
    expect(mocks.observe.mock.lastCall?.[1].active).toBe(true)
  })
})
