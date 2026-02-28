import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfiniteArtworkList from '@/components/artwork/Infinite-artwork-list'
import { useInView } from 'react-intersection-observer'
import { useTRPC } from '@/lib/trpc'
import { useColumns } from '@/hooks/use-columns'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

vi.mock('react-intersection-observer')
vi.mock('@/lib/trpc')
vi.mock('@/hooks/use-columns', () => ({
  useColumns: vi.fn()
}))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: vi.fn()
}))
vi.mock('@/components/artwork/ArtworkCard', () => ({
  default: () => <div data-testid="artwork-card">Card</div>
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>
}))
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}))

const mockResizeObserver = vi.fn(function (this: any, callback: any) {
  this.observe = vi.fn(() => {
    callback([{ contentRect: { width: 1000 } }])
  })
  this.disconnect = vi.fn()
  this.unobserve = vi.fn()
})

vi.stubGlobal('ResizeObserver', mockResizeObserver)

describe('InfiniteArtworkList e2e', () => {
  it('should only request one extra page per inView entry', async () => {
    let inViewFlag = false
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

    const fetcher = vi.fn(async ({ pageParam }: { pageParam: number }) => {
      return {
        items: [{ id: pageParam }],
        nextCursor: pageParam + 1,
        total: 100
      }
    })

    ;(useTRPC as any).mockReturnValue({
      artwork: {
        list: {
          infiniteQueryOptions: (_input: any, options: any) => ({
            queryKey: ['artwork.list', _input],
            queryFn: ({ pageParam = options.initialCursor }) => fetcher({ pageParam }),
            getNextPageParam: options.getNextPageParam,
            initialPageParam: options.initialCursor
          })
        }
      }
    })

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <InfiniteArtworkList />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    inViewFlag = true
    ;(useInView as any).mockReturnValue({
      ref: vi.fn(),
      inView: inViewFlag
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <InfiniteArtworkList />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <InfiniteArtworkList />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  })
})
