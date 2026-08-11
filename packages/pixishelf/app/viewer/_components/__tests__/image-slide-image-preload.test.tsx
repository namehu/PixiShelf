import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { RandomImageItem, ViewerMediaItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImageSlide, { SingleImage } from '../image-slide'

vi.mock('next/image', () => ({
  default: ({ src, alt, loading, onLoad }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // oxlint-disable-next-line nextjs/no-img-element
    return <img src={typeof src === 'string' ? src : undefined} alt={alt} loading={loading} onLoad={onLoad} />
  }
}))

vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    isAnimated: false
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
    isLike: false
  }
}

const commonProps = {
  audioPreference: { muted: true, volume: 1 },
  onAudioPreferenceChange: vi.fn(),
  chapterPanelOpen: false,
  onChapterPanelOpenChange: vi.fn(),
  onActiveMediaSettled: vi.fn(),
  onEnterClearMode: vi.fn(),
  onExitClearMode: vi.fn(),
  getPlaybackPosition: () => 0,
  onPlaybackPositionChange: vi.fn()
}

describe('viewer staged image preloading', () => {
  beforeEach(() => {
    useViewerStore.setState({ horizontalIndexes: {}, isChromeHidden: false })
  })

  afterEach(() => cleanup())

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
    render(
      <ImageSlide
        {...commonProps}
        image={createArtwork([createMedia(3)])}
        isActive={false}
        preloadEntryMedia
      />
    )

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

    expect(
      screen
        .getAllByAltText('image-6')
        .some((image) => image.getAttribute('src')?.startsWith('/api/v1/images/animated.webp?v='))
    ).toBe(true)
  })
})
