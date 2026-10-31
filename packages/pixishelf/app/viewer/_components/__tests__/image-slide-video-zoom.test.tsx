import { act, cleanup, fireEvent, waitFor, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactNode, type ComponentProps } from 'react'
import type { Swiper as SwiperType } from 'swiper'
import { MediaType } from '@/types'
import type { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import ImageSlide from '../image-slide'
import type ViewerVideoControls from '../viewer-video-controls'
import { VideoZoomButton } from '@/components/players/video-zoom-button'

const swiper = vi.hoisted(() => ({
  keyboard: { enable: vi.fn(), disable: vi.fn() },
  destroyed: false,
  activeIndex: 0,
  slideTo: vi.fn()
}))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/user-setting', () => ({
  useVideoLongPressPlaybackRate: () => 3,
  useVideoSeekStepSeconds: () => 10
}))
vi.mock('swiper/react', () => ({
  Swiper: ({ children, onSwiper }: { children: ReactNode; onSwiper: (swiper: SwiperType) => void }) => {
    useEffect(() => onSwiper(swiper as unknown as SwiperType), [onSwiper])
    return <div>{children}</div>
  },
  SwiperSlide: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))
vi.mock('../image-overlay', () => ({
  default: ({ mediaControls }: { mediaControls: ReactNode }) => mediaControls
}))
vi.mock('../viewer-video-controls', () => ({
  default: ({ zoom, onZoomChange }: ComponentProps<typeof ViewerVideoControls>) => (
    <VideoZoomButton zoom={zoom} onZoomChange={onZoomChange} />
  )
}))

const image: RandomImageItem = {
  id: 1,
  key: 'artwork-1',
  title: 'Video',
  imageUrl: '/1.mp4',
  mediaType: MediaType.VIDEO,
  images: [1, 2].map((id) => ({
    id,
    key: `video-${id}`,
    url: `/${id}.mp4`,
    updatedAt: '2026-10-24',
    mediaType: MediaType.VIDEO,
    animationMetadata: null
  })),
  author: null,
  createdAt: '2026-10-24',
  tags: [],
  isLike: false,
  ratingLevel: null
}
const props: ComponentProps<typeof ImageSlide> = {
  image,
  isActive: true,
  preloadEntryMedia: false,
  playbackRate: 1,
  onPlaybackRateChange: vi.fn(),
  audioPreference: { muted: true, volume: 1 },
  onAudioPreferenceChange: vi.fn(),
  chapterPanelOpen: false,
  onChapterPanelOpenChange: vi.fn(),
  onActiveMediaSettled: vi.fn(),
  onToggleChrome: vi.fn(),
  getPlaybackPosition: () => 0,
  onPlaybackPositionChange: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const id = /media\/(\d+)\//.exec(url)?.[1] ?? '1'
      return Promise.resolve(
        Response.json({
          status: 'READY',
          originalUrl: `/api/v1/media/${id}/playback?original=${'a'.repeat(24)}`,
          playbackUrl: null
        })
      )
    })
  )

  useViewerStore.setState({ horizontalIndexes: {}, isChromeHidden: false })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('viewer zoom ownership', () => {
  it('preserves zoom when hiding chrome but resets across horizontal media and inactive artworks', async () => {
    const view = render(<ImageSlide {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '画面缩放：完整画面' }))
    expect(view.container.querySelector('video')!.style.scale).toBe('1.5')
    act(() => useViewerStore.setState({ isChromeHidden: true }))
    expect(screen.getByRole('button', { name: '画面缩放：1.5倍' })).toBeTruthy()
    act(() => useViewerStore.getState().setHorizontalIndex(image.key, 1))
    expect(screen.getByRole('button', { name: '画面缩放：完整画面' })).toBeTruthy()
    await waitFor(() => expect(view.container.querySelector('video[src^="/api/v1/media/2/playback"]')).toBeTruthy())
    const activeVideo = view.container.querySelector('video[src^="/api/v1/media/2/playback"]') as HTMLVideoElement
    expect(activeVideo.style.scale).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '画面缩放：完整画面' }))
    expect(activeVideo.style.scale).toBe('1.5')
    view.rerender(<ImageSlide {...props} isActive={false} />)
    view.rerender(<ImageSlide {...props} />)
    expect(screen.getByRole('button', { name: '画面缩放：完整画面' })).toBeTruthy()
    await waitFor(() =>
      expect(view.container.querySelector('video[src^="/api/v1/media/2/playback"]')?.getAttribute('style')).toBe(
        'scale: 1;'
      )
    )
  })
})
