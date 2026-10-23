import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaIndex } from '@/schemas/artwork-reader.dto'
import { ArtworkSummaryProvider, useArtworkSummary } from '../artwork-summary-context'
import { saveStackRecovery } from '../artwork-stack-recovery'

const mocks = vi.hoisted(() => ({
  index: undefined as MediaIndex | undefined,
  summary: null as ReturnType<typeof useArtworkSummary>,
  pause: vi.fn(),
  stop: vi.fn()
}))

vi.mock('@/lib/reading/artwork-reader-provider', () => ({
  useArtworkReader: () => ({
    initialization: mocks.index ? { index: mocks.index } : undefined,
    reading: { ownerUserId: 'alice' },
    invalidated: false
  })
}))
vi.mock('@/store/use-artwork-auto-browse-store', () => ({
  useArtworkAutoBrowseStore: { getState: () => ({ pause: mocks.pause, stop: mocks.stop, previewOpen: false }) }
}))
vi.mock('../use-artwork-auto-scroll', () => ({ getAutoBrowseViewport: () => ({ top: 64, bottom: 800 }) }))

function createIndex(fingerprint = 'first'): MediaIndex {
  return {
    fingerprint,
    mediaRevision: 1,
    items: [11, 12].map((mediaId, index) => ({
      mediaId, memberMediaIds: [mediaId], index, width: 600, height: 800,
      mediaType: 'image', isAnimated: false, reliableDimensions: true
    }))
  }
}

function MediaHarness() {
  mocks.summary = useArtworkSummary()
  return <div data-testid="media" data-summary-anchor="11" />
}

function content() {
  return <ArtworkSummaryProvider artworkId={7}><MediaHarness /></ArtworkSummaryProvider>
}

describe('artwork summary entry navigation', () => {
  beforeEach(() => {
    mocks.index = undefined
    mocks.summary = null
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it.each([100, 1200])('does not navigate to the first media when the initial index loads (media top: %s)', (top) => {
    const view = render(content())
    vi.spyOn(screen.getByTestId('media'), 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 800 } as DOMRect)

    mocks.index = createIndex()
    view.rerender(content())

    expect(mocks.summary?.ready).toBe(true)
    expect(mocks.summary?.anchor).toBeNull()
    expect(mocks.summary?.navigating).toBe(false)
  })

  it('keeps the visible media anchored when an existing index changes', () => {
    mocks.index = createIndex()
    const view = render(content())
    vi.spyOn(screen.getByTestId('media'), 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 900 } as DOMRect)

    mocks.index = createIndex('updated')
    view.rerender(content())

    expect(mocks.summary?.anchor?.mediaId).toBe(11)
    expect(mocks.summary?.navigating).toBe(true)
  })

  it('still accepts an explicit media target after the initial index loads', () => {
    const view = render(content())
    mocks.index = createIndex()
    view.rerender(content())

    act(() => mocks.summary?.reveal(12))

    expect(mocks.summary?.anchor?.mediaId).toBe(12)
    expect(mocks.summary?.navigating).toBe(true)
  })

  it('restores an explicit source-conflict recovery after the initial index loads', () => {
    saveStackRecovery(window.sessionStorage, 7, 'alice', { mediaId: 12, mode: 'stack', savedAt: Date.now() })
    const view = render(content())
    mocks.index = createIndex()
    view.rerender(content())

    expect(mocks.summary?.mode).toBe('stack')
    expect(mocks.summary?.anchor?.mediaId).toBe(12)
  })
})
