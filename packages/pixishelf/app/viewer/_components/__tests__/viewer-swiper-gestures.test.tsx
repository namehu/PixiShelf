import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImmersiveImageViewer from '../immersive-image-viewer'

// Keep both real Swipers, the media surface and the feed gesture engine.
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => ({ invalidated: false }) }))
vi.mock('@/components/user-setting', () => ({
  useVideoLongPressPlaybackRate: () => 3,
  useVideoSeekStepSeconds: () => 10
}))
vi.mock('../image-overlay', () => ({ default: () => null }))
vi.mock('../viewer-video-controls', () => ({ default: () => null }))

function artwork(id: number, multiple: boolean): RandomImageItem {
  return {
    id,
    key: `artwork-${id}`,
    title: 'Artwork',
    imageUrl: '/video.mp4',
    mediaType: MediaType.VIDEO,
    author: null,
    createdAt: '2026-10-17',
    tags: [],
    isLike: false,
    images: (multiple ? [1, 2] : [1]).map((index) => ({
      id: id * 10 + index,
      key: `video-${id}-${index}`,
      url: `/video-${id}-${index}.mp4`,
      mediaType: MediaType.VIDEO,
      updatedAt: '2026-10-17',
      animationMetadata: null
    }))
  }
}

function pointer(target: Element, type: string, pointerType: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    isPrimary: { value: true }
  })
  fireEvent(target, event)
}

function tap(video: HTMLVideoElement, pointerType: string) {
  pointer(video, 'pointerdown', pointerType, 200, 400)
  // jsdom has no default pointer focus action; reproduce the browser's focused media state.
  act(() => video.focus())
  pointer(video, 'pointerup', pointerType, 200, 400)
  act(() => vi.advanceTimersByTime(301))
}

function swipe(video: HTMLVideoElement, pointerType: string, horizontal: boolean) {
  pointer(video, 'pointerdown', pointerType, 300, 600)
  pointer(video, 'pointermove', pointerType, horizontal ? 280 : 300, horizontal ? 600 : 580)
  pointer(video, 'pointermove', pointerType, horizontal ? 50 : 300, horizontal ? 600 : 150)
  pointer(video, 'pointerup', pointerType, horizontal ? 50 : 300, horizontal ? 600 : 150)
}

describe('viewer gestures with real Swiper and focused video', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    useViewerStore.setState({ verticalIndex: 0, horizontalIndexes: {}, isChromeHidden: false })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    ['mouse', false, false, false],
    ['mouse', false, true, false],
    ['touch', false, false, false],
    ['touch', false, true, false],
    ['mouse', true, false, true],
    ['mouse', true, true, true],
    ['touch', true, false, true],
    ['touch', true, true, true],
    ['mouse', false, false, true],
    ['mouse', false, true, true],
    ['touch', false, false, true],
    ['touch', false, true, true]
  ] as const)(
    'allows %s swipes (horizontal=%s, restored=%s, nested=%s) after chrome toggles',
    (pointerType, horizontal, restored, multiple) => {
      const images = [artwork(1, multiple), artwork(2, multiple)]
      useViewerStore.setState({ images })
      const view = render(
        <ImmersiveImageViewer initialImages={images} hasMore={false} isLoading={false} onLoadMore={vi.fn()} />
      )
      const video = view.container.querySelector('video')!
      tap(video, pointerType)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      if (restored) tap(video, pointerType)
      expect(useViewerStore.getState().isChromeHidden).toBe(!restored)
      expect(document.activeElement).toBe(video)
      swipe(video, pointerType, horizontal)
      act(() => vi.advanceTimersByTime(301))
      expect(
        horizontal ? useViewerStore.getState().horizontalIndexes['artwork-1'] : useViewerStore.getState().verticalIndex
      ).toBe(1)
      expect(useViewerStore.getState().isChromeHidden).toBe(!restored)
    }
  )

  it.each([false, true])(
    'blocks swipes while a panel is open and restores them after closing (horizontal=%s)',
    (horizontal) => {
      const images = [artwork(1, horizontal), artwork(2, horizontal)]
      useViewerStore.setState({ images })
      const props = { initialImages: images, hasMore: false, isLoading: false, onLoadMore: vi.fn() }
      const view = render(<ImmersiveImageViewer {...props} />)
      const video = view.container.querySelector('video')!
      tap(video, 'touch')
      view.rerender(<ImmersiveImageViewer {...props} interactionLocked />)
      swipe(video, 'touch', horizontal)
      act(() => vi.advanceTimersByTime(301))
      expect(useViewerStore.getState().verticalIndex).toBe(0)
      expect(useViewerStore.getState().horizontalIndexes['artwork-1'] ?? 0).toBe(0)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      view.rerender(<ImmersiveImageViewer {...props} />)
      swipe(video, 'touch', horizontal)
      act(() => vi.advanceTimersByTime(301))
      expect(
        horizontal ? useViewerStore.getState().horizontalIndexes['artwork-1'] : useViewerStore.getState().verticalIndex
      ).toBe(1)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
    }
  )
})
