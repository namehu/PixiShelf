import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore as store } from '@/store/use-artwork-auto-browse-store'
import AdaptiveMediaPreview from '../adaptive-media-preview'
import { ArtworkSummaryProvider } from '../artwork-summary-context'
import type { MediaIndex } from '@/schemas/artwork-reader.dto'

const reader = vi.hoisted(() => ({ index: undefined as MediaIndex | undefined }))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({
  useArtworkReader: () => ({
    initialization: reader.index ? { index: reader.index } : undefined,
    reading: { ownerUserId: 'alice' },
    invalidated: false
  }),
  useReaderMediaWindow: vi.fn()
}))
const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduced
}))

vi.mock('@/hooks/use-media-mark', () => ({
  usePrefetchMediaMarks: vi.fn(),
  useMediaMark: () => ({ available: false, isLoading: false, likedAt: null, set: vi.fn() })
}))
vi.mock('@/components/media-mark/media-mark-actions', () => ({
  MediaMarkActions: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))
vi.mock('next/image', () => ({
  default: ({ src, alt, onLoad }: { src: string; alt: string; onLoad: React.ReactEventHandler<HTMLImageElement> }) => (
    <img src={src} alt={alt} onLoad={onLoad} />
  )
}))

const images = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  artworkId: 1,
  path: `/${index}.png`,
  sortOrder: index,
  updatedAt: '2026-10-31',
  mediaType: 'image'
})) as ArtworkImageResponseDto[]

beforeEach(() => {
  reader.index = undefined
  motion.reduced = false
  vi.useFakeTimers()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(794)
  store.getState().initialize(1)
  store.getState().setPreferences({ slideSeconds: 0.2, loop: false })
  store.getState().setPreviewOpen(true)
  history.replaceState({}, '', '/')
})
afterEach(() => {
  cleanup()
  store.getState().release(store.getState().session)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('adaptive preview with real Swiper', () => {
  it.each([
    [false, 0],
    [false, 2],
    [true, 0],
    [true, 2]
  ] as const)(
    'keeps playback when the SSR batch expands (reduced motion: %s, start: %s)',
    async (reduced, initialIndex) => {
      motion.reduced = reduced
      store.getState().setCurrentMedia(images[initialIndex]!.id)
      const preview = (items: ArtworkImageResponseDto[]) => (
        <ArtworkSummaryProvider artworkId={1}>
          <AdaptiveMediaPreview images={items} initialIndex={initialIndex} open onClose={vi.fn()} />
        </ArtworkSummaryProvider>
      )
      const view = render(preview(images.slice(0, 24)))
      await act(async () => vi.advanceTimersByTimeAsync(100))
      for (const image of screen.getAllByRole('img')) fireEvent.load(image)
      fireEvent.click(screen.getByRole('button', { name: '开始或继续自动浏览' }))
      await act(async () => vi.advanceTimersByTimeAsync(200))
      for (const slide of document.querySelectorAll('.swiper-slide')) fireEvent.transitionEnd(slide)
      expect(document.querySelector('.swiper-slide-active')?.getAttribute('data-swiper-slide-index')).toBe(
        String(initialIndex + 1)
      )
      reader.index = {
        fingerprint: 'full-index',
        mediaRevision: 1,
        items: images.map((media, index) => ({
          mediaId: media.id,
          memberMediaIds: [media.id],
          index,
          width: 800,
          height: 1000,
          mediaType: 'image',
          isAnimated: false,
          reliableDimensions: true
        }))
      }
      view.rerender(preview(images))
      // Existing image elements do not fire a second load event when only the index grows.
      expect(store.getState().status).toBe('running')
      expect(screen.getByRole('button', { name: '自动浏览设置' }).textContent?.replace(/\s/g, '')).toBe(
        `${initialIndex + 2}/120`
      )
      await act(async () => vi.advanceTimersByTimeAsync(200))
      expect(document.querySelector('.swiper-slide-active')?.getAttribute('data-swiper-slide-index')).toBe(
        String(initialIndex + 2)
      )
    }
  )

  it.each([0, 2])('starts on image %i without a manual slide and advances to the end', async (initialIndex) => {
    store.getState().setCurrentMedia(images[initialIndex]!.id)
    render(<AdaptiveMediaPreview images={images.slice(0, 5)} initialIndex={initialIndex} open onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTimeAsync(100))
    for (const image of screen.getAllByRole('img')) fireEvent.load(image)
    fireEvent.click(screen.getByRole('button', { name: '开始或继续自动浏览' }))
    for (let index = initialIndex; index < 4; index++) {
      await act(async () => vi.advanceTimersByTimeAsync(200))
      expect(document.querySelector('.swiper-slide-active')?.getAttribute('data-swiper-slide-index')).toBe(
        String(index + 1)
      )
      for (const slide of document.querySelectorAll('.swiper-slide')) fireEvent.transitionEnd(slide)
      for (const image of screen.getAllByRole('img')) fireEvent.load(image)
    }
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(store.getState().status).toBe('ended')
  })
})
