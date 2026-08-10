import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkGrid from '../_components/infinite-artwork-grid'

const { artworkCardMock } = vi.hoisted(() => ({
  artworkCardMock: vi.fn(({ priority }: { priority?: boolean }) => (
    <div data-testid="artwork-card" data-priority={priority ? 'true' : 'false'} />
  ))
}))

vi.mock('@/components/artwork/artwork-card', () => ({
  default: artworkCardMock
}))
vi.mock('@/components/user-setting', () => ({ useArtworkDisplayMode: () => 'card' }))
vi.mock('@/hooks/use-columns', () => ({ useColumns: () => 1 }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ artwork: { queryRecommendPage: { infiniteQueryOptions: () => ({}) } } })
}))
vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false })
}))
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          items: [{ id: 1, title: 'cover', imageCount: 1, images: [], tags: [] }]
        }
      ]
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    status: 'success'
  })
}))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => ({
    getTotalSize: () => 500,
    getVirtualItems: () => [{ key: 'row-0', index: 0, size: 500, start: 0 }],
    options: { scrollMargin: 0 }
  })
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { width: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect() {}
  }
)

describe('dashboard infinite artwork grid', () => {
  beforeEach(() => {
    artworkCardMock.mockClear()
    sessionStorage.clear()
  })

  it('keeps recommended artwork covers lazy even when virtualized rows are mounted as overscan', () => {
    render(<InfiniteArtworkGrid initialData={{ items: [], total: 0, page: 1, pageSize: 20, nextCursor: 2 }} />)

    expect(screen.getByTestId('artwork-card').getAttribute('data-priority')).toBe('false')
    expect(artworkCardMock.mock.calls[0]?.[0]).not.toHaveProperty('priority')
  })
})
