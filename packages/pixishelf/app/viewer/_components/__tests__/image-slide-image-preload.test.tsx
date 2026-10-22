import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem, ViewerMediaItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImageSlide, { SingleImage } from '../image-slide'
import { useEffect } from 'react'
import type { Swiper as SwiperType } from 'swiper'

const swiperModules = vi.hoisted(() => ({
  keyboard: { enable: vi.fn(), disable: vi.fn() },
  destroyed: false,
  activeIndex: 0,
  slideTo: vi.fn()
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, loading, onLoad, onError }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // oxlint-disable-next-line nextjs/no-img-element
    return (
      <img
        src={typeof src === 'string' ? src : undefined}
        alt={alt}
        loading={loading}
        onLoad={onLoad}
        onError={onError}
      />
    )
  }
}))

vi.mock('swiper/react', () => ({
  Swiper: function MockSwiper({
    children,
    onSwiper
  }: {
    children: React.ReactNode
    onSwiper: (swiper: SwiperType) => void
  }) {
    useEffect(() => onSwiper(swiperModules as unknown as SwiperType), [onSwiper])
    return <div>{children}</div>
  },
  SwiperSlide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/user-setting', () => ({
  useVideoLongPressPlaybackRate: () => 3,
  useVideoSeekStepSeconds: () => 10
}))

vi.mock('../image-overlay', () => ({ default: () => null }))
vi.mock('../viewer-video-controls', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function createMedia(id: number): ViewerMediaItem {
  return {
    id,
    key: `image-${id}`,
    url: `/image-${id}.jpg`,
    updatedAt: '2026-08-11T00:00:00.000Z',
    mediaType: MediaType.IMAGE,
    size: 1024 * 1024,
    width: 1200,
    height: 1800,
    isAnimated: false,
    animationMetadata: null
  }
}

function createArtwork(images: ViewerMediaItem[]): RandomImageItem {
  return {
    id: 1,
    key: 'artwork-1',
    title: 'Artwork',
    imageUrl: images[0]!.url,
    mediaType: images[0]!.mediaType,
    images,
    author: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    tags: [],
    isLike: false,
    ratingLevel: null
  }
}

const commonProps = {
  playbackRate: 1 as const,
  onPlaybackRateChange: vi.fn(),
  rateMenuOpen: false,
  onRateMenuOpenChange: vi.fn(),
  audioPreference: { muted: true, volume: 1 },
  onAudioPreferenceChange: vi.fn(),
  chapterPanelOpen: false,
  onChapterPanelOpenChange: vi.fn(),
  onActiveMediaSettled: vi.fn(),
  onHideChrome: vi.fn(),
  onToggleChrome: vi.fn(),
  getPlaybackPosition: () => 0,
  onPlaybackPositionChange: vi.fn()
}

describe('viewer staged image preloading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({ horizontalIndexes: {}, isChromeHidden: false })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('disables and restores the horizontal keyboard module across modal locks and inactive slides', () => {
    const image = createArtwork([createMedia(1), createMedia(2)])
    const view = render(<ImageSlide {...commonProps} image={image} isActive preloadEntryMedia={false} />)
    expect(swiperModules.keyboard.enable).toHaveBeenCalled()
    view.rerender(<ImageSlide {...commonProps} image={image} isActive preloadEntryMedia={false} interactionLocked />)
    expect(swiperModules.keyboard.disable).toHaveBeenCalled()
    swiperModules.keyboard.enable.mockClear()
    view.rerender(<ImageSlide {...commonProps} image={image} isActive preloadEntryMedia={false} />)
    expect(swiperModules.keyboard.enable).toHaveBeenCalledOnce()
    swiperModules.keyboard.disable.mockClear()
    view.rerender(<ImageSlide {...commonProps} image={image} isActive={false} preloadEntryMedia={false} />)
    expect(swiperModules.keyboard.disable).toHaveBeenCalledOnce()
  })

  it('keeps animation playback and its DOM mounted when chrome is hidden', () => {
    const props = {
      media: { ...createMedia(8), url: '/animated.gif', isAnimated: true },
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: true, volume: 1 },
      isActiveMedia: true,
      onGesturePointerDown: vi.fn()
    }
    const view = render(<SingleImage {...props} />)
    const play = screen.getByRole('button', { name: '播放 GIF 动图' })
    fireEvent.pointerDown(play)
    fireEvent.click(play)
    expect(props.onGesturePointerDown).not.toHaveBeenCalled()
    const playingImages = screen.getAllByRole('img')
    expect(playingImages).toHaveLength(2)
    view.rerender(<SingleImage {...props} chromeHidden />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('img')[1]).toBe(playingImages[1])
    view.rerender(<SingleImage {...props} />)
    expect(screen.getByRole('button', { name: '暂停 GIF 动图' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps a gesture surface on loading and failure states, excluding retry controls', () => {
    const props = {
      media: createMedia(9),
      retryKey: 0,
      onRetry: vi.fn(),
      audioPreference: { muted: true, volume: 1 },
      onGesturePointerDown: vi.fn()
    }
    const view = render(<SingleImage {...props} shouldLoad={false} />)
    fireEvent.pointerDown(screen.getByText('准备加载...'))
    expect(props.onGesturePointerDown).toHaveBeenCalledOnce()
    view.rerender(<SingleImage {...props} />)
    fireEvent.error(screen.getByAltText('image-9'))
    fireEvent.pointerDown(screen.getByText('图片加载失败'))
    expect(props.onGesturePointerDown).toHaveBeenCalledTimes(2)
    const retry = screen.getByRole('button', { name: '重试' })
    fireEvent.pointerDown(retry)
    fireEvent.click(retry)
    expect(props.onRetry).toHaveBeenCalledOnce()
    expect(props.onGesturePointerDown).toHaveBeenCalledTimes(2)
  })

  it('cancels pending taps when media changes or a panel locks interaction', () => {
    vi.useFakeTimers()
    const onToggleChrome = vi.fn()
    const first = createArtwork([createMedia(10)])
    const second = createArtwork([createMedia(11)])
    const view = render(
      <ImageSlide {...commonProps} onToggleChrome={onToggleChrome} image={first} isActive preloadEntryMedia={false} />
    )
    fireEvent.pointerDown(screen.getByAltText('image-10'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    fireEvent.pointerUp(screen.getByAltText('image-10'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    view.rerender(
      <ImageSlide {...commonProps} onToggleChrome={onToggleChrome} image={second} isActive preloadEntryMedia={false} />
    )
    act(() => vi.advanceTimersByTime(300))
    expect(onToggleChrome).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    fireEvent.pointerUp(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    view.rerender(
      <ImageSlide
        {...commonProps}
        onToggleChrome={onToggleChrome}
        image={second}
        isActive
        preloadEntryMedia={false}
        interactionLocked
      />
    )
    act(() => vi.advanceTimersByTime(300))
    expect(onToggleChrome).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    fireEvent.pointerUp(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    act(() => vi.advanceTimersByTime(300))
    expect(onToggleChrome).not.toHaveBeenCalled()
    view.rerender(
      <ImageSlide {...commonProps} onToggleChrome={onToggleChrome} image={second} isActive preloadEntryMedia={false} />
    )
    fireEvent.pointerDown(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    fireEvent.pointerUp(screen.getByAltText('image-11'), {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    act(() => vi.advanceTimersByTime(300))
    expect(onToggleChrome).toHaveBeenCalledOnce()
  })

  it('loads the next horizontal image eagerly after the active image finishes', async () => {
    render(
      <ImageSlide
        {...commonProps}
        image={createArtwork([createMedia(1), createMedia(2)])}
        isActive
        preloadEntryMedia={false}
      />
    )

    expect(screen.queryByAltText('image-2')).toBeNull()
    fireEvent.load(screen.getByAltText('image-1'))

    await waitFor(() => expect(screen.getByAltText('image-2').getAttribute('loading')).toBe('eager'))
  })

  it('loads the next artwork entry image eagerly after the parent unlocks it', () => {
    render(<ImageSlide {...commonProps} image={createArtwork([createMedia(3)])} isActive={false} preloadEntryMedia />)

    expect(screen.getByAltText('image-3').getAttribute('loading')).toBe('eager')
  })

  it('continues the preload chain after an inactive entry image becomes active', async () => {
    const onActiveMediaSettled = vi.fn()
    const artwork = createArtwork([createMedia(4), createMedia(5)])
    const view = render(
      <ImageSlide
        {...commonProps}
        image={artwork}
        isActive={false}
        preloadEntryMedia
        onActiveMediaSettled={onActiveMediaSettled}
      />
    )

    fireEvent.load(screen.getByAltText('image-4'))
    expect(screen.queryByAltText('image-5')).toBeNull()

    view.rerender(
      <ImageSlide
        {...commonProps}
        image={artwork}
        isActive
        preloadEntryMedia={false}
        onActiveMediaSettled={onActiveMediaSettled}
      />
    )

    await waitFor(() => expect(onActiveMediaSettled).toHaveBeenCalledWith('ready'))
    expect(screen.getByAltText('image-5').getAttribute('loading')).toBe('eager')
  })

  it('offers identified animated WebP media as playable instead of flattening it to a static image', () => {
    const onMediaReady = vi.fn()
    render(
      <SingleImage
        media={{ ...createMedia(6), url: '/animated.webp', isAnimated: true }}
        retryKey={0}
        onRetry={vi.fn()}
        audioPreference={{ muted: true, volume: 1 }}
        isActiveMedia
        onMediaReady={onMediaReady}
      />
    )

    fireEvent.load(screen.getByAltText('image-6'))
    expect(onMediaReady).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))

    const surface = screen.getAllByRole('img', { name: 'image-6' }).find((element) => element.tagName === 'CANVAS')
    expect(surface?.getAttribute('data-webp-player')).toBe('wasm')
  })
})
