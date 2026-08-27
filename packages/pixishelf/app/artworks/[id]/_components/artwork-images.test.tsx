import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import ArtworkImages, { buildMediaAnchorIndexes } from './artwork-images'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useUserSettingsStore } from '@/components/user-setting'
import { useArtworkStore } from '@/store/use-artwork-store'

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
let popoverOpenChange: ((open: boolean) => void) | undefined

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    open,
    onOpenChange
  }: {
    children: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    popoverOpen = !!open
    popoverOpenChange = onOpenChange
    return <div>{children}</div>
  },
  PopoverAnchor: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  PopoverTrigger: ({ children }: { children: React.ReactElement<{ onClick?: React.MouseEventHandler }> }) => {
    const open = popoverOpen
    const onOpenChange = popoverOpenChange
    return React.cloneElement(children, {
      onClick: (event) => {
        children.props.onClick?.(event)
        onOpenChange?.(!open)
      }
    })
  },
  PopoverContent: ({ children }: { children: React.ReactNode }) => (popoverOpen ? <div>{children}</div> : null)
}))

vi.mock('./lazy-media', () => ({
  default: ({ media, index }: { media: { path: string }; index: number }) => (
    <div data-testid="lazy-media" data-src={media.path} data-index={index}>
      Image {index + 1}
    </div>
  )
}))

vi.mock('./adaptive-media-preview', () => ({
  default: ({
    images,
    initialIndex,
    onClose
  }: {
    images: Array<{ path: string }>
    initialIndex: number
    onClose: (finalIndex: number) => void
  }) => (
    <div data-testid="adaptive-media-preview" data-initial-index={initialIndex} data-media-count={images.length}>
      <button type="button" onClick={() => onClose(initialIndex)}>
        关闭适配预览
      </button>
      <button type="button" onClick={() => onClose(24)}>
        关闭并返回第 25 张
      </button>
    </div>
  )
}))

vi.mock('./artwork-video-optimization-context', () => ({
  ArtworkVideoOptimizationProvider: ({ children }: { children: React.ReactNode }) => children
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
    useArtworkStore.getState().setCurrentIndex(0)
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

    fireEvent.click(screen.getByRole('button', { name: /打开媒体快捷导航/ }))
    fireEvent.click(screen.getByRole('button', { name: '跳转到第 50 张媒体' }))

    await waitFor(() => {
      expect(screen.getByTestId('artwork-images-container').getAttribute('data-expanded')).toBe('true')
      expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(49, {
        align: 'start',
        behavior: 'auto'
      })
    })
  })

  it('combines the three-digit media count with the bottom-right anchor trigger', () => {
    render(<ArtworkImages images={generateImages(120)} artworkId={1} />)

    expect(screen.queryByRole('navigation', { name: '作品媒体快捷导航' })).toBeNull()
    const trigger = screen.getByRole('button', { name: /打开媒体快捷导航，当前第 1 张，共 120 张/ })
    expect(trigger.textContent).toContain('1/120')
    expect(trigger.parentElement?.parentElement?.className).toContain('var(--app-mobile-navigation-offset)')
    fireEvent.click(trigger)

    const navigation = screen.getByRole('navigation', { name: '作品媒体快捷导航' })
    fireEvent.click(within(navigation).getByRole('button', { name: '跳转到第 50 张媒体' }))
    expect(screen.queryByRole('navigation', { name: '作品媒体快捷导航' })).toBeNull()
  })

  it('does not show navigation when the setting is disabled', () => {
    useUserSettingsStore.getState().updateSettingLocally('artwork_media_anchor_interval', 0)
    render(<ArtworkImages images={generateImages(600)} artworkId={1} />)

    expect(screen.queryByRole('navigation', { name: '作品媒体快捷导航' })).toBeNull()
    expect(screen.getByLabelText('当前第 1 张，共 600 张').textContent).toContain('1/600')
  })

  it('opens adaptive and original preview actions on image long press', () => {
    vi.useFakeTimers()
    render(<ArtworkImages images={generateImages(1)} artworkId={1} />)

    fireEvent.mouseDown(screen.getByTestId('lazy-media'))
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByText('适配尺寸预览')).toBeTruthy()
    expect(screen.getByText('查看原始文件')).toBeTruthy()
  })

  it('does not open the adaptive preview menu on video long press', () => {
    vi.useFakeTimers()
    const images = generateImages(1).map((image) => ({
      ...image,
      path: '/path/to/video.mp4',
      mediaType: 'video' as const
    }))
    render(<ArtworkImages images={images} artworkId={1} />)

    fireEvent.mouseDown(screen.getByTestId('lazy-media'))
    act(() => vi.advanceTimersByTime(500))

    expect(screen.queryByText('适配尺寸预览')).toBeNull()
    expect(screen.queryByText('查看原始文件')).toBeNull()
  })

  it('excludes videos when an image opens the adaptive preview', () => {
    const images = generateImages(3).map((image, index) =>
      index === 1 ? { ...image, path: '/path/to/video.mp4', mediaType: 'video' as const } : image
    )
    render(<ArtworkImages images={images} artworkId={1} />)

    const thirdMedia = screen.getAllByTestId('lazy-media')[2]!
    fireEvent.mouseDown(thirdMedia)
    fireEvent.mouseUp(thirdMedia)

    expect(screen.getByTestId('adaptive-media-preview').getAttribute('data-media-count')).toBe('2')
    expect(screen.getByTestId('adaptive-media-preview').getAttribute('data-initial-index')).toBe('1')
  })

  it('opens adaptive preview on a regular image click without opening the long-press menu', () => {
    render(<ArtworkImages images={generateImages(2)} artworkId={1} />)

    const firstMedia = screen.getAllByTestId('lazy-media')[0]!
    fireEvent.mouseDown(firstMedia)
    fireEvent.mouseUp(firstMedia)

    expect(screen.getByTestId('adaptive-media-preview').getAttribute('data-initial-index')).toBe('0')
    expect(screen.queryByText('查看原始文件')).toBeNull()
  })

  it('leaves WebP clicks to the animation player even when animation metadata is pending', () => {
    const images = generateImages(1).map((image) => ({
      ...image,
      path: '/path/to/animation.webp',
      isAnimated: undefined
    }))
    render(<ArtworkImages images={images} artworkId={1} />)

    const webpMedia = screen.getByTestId('lazy-media')
    fireEvent.mouseDown(webpMedia)
    fireEvent.mouseUp(webpMedia)
    fireEvent.click(webpMedia)

    expect(screen.queryByTestId('adaptive-media-preview')).toBeNull()
  })

  it('cancels both click preview and long press when the finger scrolls', () => {
    vi.useFakeTimers()
    render(<ArtworkImages images={generateImages(2)} artworkId={1} />)

    const firstMedia = screen.getAllByTestId('lazy-media')[0]!
    fireEvent.touchStart(firstMedia, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(firstMedia, { touches: [{ clientX: 10, clientY: 30 }] })
    act(() => vi.advanceTimersByTime(600))
    fireEvent.touchEnd(firstMedia)

    expect(screen.queryByTestId('adaptive-media-preview')).toBeNull()
    expect(screen.queryByText('适配尺寸预览')).toBeNull()
  })

  it('expands and restores the virtual list to the final previewed media', async () => {
    render(<ArtworkImages images={generateImages(25)} artworkId={1} />)

    const firstMedia = screen.getAllByTestId('lazy-media')[0]!
    fireEvent.mouseDown(firstMedia)
    fireEvent.mouseUp(firstMedia)
    fireEvent.click(screen.getByRole('button', { name: '关闭并返回第 25 张' }))

    await waitFor(() => {
      expect(screen.getByTestId('artwork-images-container').getAttribute('data-expanded')).toBe('true')
      expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(24, {
        align: 'start',
        behavior: 'auto'
      })
    })
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
