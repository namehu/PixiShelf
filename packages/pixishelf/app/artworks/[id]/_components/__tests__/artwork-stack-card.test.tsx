vi.mock('@/components/media-mark/media-mark-actions', () => ({ MediaMarkActions: ({ mediaId }: { mediaId: number }) => <div data-testid="mark-control" data-media-id={mediaId} /> }))
vi.mock('@/hooks/use-media-mark', () => ({ useMediaMark: (_artworkId: number, mediaId: number) => ({ available: true, isLoading: false, likedAt: null, set: (kind: string, value: boolean) => mocks.like(mediaId, kind, value) }) }))
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { buildArtworkStacks } from '@/lib/reading/artwork-stacks'
import { ArtworkStackCard } from '../artwork-stack-card'

const mocks = vi.hoisted(() => ({ selectMedia: vi.fn(), like: vi.fn(), onMenu: vi.fn() }))
vi.mock('../artwork-summary-context', () => ({
  useArtworkSummary: () => ({ selectMedia: mocks.selectMedia, navigating: false })
}))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({ MediaDetailsPlaceholder: () => null }))
vi.mock('../lazy-media', () => ({
  default: ({ trackingActive }: { trackingActive: boolean }) => (
    <div data-testid="media" data-tracking={trackingActive} />
  )
}))

const mediaIds = [1, 2, 3, 4]
const group = buildArtworkStacks(
  mediaIds.map((mediaId, index) => ({
    mediaId,
    memberMediaIds: [mediaId],
    index,
    mediaType: 'image' as const,
    isAnimated: false
  }))
)[0]!

function setup(activeIndex = 0) {
  const media = { id: mediaIds[activeIndex], path: 'image.jpg', sortOrder: activeIndex } as ArtworkImageResponseDto
  render(
    <ArtworkStackCard
      media={media}
      index={0}
      height={400}
      decoration={{ group, mediaIds, activeIndex, cover: media }}
      trackingActive
      onMenu={mocks.onMenu}
    />
  )
  act(() => vi.advanceTimersByTime(180))
  const surface = screen.getByRole('group', { name: /双击喜欢/ })
  const capture = vi.fn()
  Object.defineProperty(surface, 'setPointerCapture', { value: capture })
  return { surface, child: screen.getByTestId('media'), capture }
}

function pointer(target: HTMLElement, type: string, x: number, y = 100, extra = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...extra
  })
  fireEvent(target, event)
  return event
}
function start(target: HTMLElement) {
  pointer(target, 'pointerdown', 200)
  fireEvent.touchStart(target, { touches: [{ identifier: 1, clientX: 200, clientY: 100 }] })
}
function move(target: HTMLElement, x: number, y = 100) {
  const event = pointer(target, 'pointermove', x, y)
  fireEvent.touchMove(target, { touches: [{ identifier: 1, clientX: x, clientY: y }] })
  return event
}
function end(target: HTMLElement, x: number, y = 100) {
  pointer(target, 'pointerup', x, y)
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ identifier: 1, clientX: x, clientY: y }] })
  fireEvent.mouseDown(target)
  fireEvent.mouseUp(target)
  fireEvent.click(target)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('stack touch arbitration', () => {
  it('captures the touch on the surface before moving, and ignores descendant capture loss', () => {
    const { surface, child, capture } = setup()
    start(child)
    expect(capture).toHaveBeenCalledWith(1)
    move(child, 100)
    pointer(child, 'lostpointercapture', 100)
    end(surface, 80)
    expect(mocks.selectMedia).toHaveBeenCalledExactlyOnceWith(2)
    expect(mocks.like).not.toHaveBeenCalled()
    expect(mocks.onMenu).not.toHaveBeenCalled()
  })

  it('survives the implicit-capture transfer event bubbling from an inner media element', () => {
    const { surface, child } = setup()
    start(child)
    move(child, 100)
    pointer(child, 'lostpointercapture', 100)
    end(surface, 80)
    expect(mocks.selectMedia).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('handles a quick flick even when the browser coalesces the move events', () => {
    const { child } = setup()
    start(child)
    end(child, 80)
    expect(mocks.selectMedia).toHaveBeenCalledExactlyOnceWith(2)
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('flips right within the same group', () => {
    const { child } = setup(1)
    start(child)
    move(child, 290)
    end(child, 310)
    expect(mocks.selectMedia).toHaveBeenCalledExactlyOnceWith(1)
  })

  it.each(['mouse', 'pen'])('preserves %s dragging without opening the preview', (pointerType) => {
    const { surface, child } = setup()
    pointer(child, 'pointerdown', 200, 100, { pointerType })
    fireEvent.mouseDown(child, { clientX: 200, clientY: 100 })
    pointer(surface, 'pointermove', 100, 100, { pointerType })
    fireEvent.mouseMove(surface, { clientX: 100, clientY: 100 })
    pointer(surface, 'pointerup', 80, 100, { pointerType })
    fireEvent.mouseUp(surface, { clientX: 80, clientY: 100 })
    fireEvent.click(surface)
    expect(mocks.selectMedia).toHaveBeenCalledExactlyOnceWith(2)
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it.each([
    [0, 300],
    [3, 100]
  ])('stops at the group boundary %s', (activeIndex, x) => {
    const { child } = setup(activeIndex)
    start(child)
    move(child, x)
    end(child, x)
    expect(mocks.selectMedia).not.toHaveBeenCalled()
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('leaves vertical scrolling to the browser and does not turn it into a later horizontal swipe', () => {
    const { child } = setup()
    start(child)
    expect(move(child, 195, 170).defaultPrevented).toBe(false)
    move(child, 90, 190)
    end(child, 90, 190)
    expect(mocks.selectMedia).not.toHaveBeenCalled()
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('cancels a swipe when a second finger starts a pinch', () => {
    const { child } = setup()
    start(child)
    pointer(child, 'pointerdown', 260, 100, { pointerId: 2, isPrimary: false })
    fireEvent.touchStart(child, {
      touches: [
        { clientX: 200, clientY: 100 },
        { clientX: 260, clientY: 100 }
      ]
    })
    move(child, 100)
    end(child, 80)
    expect(mocks.selectMedia).not.toHaveBeenCalled()
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('keeps a long press from turning into a swipe after the menu opens', () => {
    const { child } = setup()
    start(child)
    act(() => vi.advanceTimersByTime(550))
    expect(mocks.onMenu).toHaveBeenCalledTimes(1)
    move(child, 100)
    end(child, 80)
    expect(mocks.selectMedia).not.toHaveBeenCalled()
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it.each(['pointercancel', 'lostpointercapture'])(
    'cancels on surface %s without flipping or opening a preview',
    (type) => {
      const { surface, child } = setup()
      start(child)
      move(child, 100)
      pointer(surface, type, 100)
      end(child, 80)
      expect(mocks.selectMedia).not.toHaveBeenCalled()
      expect(mocks.like).not.toHaveBeenCalled()
    }
  )

  it('leaves a stationary tap inactive despite compatibility mouse events', () => {
    const { child } = setup()
    start(child)
    end(child, 200)
    expect(mocks.like).not.toHaveBeenCalled()
    expect(mocks.selectMedia).not.toHaveBeenCalled()
  })

  it('likes only the current real media once after two touch taps and compatibility mouse events', () => {
    const { child } = setup(1)
    start(child); end(child, 200)
    start(child); end(child, 200)
    expect(mocks.like).toHaveBeenCalledExactlyOnceWith(2, 'like', true)
    // This gesture-only mock does not publish optimistic mark state; the session integration covers its reveal.
    expect(screen.queryByTestId('mark-control')).toBeNull()
    expect(mocks.onMenu).not.toHaveBeenCalled()
    expect(mocks.selectMedia).not.toHaveBeenCalled()
  })

  it.each(['swipe', 'multitouch'])('clears a pending first tap after %s', (kind) => {
    const { child } = setup()
    start(child); end(child, 200)
    start(child)
    if (kind === 'swipe') { move(child, 100); end(child, 80) }
    else {
      pointer(child, 'pointerdown', 260, 100, { pointerId: 2, isPrimary: false })
      fireEvent.touchStart(child, { touches: [{ clientX: 200, clientY: 100 }, { clientX: 260, clientY: 100 }] })
      end(child, 200)
    }
    start(child); end(child, 200)
    expect(mocks.like).not.toHaveBeenCalled()
    expect(mocks.onMenu).not.toHaveBeenCalled()
  })

  it('opens the same menu with keyboard and right click and keeps arrow navigation', () => {
    const { surface } = setup()
    fireEvent.keyDown(surface, { key: 'Enter' })
    fireEvent.keyDown(surface, { key: ' ' })
    fireEvent.contextMenu(surface)
    expect(mocks.onMenu).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(mocks.selectMedia).toHaveBeenCalledWith(2)
    expect(mocks.like).not.toHaveBeenCalled()
  })

  it('does not record a view while the card is being dragged', () => {
    const { child } = setup()
    expect(child.dataset.tracking).toBe('true')
    start(child)
    move(child, 130)
    expect(child.dataset.tracking).toBe('false')
  })
})
