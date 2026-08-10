import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LazyMedia from '../lazy-media'

vi.mock('@/components/players/video-player', () => ({
  default: ({ src }: { src: string }) => <div data-testid="video-player" data-src={src} />
}))
vi.mock('@/components/players/apng-player', () => ({ default: () => null }))
vi.mock('@/components/players/animated-webp-player', () => ({ default: () => null }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('react-intersection-observer', () => ({ useOnInView: () => vi.fn() }))
vi.mock('@/store/use-artwork-store', () => ({
  useArtworkStore: (selector: (state: { setCurrentIndex: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ setCurrentIndex: vi.fn() })
}))

describe('LazyMedia video cache version', () => {
  it('uses image updatedAt to version the immutable video URL', () => {
    render(
      <LazyMedia
        media={
          {
            id: 7,
            path: '/artist/work/video.mp4',
            updatedAt: '2026-08-10T10:20:30.000Z',
            width: 1920,
            height: 1080,
            size: 100,
            mediaType: 'video'
          } as any
        }
        index={0}
      />
    )

    expect(screen.getByTestId('video-player').getAttribute('data-src')).toBe(
      '/api/v1/images/artist%2Fwork%2Fvideo.mp4?v=2026-08-10T10%3A20%3A30.000Z'
    )
  })
})
