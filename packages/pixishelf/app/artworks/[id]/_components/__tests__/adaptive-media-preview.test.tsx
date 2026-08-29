import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import AdaptiveMediaPreview, { canPreloadAdaptiveNeighbor } from '../adaptive-media-preview'

const swiperMocks = vi.hoisted(() => {
  const instance = {
    activeIndex: 0,
    allowSlideNext: true,
    allowSlidePrev: true,
    slideNext: vi.fn(),
    slidePrev: vi.fn()
  }

  return { instance }
})

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    className,
    loading,
    quality,
    priority,
    onLoad
  }: {
    src: string
    alt: string
    className?: string
    loading?: 'eager' | 'lazy'
    quality?: number
    priority?: boolean
    onLoad?: React.ReactEventHandler<HTMLImageElement>
  }) => {
    // oxlint-disable-next-line nextjs/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        data-quality={quality}
        data-priority={priority ? 'true' : undefined}
        onLoad={onLoad}
      />
    )
  }
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (open ? children : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>
}))

vi.mock('swiper/react', () => ({
  Swiper: (props: {
    children: React.ReactNode
    initialSlide: number
    onSwiper: (swiper: typeof swiperMocks.instance) => void
    onSlideChange: (swiper: typeof swiperMocks.instance) => void
    onZoomChange: (swiper: typeof swiperMocks.instance, scale: number) => void
    modules?: unknown[]
    direction?: string
    keyboard?: unknown
    virtual?: unknown
    zoom?: unknown
    resistanceRatio?: number
    spaceBetween?: number
    onBeforeDestroy?: () => void
    className?: string
    'data-testid'?: string
  }) => {
    swiperMocks.instance.activeIndex = props.initialSlide
    props.onSwiper(swiperMocks.instance)

    return (
      <div className={props.className} data-testid={props['data-testid']} data-direction={props.direction}>
        {props.children}
        <button
          type="button"
          onClick={() => {
            swiperMocks.instance.activeIndex = 2
            props.onSlideChange(swiperMocks.instance)
          }}
        >
          模拟切换
        </button>
        <button type="button" onClick={() => props.onZoomChange(swiperMocks.instance, 2)}>
          模拟缩放
        </button>
      </div>
    )
  },
  SwiperSlide: (props: React.HTMLAttributes<HTMLDivElement> & { virtualIndex?: number }) => (
    <div className={props.className}>{props.children}</div>
  )
}))

function createMedia(index: number, path = `/media-${index + 1}.jpg`): ArtworkImageResponseDto {
  return {
    id: index + 1,
    path,
    width: 1200,
    height: 1800,
    size: 1024 * 1024,
    sortOrder: index,
    artworkId: 1,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    webpAnimationStatus: null,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersUpdatedAt: null,
    chaptersHash: null,
    mediaType: path.endsWith('.mp4') ? 'video' : 'image',
    hasChapters: false,
    chaptersUrl: null
  }
}

describe('AdaptiveMediaPreview', () => {
  beforeEach(() => {
    swiperMocks.instance.activeIndex = 0
    swiperMocks.instance.allowSlideNext = true
    swiperMocks.instance.allowSlidePrev = true
    swiperMocks.instance.slideNext.mockClear()
    swiperMocks.instance.slidePrev.mockClear()
    history.replaceState({}, '', window.location.href)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the selected slide with the raw media path so Next Image uses Imgproxy', () => {
    render(
      <AdaptiveMediaPreview
        images={[createMedia(0), createMedia(1), createMedia(2)]}
        initialIndex={1}
        open
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('2 / 3')).toBeTruthy()
    const images = screen.getAllByRole('img')
    expect(images[1]!.getAttribute('src')).toBe('/media-2.jpg?v=2026-01-01%2000%3A00%3A00')
    expect(images[1]!.getAttribute('src')).not.toContain('/api/image')
    expect(images[1]!.getAttribute('data-quality')).toBe('90')
    expect(images[1]!.getAttribute('data-priority')).toBe('true')
    expect(screen.getByTestId('adaptive-media-preview-swiper').getAttribute('data-direction')).toBe('vertical')
    expect(screen.getByText('上下切换 · 双指或双击缩放')).toBeTruthy()
  })

  it('moves the eager neighbor window after the active image has loaded', () => {
    render(
      <AdaptiveMediaPreview
        images={[createMedia(0), createMedia(1), createMedia(2), createMedia(3)]}
        initialIndex={1}
        open
        onClose={vi.fn()}
      />
    )

    const images = screen.getAllByRole('img')
    expect(images.map((image) => image.getAttribute('loading'))).toEqual(['lazy', null, 'lazy', 'lazy'])

    fireEvent.load(images[1]!)
    expect(images.map((image) => image.getAttribute('loading'))).toEqual(['eager', null, 'eager', 'lazy'])

    fireEvent.load(images[2]!)
    fireEvent.click(screen.getByRole('button', { name: '模拟切换' }))
    expect(images.map((image) => image.getAttribute('loading'))).toEqual(['lazy', null, 'eager', 'eager'])
  })

  it('never combines priority with lazy loading after moving away from the initial slide', () => {
    render(
      <AdaptiveMediaPreview
        images={[createMedia(0), createMedia(1), createMedia(2), createMedia(3)]}
        initialIndex={0}
        open
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '模拟切换' }))

    const initialImage = screen.getAllByRole('img')[0]!
    expect(initialImage.getAttribute('data-priority')).toBe('true')
    expect(initialImage.getAttribute('loading')).not.toBe('lazy')
  })

  it('blocks neighbor preloading for oversized, animated, or data-saving media', () => {
    const media = createMedia(0)
    expect(canPreloadAdaptiveNeighbor(media, { isMobile: true, saveData: false })).toBe(true)
    expect(canPreloadAdaptiveNeighbor({ ...media, size: 7 * 1024 * 1024 }, { isMobile: true, saveData: false })).toBe(
      false
    )
    expect(
      canPreloadAdaptiveNeighbor(
        { ...media, path: '/animated.gif', isAnimated: true },
        { isMobile: false, saveData: false }
      )
    ).toBe(false)
    expect(canPreloadAdaptiveNeighbor(media, { isMobile: false, saveData: true })).toBe(false)
  })

  it('treats a confirmed static WebP as an ordinary preview image', () => {
    const media = {
      ...createMedia(0, '/static.webp'),
      webpAnimationStatus: 1,
      isAnimated: false
    }

    expect(canPreloadAdaptiveNeighbor(media, { isMobile: false, saveData: false })).toBe(true)

    render(<AdaptiveMediaPreview images={[media]} initialIndex={0} open onClose={vi.fn()} />)

    expect(screen.queryByText('动图静态预览')).toBeNull()
    expect(screen.getByText('上下切换 · 双指或双击缩放')).toBeTruthy()
  })

  it('plays a confirmed animated WebP from the bottom control without an internal badge', () => {
    const media = {
      ...createMedia(0, '/animated.webp'),
      webpAnimationStatus: 2,
      isAnimated: true
    }

    render(<AdaptiveMediaPreview images={[media]} initialIndex={0} open onClose={vi.fn()} />)

    const playButton = screen.getByRole('button', { name: '播放 WEBP 动图' })
    expect(playButton.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('button', { name: /WEBP 动图/ })).toHaveLength(1)
    expect(screen.queryByText('动图静态预览')).toBeNull()
    expect(screen.queryByText('1.0MB')).toBeNull()
    expect(screen.getAllByAltText('作品 WEBP 动图 1')).toHaveLength(1)
    expect(screen.getByAltText('作品 WEBP 动图 1').parentElement?.classList.contains('swiper-zoom-target')).toBe(
      true
    )

    fireEvent.click(playButton)

    expect(screen.getByRole('button', { name: '暂停 WEBP 动图' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByAltText('作品 WEBP 动图 1')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '模拟缩放' }))
    expect(screen.getByRole('button', { name: '暂停 WEBP 动图' })).toBeTruthy()
    expect(screen.getByText('2.0× · 拖动查看，缩小后切换')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '暂停 WEBP 动图' }))
    expect(screen.getByRole('button', { name: '播放 WEBP 动图' })).toBeTruthy()
    expect(screen.getAllByAltText('作品 WEBP 动图 1')).toHaveLength(1)
  })

  it('stops the active WebP and keeps other slides static when switching media', () => {
    const images = [
      { ...createMedia(0, '/animated-1.webp'), webpAnimationStatus: 2, isAnimated: true },
      createMedia(1),
      { ...createMedia(2, '/animated-3.webp'), webpAnimationStatus: 2, isAnimated: true }
    ]

    render(<AdaptiveMediaPreview images={images} initialIndex={0} open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
    expect(screen.getAllByAltText('作品 WEBP 动图 1')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '模拟切换' }))

    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放 WEBP 动图' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryAllByAltText('作品 WEBP 动图 1')).toHaveLength(0)
    expect(screen.getAllByAltText('作品 WEBP 动图 3')).toHaveLength(1)
  })

  it('does not offer playback while WebP animation detection is pending', () => {
    const media = {
      ...createMedia(0, '/pending.webp'),
      webpAnimationStatus: 0,
      isAnimated: false
    }

    render(<AdaptiveMediaPreview images={[media]} initialIndex={0} open onClose={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /WEBP 动图/ })).toBeNull()
    expect(screen.getByText('动图静态预览')).toBeTruthy()
    expect(screen.getByText('静态适配预览 · 长按原媒体可查看原文件')).toBeTruthy()
  })

  it('keeps slide navigation disabled while zoomed and restores the final index on close', () => {
    const onClose = vi.fn()
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    render(
      <AdaptiveMediaPreview
        images={[createMedia(0), createMedia(1), createMedia(2)]}
        initialIndex={0}
        open
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '模拟切换' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '模拟缩放' }))
    expect(swiperMocks.instance.allowSlideNext).toBe(false)
    expect(swiperMocks.instance.allowSlidePrev).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '关闭适配尺寸预览' }))
    expect(backSpy).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })))
    expect(onClose).toHaveBeenCalledWith(2)
  })
})
