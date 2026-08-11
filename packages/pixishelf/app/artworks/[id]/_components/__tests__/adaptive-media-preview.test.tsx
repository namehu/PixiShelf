import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import AdaptiveMediaPreview from '../adaptive-media-preview'

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
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => {
    // oxlint-disable-next-line nextjs/no-img-element
    return <img src={src} alt={alt} className={className} />
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
      <div className={props.className} data-testid={props['data-testid']}>
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
    size: null,
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
    expect(images[1]!.getAttribute('src')).toBe('/media-2.jpg')
    expect(images[1]!.getAttribute('src')).not.toContain('/api/image')
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
