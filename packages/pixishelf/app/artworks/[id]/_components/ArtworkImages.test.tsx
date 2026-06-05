import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import ArtworkImages from './ArtworkImages'
import React from 'react'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn()
  }))
}))

let popoverOpen = false

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open?: boolean }) => {
    popoverOpen = !!open
    return <div>{children}</div>
  },
  PopoverAnchor: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    popoverOpen ? <div {...props}>{children}</div> : null
}))

// Mock LazyMedia 组件
vi.mock('./LazyMedia', () => ({
  default: ({ media, index }: { media: { path: string }; index: number }) => (
    <div data-testid="lazy-media" data-src={media.path} data-index={index}>
      Image {index + 1}
    </div>
  )
}))

// Mock ResizeObserver for framer-motion if needed
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

describe('ArtworkImages', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const generateImages = (count: number): ArtworkImageResponseDto[] =>
    Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      path: `/path/to/image-${i + 1}.jpg`,
      width: null,
      height: null,
      size: null,
      sortOrder: i,
      artworkId: 1,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
      webpAnimationStatus: null,
      chaptersPath: null,
      chaptersCount: 0,
      chaptersDuration: null,
      chaptersUpdatedAt: null,
      chaptersHash: null,
      mediaType: 'image',
      hasChapters: false,
      chaptersUrl: null
    }))

  it('renders all images when count is <= 20', () => {
    const images = generateImages(19)
    render(<ArtworkImages images={images} artworkId={1} />)

    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(19)

    const button = screen.queryByRole('button', { name: /查看剩余/i })
    expect(button).toBeNull()
  })

  it('renders only first 20 images initially when count > 20', () => {
    const images = generateImages(21)
    render(<ArtworkImages images={images} artworkId={1} />)

    // 20张可见 + 1张预加载（hidden，因为剩余只有1张）
    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(21)

    const button = screen.getByRole('button', { name: /查看剩余\s*1\s*张图片/i })
    expect(button).toBeTruthy()
  })

  it('expands to show all images when button is clicked', async () => {
    const images = generateImages(21)
    render(<ArtworkImages images={images} artworkId={1} />)

    const button = screen.getByRole('button', { name: /查看剩余\s*1\s*张图片/i })
    fireEvent.click(button)

    // 展开后显示全部21张（预加载的2张变成可见）
    await waitFor(() => {
      const mediaItems = screen.getAllByTestId('lazy-media')
      expect(mediaItems).toHaveLength(21)
    })

    // Button should be gone
    const buttonAfterClick = screen.queryByRole('button', { name: /查看剩余/i })
    expect(buttonAfterClick).toBeNull()
  })

  it('preloads only 2 images when remaining count > 2', () => {
    const images = generateImages(25)
    render(<ArtworkImages images={images} artworkId={1} />)

    // 20张可见 + 2张预加载 = 22张
    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(22)

    const button = screen.getByRole('button', { name: /查看剩余\s*5\s*张图片/i })
    expect(button).toBeTruthy()
  })

  it('preloads exactly 2 images when remaining is exactly 2', () => {
    const images = generateImages(22)
    render(<ArtworkImages images={images} artworkId={1} />)

    // 20张可见 + 2张预加载 = 22张
    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(22)

    const button = screen.getByRole('button', { name: /查看剩余\s*2\s*张图片/i })
    expect(button).toBeTruthy()
  })

  it('preloads only 2 images when remaining is 3', () => {
    const images = generateImages(23)
    render(<ArtworkImages images={images} artworkId={1} />)

    // 20张可见 + 2张预加载 = 22张
    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(22)

    const button = screen.getByRole('button', { name: /查看剩余\s*3\s*张图片/i })
    expect(button).toBeTruthy()
  })

  it('expands correctly when remaining is exactly 2', async () => {
    const images = generateImages(22)
    render(<ArtworkImages images={images} artworkId={1} />)

    const button = screen.getByRole('button', { name: /查看剩余\s*2\s*张图片/i })
    fireEvent.click(button)

    await waitFor(() => {
      const mediaItems = screen.getAllByTestId('lazy-media')
      expect(mediaItems).toHaveLength(22)
    })
  })

  it('expands correctly when remaining is 3', async () => {
    const images = generateImages(23)
    render(<ArtworkImages images={images} artworkId={1} />)

    const button = screen.getByRole('button', { name: /查看剩余\s*3\s*张图片/i })
    fireEvent.click(button)

    await waitFor(() => {
      const mediaItems = screen.getAllByTestId('lazy-media')
      expect(mediaItems).toHaveLength(23)
    })
  })

  it('opens the full-size preview menu on image long press', () => {
    vi.useFakeTimers()
    const images = generateImages(1)
    render(<ArtworkImages images={images} artworkId={1} />)

    fireEvent.mouseDown(screen.getByTestId('lazy-media'))
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByText('预览完整尺寸')).toBeTruthy()
  })

  it('does not open the full-size preview menu on video long press', () => {
    vi.useFakeTimers()
    const images = generateImages(1).map((image) => ({
      ...image,
      path: '/path/to/video.mp4',
      mediaType: 'video' as const
    }))
    render(<ArtworkImages images={images} artworkId={1} />)

    fireEvent.mouseDown(screen.getByTestId('lazy-media'))
    act(() => vi.advanceTimersByTime(500))

    expect(screen.queryByText('预览完整尺寸')).toBeNull()
  })
})
