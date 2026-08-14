import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import InfiniteArtworkList from './infinite-artwork-list'
import { useInView } from 'react-intersection-observer'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { useColumns } from '@/hooks/use-columns'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

// 模拟外部依赖。
vi.mock('react-intersection-observer')
vi.mock('@tanstack/react-query')
vi.mock('@/lib/trpc')
vi.mock('@/components/user-setting', () => ({
  useArtworkDisplayMode: vi.fn(() => 'card')
}))
vi.mock('@/hooks/use-columns', () => ({
  useColumns: vi.fn()
}))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: vi.fn()
}))

// 模拟界面组件。
vi.mock('@/components/artwork/artwork-card', () => ({
  default: () => <div data-testid="artwork-card">Card</div>
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>
}))
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}))

// 模拟 ResizeObserver。
const mockResizeObserver = vi.fn(function (this: any, callback: any) {
  this.observe = vi.fn(() => {
    // 立即以指定宽度触发观察回调。
    callback([{ contentRect: { width: 1000 } }])
  })
  this.disconnect = vi.fn()
  this.unobserve = vi.fn()
})

vi.stubGlobal('ResizeObserver', mockResizeObserver)
Object.defineProperty(window, 'scrollTo', {
  value: vi.fn(),
  writable: true
})

describe('InfiniteArtworkList', () => {
  const fetchNextPageMock = vi.fn().mockResolvedValue({})
  const infiniteQueryOptionsMock = vi.fn()
  let inViewFlag = false

  beforeEach(() => {
    vi.clearAllMocks()
    fetchNextPageMock.mockResolvedValue({})
    inViewFlag = false

    // 默认模拟行为。
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
        cardList: {
          infiniteQueryOptions: infiniteQueryOptionsMock
        }
      }
    })

    // 无限查询的默认模拟结果。
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
    // 前置条件：元素已进入视口，且存在下一页。
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

    // 首次渲染应触发下一页请求。
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
