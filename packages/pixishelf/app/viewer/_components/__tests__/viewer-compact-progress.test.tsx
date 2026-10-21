import type { ImgHTMLAttributes } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImmersiveImageViewer from '../immersive-image-viewer'

const reading = vi.hoisted(() => ({ observe: vi.fn(), clearSurface: vi.fn(), invalidated: false, ownerUserId: 'test' }))
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => reading }))
vi.mock('@/components/user-setting', () => ({
  useVideoLongPressPlaybackRate: () => 3,
  useVideoSeekStepSeconds: () => 10
}))
vi.mock('next/image', () => ({
  default: ({ src, alt, onLoad }: ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={String(src)} alt={alt} onLoad={onLoad} />
  )
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-safe-action/hooks', () => ({
  useOptimisticAction: () => ({ execute: vi.fn(), result: {}, optimisticState: { isLiked: false } })
}))
vi.mock('../action-drawer', () => ({ ActionDrawer: () => null }))
vi.mock('../tags-panel', () => ({ default: () => null }))

function artwork(id: number, count = 1, kind: 'image' | 'video' | 'gif' = 'image'): RandomImageItem {
  return {
    id,
    key: `art-${id}`,
    title: 'Artwork',
    imageUrl: '/image.jpg',
    mediaType: MediaType.IMAGE,
    author: null,
    tags: [],
    createdAt: '2026-10-21',
    isLike: false,
    images: Array.from({ length: count }, (_, index) => ({
      id: id * 10 + index,
      key: `media-${id}-${index}`,
      url: `/media-${id}-${index}.${kind === 'video' ? 'mp4' : kind === 'gif' ? 'gif' : 'jpg'}`,
      mediaType: kind === 'video' ? MediaType.VIDEO : MediaType.IMAGE,
      isAnimated: kind === 'gif',
      updatedAt: '2026-10-21',
      animationMetadata: null
    }))
  }
}
function mount(images: RandomImageItem[]) {
  useViewerStore.setState({ images, isChromeHidden: true })
  return render(
    <ImmersiveImageViewer
      playbackRate={1.5}
      onPlaybackRateChange={vi.fn()}
      initialImages={images}
      hasMore={false}
      isLoading={false}
      onLoadMore={vi.fn()}
    />
  )
}
function pointer(target: Element, type: string, x: number, pointerType = 'touch') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 750, button: 0 })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    isPrimary: { value: true }
  })
  fireEvent(target, event)
}
function track(name = '图片位置') {
  return screen.getByRole('slider', { name }).closest('[data-slot="slider"]')!
}
function index() {
  return useViewerStore.getState().horizontalIndexes['art-1'] ?? 0
}

describe('compact progress with real controls and Swipers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {}
      }))
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => true)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 44,
      right: 300,
      bottom: 44,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
    })
    useViewerStore.getState().resetViewerState()
    useViewerStore.setState({ autoBrowseInterval: 5 })
    reading.observe.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each(['mouse', 'touch'])(
    'previews image positions without reading or switching until %s release',
    (pointerType) => {
      mount([artwork(1, 5), artwork(2)])
      reading.observe.mockClear()
      const slider = track()
      pointer(slider, 'pointerdown', 75, pointerType)
      pointer(slider, 'pointermove', 225, pointerType)
      expect(screen.getByRole('slider', { name: '图片位置' }).getAttribute('aria-valuenow')).toBe('4')
      expect(index()).toBe(0)
      expect(
        reading.observe.mock.calls.every(
          ([, value]) => value.mediaId !== 11 && value.mediaId !== 12 && value.mediaId !== 13
        )
      ).toBe(true)
      pointer(slider, 'pointerup', 225, pointerType)
      expect(index()).toBe(3)
      expect(useViewerStore.getState().verticalIndex).toBe(0)
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      fireEvent.doubleClick(slider)
      act(() => vi.advanceTimersByTime(1000))
      expect(useViewerStore.getState().isChromeHidden).toBe(true)
      expect(screen.queryByRole('button', { name: '喜欢作品' })).toBeNull()
    }
  )

  it.each(['pointercancel', 'blur'])('cancels the image preview on %s', (event) => {
    mount([artwork(1, 5)])
    const slider = track()
    pointer(slider, 'pointerdown', 225)
    if (event === 'blur') fireEvent(window, new Event('blur'))
    else pointer(slider, 'pointercancel', 225)
    expect(screen.getByRole('slider', { name: '图片位置' }).getAttribute('aria-valuenow')).toBe('1')
    pointer(slider, 'pointermove', 300)
    pointer(slider, 'pointerup', 300)
    expect(index()).toBe(0)
  })

  it('supports keyboard selection and cancels previews when chrome is restored', () => {
    mount([artwork(1, 5)])
    const thumb = screen.getByRole('slider', { name: '图片位置' })
    fireEvent.keyDown(thumb, { key: 'End' })
    expect(index()).toBe(0)
    fireEvent.keyUp(thumb, { key: 'End' })
    expect(index()).toBe(4)
    expect(screen.getByRole('slider', { name: '图片位置' })).toBe(thumb)
    pointer(track(), 'pointerdown', 75)
    act(() => useViewerStore.getState().setChromeHidden(false))
    expect(screen.queryByRole('slider', { name: '图片位置' })).toBeNull()
    expect(screen.getByRole('button', { name: '喜欢作品' })).toBeDefined()
    expect(document.querySelectorAll('[data-viewer-image-segments]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-viewer-image-segments] [data-active="true"]')).toHaveLength(5)
    act(() => useViewerStore.getState().setChromeHidden(true))
    expect(screen.getByRole('slider', { name: '图片位置' }).getAttribute('aria-valuenow')).toBe('5')
    expect(document.querySelectorAll('[data-viewer-image-segments]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-viewer-image-segments] [data-active="true"]')).toHaveLength(5)
    expect(screen.queryByText('5 / 5')).toBeNull()
  })

  it.each(['image', 'gif'] as const)('keeps a single %s clean without a bottom progress area', (kind) => {
    mount([artwork(1, 1, kind)])
    expect(screen.queryByLabelText('图片位置计数')).toBeNull()
    expect(screen.queryByRole('region', { name: '浏览进度' })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('holds automatic advance during dragging without clearing a user pause', () => {
    const view = mount([artwork(1, 5)])
    act(() => useViewerStore.getState().requestAutoBrowse())
    fireEvent.load(view.container.querySelector('img')!)
    pointer(track(), 'pointerdown', 75)
    expect(screen.getByRole('slider', { name: '图片位置' }).getAttribute('aria-valuenow')).toBe('2')
    act(() => vi.advanceTimersByTime(6000))
    expect(index()).toBe(0)
    act(() => useViewerStore.getState().pauseAutoBrowse('user'))
    pointer(track(), 'pointerup', 75)
    expect(index()).toBe(1)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    act(() => vi.advanceTimersByTime(6000))
    expect(index()).toBe(1)
  })

  it('continues automatic browsing from the committed image after dragging', () => {
    const view = mount([artwork(1, 5)])
    act(() => useViewerStore.getState().requestAutoBrowse())
    fireEvent.load(view.container.querySelector('img')!)
    pointer(track(), 'pointerdown', 150)
    act(() => vi.advanceTimersByTime(6000))
    expect(index()).toBe(0)
    pointer(track(), 'pointerup', 150)
    expect(index()).toBe(2)
    view.container.querySelectorAll('.swiper-wrapper').forEach((node) => fireEvent.transitionEnd(node))
    const image = view.container.querySelector('img[src*="media-1-2"]')!
    fireEvent.load(image)
    act(() => vi.advanceTimersByTime(5001))
    act(() => vi.advanceTimersByTime(1))
    expect(index()).toBe(3)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
  })

  it('cancels previews when opening a panel or switching artworks', () => {
    const images = [artwork(1, 5), artwork(2)]
    const view = mount(images)
    const slider = track()
    pointer(slider, 'pointerdown', 225)
    view.rerender(
      <ImmersiveImageViewer
        playbackRate={1.5}
        onPlaybackRateChange={vi.fn()}
        initialImages={images}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
        interactionLocked
      />
    )
    expect(screen.getByRole('slider', { name: '图片位置' }).getAttribute('aria-valuenow')).toBe('1')
    pointer(slider, 'pointerup', 225)
    expect(index()).toBe(0)
    view.rerender(
      <ImmersiveImageViewer
        playbackRate={1.5}
        onPlaybackRateChange={vi.fn()}
        initialImages={images}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    pointer(track(), 'pointerdown', 225)
    act(() => useViewerStore.getState().setVerticalIndex(1))
    expect(screen.queryByLabelText('图片位置计数')).toBeNull()
    expect(screen.queryByRole('region', { name: '浏览进度' })).toBeNull()
    pointer(slider, 'pointerup', 225)
    expect(index()).toBe(0)
  })

  it('resumes playback after dragging back to the original video position', () => {
    const view = mount([artwork(1, 1, 'video')])
    const video = view.container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    video.currentTime = 10
    fireEvent.loadedMetadata(video)
    const slider = track('视频进度')
    pointer(slider, 'pointerdown', 150)
    pointer(slider, 'pointermove', 30)
    pointer(slider, 'pointerup', 30)
    expect(video.currentTime).toBe(10)
    expect(video.paused).toBe(false)
  })

  it('cancels video seeking on blur and ignores the old release', () => {
    const view = mount([artwork(1, 1, 'video')])
    const video = view.container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    video.currentTime = 10
    fireEvent.loadedMetadata(video)
    const slider = track('视频进度')
    pointer(slider, 'pointerdown', 150)
    expect(screen.getByLabelText('视频时间').textContent).toBe('0:50 / 1:40')
    fireEvent(window, new Event('blur'))
    expect(screen.getByLabelText('视频时间').textContent).toBe('0:10 / 1:40')
    pointer(slider, 'pointermove', 225)
    pointer(slider, 'pointerup', 225)
    expect(video.currentTime).toBe(10)
  })

  it.each([true, false])(
    'seeks a compact video and preserves playing=%s, rate, and node across chrome changes',
    (playing) => {
      const view = mount([artwork(1, 1, 'video')])
      const video = view.container.querySelector('video')!
      Object.defineProperties(video, {
        duration: { configurable: true, value: 100 },
        paused: { configurable: true, value: !playing }
      })
      video.currentTime = 10
      fireEvent.loadedMetadata(video)
      expect(screen.getByLabelText('视频时间').textContent).toBe('0:10 / 1:40')
      expect(screen.queryByRole('button', { name: /播放速率/ })).toBeNull()
      const slider = track('视频进度')
      pointer(slider, 'pointerdown', 150)
      expect(video.currentTime).toBe(10)
      expect(screen.getByLabelText('视频时间').textContent).toBe('0:50 / 1:40')
      pointer(slider, 'pointerup', 150)
      expect(video.currentTime).toBe(50)
      expect(video.paused).toBe(!playing)
      expect(video.playbackRate).toBe(1.5)
      act(() => useViewerStore.getState().setChromeHidden(false))
      expect(screen.getAllByRole('slider', { name: '视频进度' })).toHaveLength(1)
      expect(view.container.querySelector('video')).toBe(video)
      expect(video.currentTime).toBe(50)
    }
  )
})
