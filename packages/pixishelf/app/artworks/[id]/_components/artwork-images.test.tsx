import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import ArtworkImages, { buildMediaAnchorIndexes } from './artwork-images'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useUserSettingsStore } from '@/components/user-setting'

const virtualizerMocks = vi.hoisted(() => ({
  useWindowVirtualizer: vi.fn(),
  scrollToIndex: vi.fn(),
  measureElement: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: virtualizerMocks.useWindowVirtualizer
}))

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

vi.mock('./lazy-media', () => ({
  default: ({ media, index }: { media: { path: string }; index: number }) => (
    <div data-testid="lazy-media" data-src={media.path} data-index={index}>
      Image {index + 1}
    </div>
  )
}))

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

describe('ArtworkImages', () => {
  beforeEach(() => {
    vi.useRealTimers()
    virtualizerMocks.useWindowVirtualizer.mockImplementation(({ count }: { count: number }) => {
      const indexes =
        count <= 20 ? Array.from({ length: count }, (_, index) => index) : [0, 1, 2, 3, 4, Math.min(19, count - 1)]

      return {
        getTotalSize: () => count * 500,
        getVirtualItems: () =>
          indexes.map((index) => ({
            index,
            key: index,
            start: index * 500,
            size: 500
          })),
        measureElement: virtualizerMocks.measureElement,
        scrollToIndex: virtualizerMocks.scrollToIndex
      }
    })
    virtualizerMocks.useWindowVirtualizer.mockClear()
    virtualizerMocks.scrollToIndex.mockClear()
    virtualizerMocks.measureElement.mockClear()
    useUserSettingsStore.getState().hydrateSettings({ artwork_media_anchor_interval: 50 })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const generateImages = (count: number): ArtworkImageResponseDto[] =>
    Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      path: `/path/to/image-${i + 1}.jpg`,
      width: 1000,
      height: 1500,
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

  it('builds anchors from the first item through the last item without duplicates', () => {
    expect(buildMediaAnchorIndexes(120, 50)).toEqual([0, 49, 99, 119])
    expect(buildMediaAnchorIndexes(100, 50)).toEqual([0, 49, 99])
  })

  it('hides anchors when disabled or below twice the configured interval', () => {
    expect(buildMediaAnchorIndexes(500, 0)).toEqual([])
    expect(buildMediaAnchorIndexes(99, 50)).toEqual([])
  })

  it('renders all media when count is below the preview limit', () => {
    render(<ArtworkImages images={generateImages(19)} artworkId={1} />)

    expect(screen.getAllByTestId('lazy-media')).toHaveLength(19)
    expect(screen.queryByRole('button', { name: /查看剩余/i })).toBeNull()
  })

  it('renders the first 20 media and the expand button initially', () => {
    render(<ArtworkImages images={generateImages(25)} artworkId={1} />)

    expect(screen.getAllByTestId('lazy-media')).toHaveLength(20)
    expect(screen.getByRole('button', { name: /查看剩余\s*5\s*张图片/i })).toBeTruthy()
    expect(screen.getByTestId('artwork-images-container').getAttribute('data-expanded')).toBe('false')
  })

  it('expands the virtual list without mounting every remaining media item', async () => {
    render(<ArtworkImages images={generateImages(600)} artworkId={1} />)

    fireEvent.click(screen.getByRole('button', { name: /查看剩余\s*580\s*张图片/i }))

    await waitFor(() => {
      expect(screen.getByTestId('artwork-images-container').getAttribute('data-expanded')).toBe('true')
      expect(screen.getAllByTestId('lazy-media').length).toBeLessThanOrEqual(6)
    })
  })

  it('automatically expands and jumps when selecting an anchor after the preview range', async () => {
    render(<ArtworkImages images={generateImages(120)} artworkId={1} />)

    fireEvent.click(screen.getByRole('button', { name: '跳转到第 50 张媒体' }))

    await waitFor(() => {
      expect(screen.getByTestId('artwork-images-container').getAttribute('data-expanded')).toBe('true')
      expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(49, {
        align: 'start',
        behavior: 'auto'
      })
    })
  })

  it('opens and closes the mobile anchor panel explicitly', () => {
    render(<ArtworkImages images={generateImages(120)} artworkId={1} />)

    expect(screen.getAllByRole('navigation', { name: '作品媒体快捷导航' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '打开媒体快捷导航' }))

    const navigations = screen.getAllByRole('navigation', { name: '作品媒体快捷导航' })
    expect(navigations).toHaveLength(2)
    fireEvent.click(within(navigations[1]!).getByRole('button', { name: '跳转到第 50 张媒体' }))
    expect(screen.queryByRole('button', { name: '关闭媒体快捷导航' })).toBeNull()
  })

  it('does not show navigation when the setting is disabled', () => {
    useUserSettingsStore.getState().updateSettingLocally('artwork_media_anchor_interval', 0)
    render(<ArtworkImages images={generateImages(600)} artworkId={1} />)

    expect(screen.queryByRole('navigation', { name: '作品媒体快捷导航' })).toBeNull()
  })

  it('opens the full-size preview menu on image long press', () => {
    vi.useFakeTimers()
    render(<ArtworkImages images={generateImages(1)} artworkId={1} />)

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

  it('renders a single video through the thin media path without virtual list setup', () => {
    const images = generateImages(1).map((image) => ({
      ...image,
      path: '/path/to/video.mp4',
      mediaType: 'video' as const
    }))

    render(<ArtworkImages images={images} artworkId={1} />)

    expect(screen.getByTestId('artwork-video-container')).toBeTruthy()
    expect(screen.getByTestId('lazy-media').getAttribute('data-src')).toBe('/path/to/video.mp4')
    expect(screen.queryByTestId('artwork-images-container')).toBeNull()
    expect(virtualizerMocks.useWindowVirtualizer).not.toHaveBeenCalled()
  })
})
