import { StrictMode, type ComponentProps, type ImgHTMLAttributes } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Swiper as SwiperType } from 'swiper'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImmersiveImageViewer from '../immersive-image-viewer'
import type VideoControls from '../viewer-video-controls'
import type StreamingWebpSurface from '@/components/players/streaming-webp-surface'

const reading = vi.hoisted(() => ({ observe: vi.fn(), clearSurface: vi.fn(), invalidated: false, ownerUserId: 'test' }))
const stream = vi.hoisted(() => ({ props: null as ComponentProps<typeof StreamingWebpSurface> | null }))
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => reading }))
vi.mock('@/components/user-setting', () => ({
  useVideoLongPressPlaybackRate: () => 3,
  useVideoSeekStepSeconds: () => 10
}))
vi.mock('next/image', () => ({
  default: ({ src, alt, onLoad, onError }: ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={String(src)} alt={alt} onLoad={onLoad} onError={onError} />
  )
}))
vi.mock('../image-overlay', () => ({
  default: ({ mediaControls }: { mediaControls: React.ReactNode }) => mediaControls
}))
vi.mock('../viewer-video-controls', () => ({
  default: (props: ComponentProps<typeof VideoControls>) => (
    <div data-viewer-control>
      <button onClick={() => props.onRateMenuOpenChange(!props.rateMenuOpen)}>倍速菜单</button>
      <button onClick={props.onTogglePlayback}>视频暂停或播放</button>
      <button onClick={props.onSeekPreviewStart}>开始拖动</button>
      <button onClick={() => props.onSeekCommit(100)}>拖到末尾</button>
      <button onClick={() => props.onSeek(20)}>快退</button>
    </div>
  )
}))
// Keep the real animation adapter, replacing only the Worker/Canvas transport.
vi.mock('@/components/players/streaming-webp-surface', () => ({
  default: (props: ComponentProps<typeof StreamingWebpSurface>) => {
    stream.props = props
    return <div data-testid="stream" data-paused={props.paused} />
  }
}))

function artwork(id: number, kinds: ('image' | 'video' | 'webp' | 'gif' | 'apng' | 'static-webp')[]): RandomImageItem {
  return {
    id,
    key: `art-${id}`,
    title: 'Artwork',
    imageUrl: '/image.jpg',
    mediaType: MediaType.IMAGE,
    author: null,
    tags: [],
    createdAt: '2026-10-18',
    isLike: false,
    ratingLevel: null,
    images: kinds.map((kind, index) => ({
      id: id * 10 + index,
      key: `media-${id}-${index}`,
      url: `/media-${id}-${index}.${kind === 'video' ? 'mp4' : kind === 'image' ? 'jpg' : kind === 'static-webp' ? 'webp' : kind}`,
      mediaType: kind === 'video' ? MediaType.VIDEO : MediaType.IMAGE,
      isAnimated: kind === 'webp' || kind === 'gif' || kind === 'apng',
      updatedAt: '2026-10-18',
      animationMetadata: null
    }))
  }
}
function mount(
  images: RandomImageItem[],
  extra: Partial<ComponentProps<typeof ImmersiveImageViewer>> = {},
  strict = false
) {
  useViewerStore.setState({ images })
  const props = {
    playbackRate: 1 as const,
    onPlaybackRateChange: vi.fn(),
    initialImages: images,
    hasMore: false,
    isLoading: false,
    onLoadMore: vi.fn(),
    ...extra
  }
  const node = <ImmersiveImageViewer {...props} />
  const view = render(strict ? <StrictMode>{node}</StrictMode> : node)
  return { ...view, props }
}
function run() {
  act(() => useViewerStore.getState().requestAutoBrowse())
}
function tick(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
  act(() => vi.advanceTimersByTime(1))
}
function finishTransitions(container: HTMLElement) {
  container.querySelectorAll('.swiper-wrapper').forEach((wrapper) => fireEvent.transitionEnd(wrapper))
}
function activeVideo(container: HTMLElement) {
  return container.querySelector('.swiper-slide-active video') as HTMLVideoElement
}
function finishVideo(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: 100 },
    ended: { configurable: true, value: true }
  })
  video.currentTime = 100
  fireEvent.ended(video)
  tick(1)
}

describe('immersive automatic browsing with real Swipers', () => {
  it.each([true, false])('waits for speed menu dismissal before advancing (horizontal=%s)', (horizontal) => {
    const images = horizontal ? [artwork(1, ['video', 'video'])] : [artwork(1, ['video']), artwork(2, ['video'])]
    const view = mount(images, { playbackRate: 1.5 })
    run()
    const video = activeVideo(view.container)
    fireEvent.loadedMetadata(video)
    fireEvent.canPlay(video)
    expect(video.playbackRate).toBe(1.5)
    fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
    finishVideo(video)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(useViewerStore.getState().horizontalIndexes['art-1'] ?? 0).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
    tick(2)
    expect(
      horizontal ? useViewerStore.getState().horizontalIndexes['art-1'] : useViewerStore.getState().verticalIndex
    ).toBe(1)
    finishTransitions(view.container)
    tick(1000)
    expect(
      horizontal ? useViewerStore.getState().horizontalIndexes['art-1'] : useViewerStore.getState().verticalIndex
    ).toBe(1)
    expect(activeVideo(view.container).playbackRate).toBe(1.5)
  })

  it.each(['background', 'media-error', 'user'] as const)(
    'does not resume %s pause when closing speed menu',
    (reason) => {
      const view = mount([artwork(1, ['video']), artwork(2, ['video'])])
      run()
      fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
      act(() => useViewerStore.getState().pauseAutoBrowse(reason))
      fireEvent.click(screen.getByRole('button', { name: '倍速菜单' }))
      tick(10)
      expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
      expect(useViewerStore.getState().autoBrowsePauseReason).toBe(reason)
      expect(activeVideo(view.container)).toBeTruthy()
    }
  )

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
    useViewerStore.setState({ autoBrowseInterval: 5 })
    stream.props = null
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('waits for loaded images, advances horizontally then vertically and stops at the end', () => {
    const view = mount([artwork(1, ['image', 'video']), artwork(2, ['video'])], {}, true)
    run()
    tick(20000)
    expect(useViewerStore.getState().horizontalIndexes['art-1'] ?? 0).toBe(0)
    fireEvent.load(view.container.querySelector('img')!)
    tick(4990)
    expect(useViewerStore.getState().horizontalIndexes['art-1'] ?? 0).toBe(0)
    tick(10)
    expect(useViewerStore.getState().horizontalIndexes['art-1']).toBe(1)
    finishTransitions(view.container)
    const video = activeVideo(view.container)
    expect(video.loop).toBe(false)
    video.currentTime = 90
    fireEvent.timeUpdate(video)
    tick(100)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    finishVideo(video)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    expect(useViewerStore.getState().horizontalIndexes['art-2']).toBe(0)
    finishTransitions(view.container)
    finishVideo(activeVideo(view.container))
    expect(useViewerStore.getState().autoBrowseStatus).toBe('ended')
    expect(screen.getByText('已浏览全部作品')).toBeTruthy()
  })

  it('does not advance while a pointer is held and ignores duplicate/stale end events', () => {
    const view = mount([artwork(1, ['video', 'video']), artwork(2, ['video'])])
    run()
    const video = activeVideo(view.container)
    fireEvent.pointerDown(video)
    finishVideo(video)
    expect(useViewerStore.getState().horizontalIndexes['art-1'] ?? 0).toBe(0)
    fireEvent.pointerUp(video)
    tick(1)
    expect(useViewerStore.getState().horizontalIndexes['art-1']).toBe(1)
    finishTransitions(view.container)
    finishVideo(video)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
  })

  it('pauses for panels and background and requires explicit continuation with a fresh image interval', () => {
    const view = mount([artwork(1, ['image']), artwork(2, ['image'])])
    fireEvent.load(view.container.querySelector('img')!)
    run()
    tick(3000)
    view.rerender(<ImmersiveImageViewer {...view.props} interactionLocked />)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    view.rerender(<ImmersiveImageViewer {...view.props} />)
    tick(10000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    run()
    tick(3000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    tick(10000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    run()
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('keeps automatic mode while manually switching, but cancels the old timer', () => {
    const view = mount([artwork(1, ['image', 'image']), artwork(2, ['image'])])
    fireEvent.load(view.container.querySelector('img')!)
    run()
    tick(4500)
    const horizontal = view.container.querySelector('.swiper-horizontal') as HTMLElement & { swiper: SwiperType }
    act(() => horizontal.swiper.slideTo(1))
    finishTransitions(view.container)
    const next = view.container.querySelector('img[src*="/media-1-1.jpg"]')!
    fireEvent.load(next)
    tick(1000)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    tick(4000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('pauses for video controls, preserves paused seeking and advances on explicit continue', () => {
    const view = mount([artwork(1, ['video']), artwork(2, ['image'])])
    const video = activeVideo(view.container)
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    run()
    fireEvent.click(screen.getByText('视频暂停或播放'))
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    fireEvent.click(screen.getByText('开始拖动'))
    fireEvent.click(screen.getByText('拖到末尾'))
    tick(1000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    run()
    tick(1)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('advances after releasing a playing seek to the end', () => {
    const view = mount([artwork(1, ['video']), artwork(2, ['image'])])
    Object.defineProperty(activeVideo(view.container), 'duration', { configurable: true, value: 100 })
    run()
    fireEvent.click(screen.getByText('开始拖动'))
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    fireEvent.click(screen.getByText('拖到末尾'))
    tick(1)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('waits for pagination and advances only once when the next page arrives', async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const images = [artwork(1, ['video'])]
    const view = mount(images, { hasMore: true, isLoading: true, onLoadMore: load })
    run()
    finishVideo(activeVideo(view.container))
    expect(useViewerStore.getState().autoBrowseWait).toBe('page')
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(load).not.toHaveBeenCalled()
    const extended = [...images, artwork(2, ['image'])]
    await act(async () => {
      useViewerStore.getState().setImages(extended)
      view.rerender(<ImmersiveImageViewer {...view.props} initialImages={extended} hasMore={false} isLoading={false} />)
    })
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
  })

  it('pauses on media errors and can skip the final item of an artwork', () => {
    const view = mount([artwork(1, ['image']), artwork(2, ['image'])])
    run()
    fireEvent.error(view.container.querySelector('img')!)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    fireEvent.click(screen.getByText('跳过并继续'))
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
  })

  it('uses the real WebP adapter for single-loop completion and pause/resume', () => {
    const view = mount([artwork(1, ['webp']), artwork(2, ['image'])])
    run()
    expect(stream.props?.loop).toBe(false)
    act(() => stream.props!.onReady())
    tick(20000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    act(() => useViewerStore.getState().pauseAutoBrowse('user'))
    expect(stream.props?.paused).toBe(true)
    run()
    expect(stream.props?.paused).toBe(false)
    act(() => stream.props!.onComplete())
    tick(1)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    view.unmount()
    expect(useViewerStore.getState().autoBrowseStatus).toBe('off')
  })

  it('starts the GIF timer only after the animated original loads', () => {
    const view = mount([artwork(1, ['gif']), artwork(2, ['image'])])
    run()
    const gif = view.container.querySelector('img.absolute[src*="media-1-0.gif"]')!
    expect(gif).toBeTruthy()
    tick(10000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    fireEvent.load(gif)
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('treats a static WebP as a timed image without interpreting its idle player as a user pause', () => {
    const view = mount([artwork(1, ['image', 'static-webp', 'video'])])
    fireEvent.load(view.container.querySelector('img')!)
    run()
    tick(5000)
    finishTransitions(view.container)
    expect(useViewerStore.getState().horizontalIndexes['art-1']).toBe(1)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('running')
    fireEvent.load(view.container.querySelector('img[src*="media-1-1.webp"]')!)
    tick(5000)
    expect(useViewerStore.getState().horizontalIndexes['art-1']).toBe(2)
  })

  it('loads the original APNG and starts timing only after it loads, not after the poster', () => {
    const view = mount([artwork(1, ['apng']), artwork(2, ['image'])])
    fireEvent.load(view.container.querySelector('img')!)
    run()
    const original = view.container.querySelector('img[src^="/api/v1/images/"][src*=".apng"]')!
    expect(original).toBeTruthy()
    tick(10000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    fireEvent.load(original)
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('keeps only interval preferences across persistence and cancels work on unmount', async () => {
    const view = mount([artwork(1, ['image']), artwork(2, ['image'])])
    fireEvent.load(view.container.querySelector('img')!)
    run()
    act(() => useViewerStore.getState().setAutoBrowseInterval(15))
    const saved = JSON.parse(localStorage.getItem('pixishelf-viewer-settings')!).state
    expect(saved.autoBrowseInterval).toBe(15)
    expect(saved.autoBrowseStatus).toBeUndefined()
    view.unmount()
    tick(20000)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('off')
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    await useViewerStore.persist.rehydrate()
    expect(useViewerStore.getState().autoBrowseInterval).toBe(15)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('off')
  })

  it('does not reset the image timer for chrome toggles or short pointer interactions', () => {
    const view = mount([artwork(1, ['image']), artwork(2, ['image'])])
    const image = view.container.querySelector('img')!
    fireEvent.load(image)
    run()
    tick(4000)
    fireEvent.pointerDown(image)
    act(() => useViewerStore.getState().toggleChromeHidden())
    tick(500)
    fireEvent.pointerUp(image)
    tick(500)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    expect(useViewerStore.getState().isChromeHidden).toBe(true)
  })

  it('holds the next image timer until the slide transition finishes', () => {
    const view = mount([artwork(1, ['image', 'image']), artwork(2, ['image'])])
    run()
    const horizontal = view.container.querySelector('.swiper-horizontal') as HTMLElement & { swiper: SwiperType }
    act(() => horizontal.swiper.slideTo(1))
    fireEvent.load(view.container.querySelector('img[src*="/media-1-1.jpg"]')!)
    tick(10000)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    finishTransitions(view.container)
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('cancels a pending page advance when manually going back within the same artwork', () => {
    const images = [artwork(1, ['image', 'video'])]
    const view = mount(images, { hasMore: true, isLoading: true })
    const horizontal = view.container.querySelector('.swiper-horizontal') as HTMLElement & { swiper: SwiperType }
    act(() => horizontal.swiper.slideTo(1))
    finishTransitions(view.container)
    run()
    finishVideo(activeVideo(view.container))
    expect(useViewerStore.getState().autoBrowseWait).toBe('page')
    act(() => horizontal.swiper.slideTo(0))
    finishTransitions(view.container)
    const extended = [...images, artwork(2, ['image'])]
    act(() => useViewerStore.getState().setImages(extended))
    view.rerender(<ImmersiveImageViewer {...view.props} initialImages={extended} hasMore={false} isLoading={false} />)
    tick(10)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(useViewerStore.getState().horizontalIndexes['art-1']).toBe(0)
  })

  it('pauses on page failure, retries without resuming and continues only on request', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const images = [artwork(1, ['video'])]
    const view = mount(images, { hasMore: true, onLoadMore: load })
    run()
    finishVideo(activeVideo(view.container))
    await act(async () => {
      await Promise.resolve()
    })
    tick(1)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    expect(screen.getByText('重试加载')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('重试加载')))
    const extended = [...images, artwork(2, ['image'])]
    act(() => useViewerStore.getState().setImages(extended))
    view.rerender(<ImmersiveImageViewer {...view.props} initialImages={extended} hasMore={false} />)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    run()
    expect(useViewerStore.getState().verticalIndex).toBe(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not resume automatically after a failed image is retried successfully', () => {
    const view = mount([artwork(1, ['image']), artwork(2, ['image'])])
    run()
    fireEvent.error(view.container.querySelector('img')!)
    fireEvent.click(screen.getByText('重试'))
    fireEvent.load(view.container.querySelector('img')!)
    tick(10000)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    run()
    tick(5000)
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('publishes final reading evidence before leaving and restores looping without unpausing', () => {
    const view = mount([artwork(1, ['video']), artwork(2, ['image'])])
    const video = activeVideo(view.container)
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    fireEvent.canPlay(video)
    fireEvent.playing(video)
    run()
    expect(video.loop).toBe(false)
    fireEvent.click(screen.getByText('视频暂停或播放'))
    act(() => useViewerStore.getState().stopAutoBrowse())
    expect(video.loop).toBe(true)
    expect(video.paused).toBe(true)
    run()
    finishVideo(video)
    expect(reading.observe).toHaveBeenCalledWith(
      'immersive-viewer',
      expect.objectContaining({
        mediaId: 10,
        automatic: true,
        playback: expect.objectContaining({ currentTime: 100, duration: 100 })
      })
    )
    expect(useViewerStore.getState().verticalIndex).toBe(1)
  })

  it('consumes automatic restart once and restores the watched position on a later manual return', () => {
    const view = mount([artwork(1, ['video']), artwork(2, ['video']), artwork(3, ['video'])])
    run()
    finishVideo(activeVideo(view.container))
    finishTransitions(view.container)
    finishVideo(activeVideo(view.container))
    finishTransitions(view.container)
    let video = activeVideo(view.container)
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    fireEvent.loadedMetadata(video)
    expect(useViewerStore.getState().autoBrowseRestart?.consumed).toBe(true)
    video.currentTime = 35
    fireEvent.timeUpdate(video)
    act(() => useViewerStore.getState().pauseAutoBrowse('user'))
    const vertical = view.container.querySelector('.swiper-vertical') as HTMLElement & { swiper: SwiperType }
    act(() => vertical.swiper.slideTo(0))
    finishTransitions(view.container)
    act(() => vertical.swiper.slideTo(2))
    finishTransitions(view.container)
    video = activeVideo(view.container)
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(35)
    expect(video.paused).toBe(true)
    expect(useViewerStore.getState().autoBrowseStatus).toBe('paused')
  })

  it('cancels pending pagination navigation when seeking back from the end', () => {
    const images = [artwork(1, ['video'])]
    const view = mount(images, { hasMore: true, isLoading: true })
    run()
    finishVideo(activeVideo(view.container))
    expect(useViewerStore.getState().autoBrowseWait).toBe('page')
    fireEvent.click(screen.getByText('快退'))
    const extended = [...images, artwork(2, ['image'])]
    act(() => useViewerStore.getState().setImages(extended))
    view.rerender(<ImmersiveImageViewer {...view.props} initialImages={extended} hasMore={false} isLoading={false} />)
    tick(10)
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(activeVideo(view.container).currentTime).toBe(20)
  })
})
