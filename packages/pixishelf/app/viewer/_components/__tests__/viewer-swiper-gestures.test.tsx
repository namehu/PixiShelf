import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
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
vi.mock('../image-overlay', () => ({
  default: ({ mediaControls }: { mediaControls: React.ReactNode }) => mediaControls
}))
vi.mock('../viewer-video-controls', () => ({
  default: ({
    rateMenuOpen,
    onRateMenuOpenChange
  }: {
    rateMenuOpen: boolean
    onRateMenuOpenChange: (open: boolean) => void
  }) => (
    <button data-viewer-control onClick={() => onRateMenuOpenChange(!rateMenuOpen)}>
      倍速菜单
    </button>
  )
}))

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
    ratingLevel: null,
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

function doubleTap(target: Element, pointerType = 'touch') {
  for (let i = 0; i < 2; i++) {
    pointer(target, 'pointerdown', pointerType, 200, 400)
    pointer(target, 'pointerup', pointerType, 200, 400)
  }
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
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
    })
    useViewerStore.getState().resetViewerState()
    useViewerStore.setState({ verticalIndex: 0, horizontalIndexes: {}, isChromeHidden: false })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([false, true])('blocks media gestures while speed menu is open (horizontal=%s)', (horizontal) => {
    const images = [artwork(1, true), artwork(2, true)]
    useViewerStore.setState({ images })
    const view = render(
      <ImmersiveImageViewer
        playbackRate={1.5}
        onPlaybackRateChange={vi.fn()}
        initialImages={images}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    const video = view.container.querySelector('video')!
    pointer(video, 'pointerdown', 'touch', 200, 400)
    act(() => vi.advanceTimersByTime(1000))
    expect(video.playbackRate).toBe(3)
    fireEvent(window, new Event('blur'))
    expect(video.playbackRate).toBe(1.5)
    pointer(video, 'pointerdown', 'touch', 200, 400)
    pointer(video, 'pointerup', 'touch', 200, 400)
    fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
    const play = vi.mocked(HTMLMediaElement.prototype.play).mockClear()
    const pause = vi.mocked(HTMLMediaElement.prototype.pause).mockClear()
    doubleTap(video)
    swipe(video, 'touch', horizontal)
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { key: 'c' })
    pointer(video, 'pointerdown', 'touch', 200, 400)
    act(() => vi.advanceTimersByTime(1000))
    pointer(video, 'pointerup', 'touch', 200, 400)
    expect(video.playbackRate).toBe(1.5)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(useViewerStore.getState().horizontalIndexes['artwork-1'] ?? 0).toBe(0)
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
    swipe(video, 'touch', horizontal)
    act(() => vi.advanceTimersByTime(301))
    expect(
      horizontal ? useViewerStore.getState().horizontalIndexes['artwork-1'] : useViewerStore.getState().verticalIndex
    ).toBe(1)
    expect((view.container.querySelector('.swiper-slide-active video') as HTMLVideoElement)?.playbackRate).toBe(1.5)
  })

  it.each(['mouse', 'touch'])(
    'toggles playback with %s double taps while keeping chrome hidden and automatic browsing paused',
    async (pointerType) => {
      const images = [artwork(1, false), artwork(2, false)]
      useViewerStore.setState({ images })
      const view = render(
        <ImmersiveImageViewer
          playbackRate={1}
          onPlaybackRateChange={vi.fn()}
          initialImages={images}
          hasMore={false}
          isLoading={false}
          onLoadMore={vi.fn()}
        />
      )
      const video = view.container.querySelector('video')!
      act(() => useViewerStore.getState().requestAutoBrowse())
      act(() => useViewerStore.getState().setChromeHidden(true))
      expect(video.paused).toBe(false)
      doubleTap(video, pointerType)
      expect(video.paused).toBe(true)
      expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      await act(async () => doubleTap(video, pointerType))
      expect(video.paused).toBe(false)
      expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      expect(useViewerStore.getState().verticalIndex).toBe(0)
    }
  )

  it('uses the existing muted retry and reports playback failures after a double tap', async () => {
    const images = [artwork(1, false)]
    useViewerStore.setState({ images })
    const view = render(
      <ImmersiveImageViewer
        playbackRate={1}
        onPlaybackRateChange={vi.fn()}
        initialImages={images}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    const video = view.container.querySelector('video')!
    doubleTap(video)
    video.muted = false
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    play.mockClear()
    play.mockRejectedValueOnce(new Error('autoplay denied'))
    await act(async () => doubleTap(video))
    expect(play).toHaveBeenCalledTimes(2)
    expect(video.muted).toBe(true)
    expect(video.paused).toBe(false)
    doubleTap(video)
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'test-error')
    play.mockRejectedValueOnce(new Error('unsupported video'))
    await act(async () => doubleTap(video))
    expect(error).toHaveBeenCalledWith('视频暂时无法播放')
    expect(video.paused).toBe(true)
  })

  it('blocks double taps behind a panel and cancels a pending tap on blur', () => {
    const images = [artwork(1, false)]
    useViewerStore.setState({ images })
    const props = { initialImages: images, hasMore: false, isLoading: false, onLoadMore: vi.fn() }
    const view = render(<ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} />)
    const video = view.container.querySelector('video')!
    pointer(video, 'pointerdown', 'touch', 200, 400)
    pointer(video, 'pointerup', 'touch', 200, 400)
    view.rerender(<ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} interactionLocked />)
    const play = vi.mocked(HTMLMediaElement.prototype.play).mockClear()
    const pause = vi.mocked(HTMLMediaElement.prototype.pause).mockClear()
    doubleTap(video)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(useViewerStore.getState().isChromeHidden).toBe(false)
    view.rerender(<ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} />)
    play.mockClear()
    pause.mockClear()
    pointer(video, 'pointerdown', 'touch', 200, 400)
    pointer(video, 'pointerup', 'touch', 200, 400)
    fireEvent(window, new Event('blur'))
    tap(video, 'touch')
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(useViewerStore.getState().isChromeHidden).toBe(true)
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
        <ImmersiveImageViewer
          playbackRate={1}
          onPlaybackRateChange={vi.fn()}
          initialImages={images}
          hasMore={false}
          isLoading={false}
          onLoadMore={vi.fn()}
        />
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
      const view = render(<ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} />)
      const video = view.container.querySelector('video')!
      tap(video, 'touch')
      view.rerender(
        <ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} interactionLocked />
      )
      swipe(video, 'touch', horizontal)
      act(() => vi.advanceTimersByTime(301))
      expect(useViewerStore.getState().verticalIndex).toBe(0)
      expect(useViewerStore.getState().horizontalIndexes['artwork-1'] ?? 0).toBe(0)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      view.rerender(<ImmersiveImageViewer playbackRate={1} onPlaybackRateChange={vi.fn()} {...props} />)
      swipe(video, 'touch', horizontal)
      act(() => vi.advanceTimersByTime(301))
      expect(
        horizontal ? useViewerStore.getState().horizontalIndexes['artwork-1'] : useViewerStore.getState().verticalIndex
      ).toBe(1)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
    }
  )
})
