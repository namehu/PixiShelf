import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkGrid from '../_components/infinite-artwork-grid'

const { artworkCardMock, layout, measure, measureElement } = vi.hoisted(() => ({
  layout: { columns: 1, mode: 'card', empty: false },
  measure: vi.fn(),
  measureElement: vi.fn(),
  artworkCardMock: vi.fn(({ priority }: { priority?: boolean }) => (
    <div data-testid="artwork-card" data-priority={priority ? 'true' : 'false'} />
  ))
}))

vi.mock('@/components/artwork/artwork-card', () => ({
  default: artworkCardMock
}))
vi.mock('@/components/user-setting', () => ({ useArtworkDisplayMode: () => layout.mode }))
vi.mock('@/hooks/use-columns', () => ({ useColumns: () => layout.columns }))
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
          items: layout.empty ? [] : [{ id: 1, title: 'cover', imageCount: 1, images: [], tags: [] }]
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
    measure, measureElement,
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
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    layout.columns = 1
    layout.mode = 'card'
    layout.empty = false
    sessionStorage.clear()
  })

  it('keeps recommended artwork covers lazy even when virtualized rows are mounted as overscan', () => {
    render(<InfiniteArtworkGrid initialData={{ items: [], total: 0, page: 1, pageSize: 20, nextCursor: 2 }} />)

    expect(screen.getByTestId('artwork-card').getAttribute('data-priority')).toBe('false')
    expect(artworkCardMock.mock.calls[0]?.[0]).not.toHaveProperty('priority')
  })
  it('measures content instead of fixing row height and remeasures columns and display mode', () => {
    const props = { initialData: { items: [], total: 0, page: 1, pageSize: 20 } }
    const view = render(<InfiniteArtworkGrid {...props} />)
    const row = screen.getByTestId('artwork-card').parentElement!
    expect(row.style.height).toBe('')
    expect(measureElement).toHaveBeenCalledWith(row)
    let calls = measure.mock.calls.length
    layout.columns = 2
    view.rerender(<InfiniteArtworkGrid {...props} />)
    expect(measure.mock.calls.length).toBeGreaterThan(calls)
    expect(row.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    calls = measure.mock.calls.length
    layout.mode = 'minimal'
    view.rerender(<InfiniteArtworkGrid {...props} />)
    expect(measure.mock.calls.length).toBeGreaterThan(calls)
    expect(row.className).toContain('pb-[2px]')
  })

  it('observes the list again after an empty recommendation result', () => {
    const observe = vi.spyOn(ResizeObserver.prototype, 'observe')
    layout.empty = true
    const props = { initialData: { items: [], total: 0, page: 1, pageSize: 20 } }
    const view = render(<InfiniteArtworkGrid {...props} />)
    expect(observe).not.toHaveBeenCalled()
    layout.empty = false
    view.rerender(<InfiniteArtworkGrid {...props} />)
    expect(observe).toHaveBeenCalled()
    expect(screen.getByTestId('artwork-card')).toBeTruthy()
    observe.mockRestore()
  })

})
