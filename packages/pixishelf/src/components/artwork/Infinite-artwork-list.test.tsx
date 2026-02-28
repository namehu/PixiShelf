import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import InfiniteArtworkList from './Infinite-artwork-list'
import { useInView } from 'react-intersection-observer'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { useColumns } from '@/hooks/use-columns'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

// Mock dependencies
vi.mock('react-intersection-observer')
vi.mock('@tanstack/react-query')
vi.mock('@/lib/trpc')
vi.mock('@/hooks/use-columns', () => ({
  useColumns: vi.fn()
}))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: vi.fn()
}))

// Mock UI components
vi.mock('@/components/artwork/ArtworkCard', () => ({
  default: () => <div data-testid="artwork-card">Card</div>
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>
}))
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}))

// Mock ResizeObserver
const mockResizeObserver = vi.fn(function (this: any, callback: any) {
  this.observe = vi.fn((element) => {
    // Immediately trigger with a width
    callback([{ contentRect: { width: 1000 } }])
  })
  this.disconnect = vi.fn()
  this.unobserve = vi.fn()
})

vi.stubGlobal('ResizeObserver', mockResizeObserver)

describe('InfiniteArtworkList', () => {
  const fetchNextPageMock = vi.fn().mockResolvedValue({})
  const infiniteQueryOptionsMock = vi.fn()
  let inViewFlag = false

  beforeEach(() => {
    vi.clearAllMocks()
    fetchNextPageMock.mockResolvedValue({})
    inViewFlag = false

    // Default mocks
    ;(useInView as any).mockReturnValue({
      ref: vi.fn(),
      inView: inViewFlag
    })
    ;(useColumns as any).mockReturnValue(4)
    ;(useWindowVirtualizer as any).mockReturnValue({
      getTotalSize: () => 1000,
      getVirtualItems: () => [],
      options: { scrollMargin: 0 }
    })
    ;(useTRPC as any).mockReturnValue({
      artwork: {
        list: {
          infiniteQueryOptions: infiniteQueryOptionsMock
        }
      }
    })

    // Default infinite query mock
    ;(useInfiniteQuery as any).mockReturnValue({
      data: { pages: [] },
      fetchNextPage: fetchNextPageMock,
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false
    })

    infiniteQueryOptionsMock.mockReturnValue({})
  })

  it('should not trigger fetchNextPage when not in view', () => {
    render(<InfiniteArtworkList />)
    expect(fetchNextPageMock).not.toHaveBeenCalled()
  })

  it('should trigger fetchNextPage when in view and has next page', async () => {
    ;(useInView as any).mockReturnValue({
      ref: vi.fn(),
      inView: true
    })
    ;(useInfiniteQuery as any).mockReturnValue({
      data: { pages: [{ items: [{ id: 1 }] }] },
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false
    })

    render(<InfiniteArtworkList />)

    await waitFor(() => {
      expect(fetchNextPageMock).toHaveBeenCalledTimes(1)
    })
  })

  it('should not trigger duplicate fetchNextPage if re-rendered while request is in progress', async () => {
    // Setup: inView is true, hasNextPage is true
    inViewFlag = true
    ;(useInView as any).mockReturnValue({
      ref: vi.fn(),
      inView: inViewFlag
    })
    ;(useInfiniteQuery as any).mockReturnValue({
      data: { pages: [{ items: [{ id: 1 }] }] },
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: false, // Still false!
      isLoading: false,
      isError: false
    })

    const { rerender } = render(<InfiniteArtworkList />)

    // First render should trigger fetch
    expect(fetchNextPageMock).toHaveBeenCalledTimes(1)

    inViewFlag = false
    ;(useInView as any).mockReturnValue({
      ref: vi.fn(),
      inView: inViewFlag
    })
    inViewFlag = true
    const newFetchNextPage = vi.fn().mockResolvedValue({})
    ;(useInfiniteQuery as any).mockReturnValue({
      data: { pages: [{ items: [{ id: 1 }] }] },
      fetchNextPage: newFetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false, // Still false!
      isLoading: false,
      isError: false
    })

    rerender(<InfiniteArtworkList searchQuery="new" />)

    expect(newFetchNextPage).not.toHaveBeenCalled()
  })
})
