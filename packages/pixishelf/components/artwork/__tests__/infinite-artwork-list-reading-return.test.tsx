import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkList from '../infinite-artwork-list'

const state = vi.hoisted(() => ({
  owner: 'alice',
  inView: false,
  query: vi.fn(),
  summaries: new Map<number, { status: string }>()
}))
vi.mock('@/lib/trpc', () => ({ useTRPCClient: () => ({ artwork: { cardList: { query: state.query } } }) }))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: state.owner }) }))
vi.mock('@/lib/reading/reading-provider', () => ({ useReadingSummaries: () => ({ byArtworkId: state.summaries }) }))
vi.mock('@/components/user-setting', () => ({ useArtworkDisplayMode: () => 'card' }))
vi.mock('@/hooks/use-columns', () => ({ useColumns: () => 1 }))
vi.mock('react-intersection-observer', () => ({ useInView: () => ({ ref: () => {}, inView: state.inView }) }))
vi.mock('../artwork-card', () => ({
  default: ({ artwork, reading }: { artwork: { id: number }; reading?: { status: string } }) =>
    <div data-testid="card">{artwork.id}:{reading?.status ?? 'UNREAD'}</div>
}))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: ({ count }: { count: number }) => ({
    measure: () => {}, measureElement: () => {}, getTotalSize: () => count * 100,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 100 })),
    options: { scrollMargin: 0 }
  })
}))

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  state.owner = 'alice'
  state.inView = false
  state.summaries.clear()
  state.query.mockReset()
  sessionStorage.clear()
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    disconnect() {}
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function list(generation = 123) {
  return <QueryClientProvider client={client}>
    <InfiniteArtworkList readingStatus="UNREAD" queryGeneration={generation} />
  </QueryClientProvider>
}
const cards = () => screen.queryAllByTestId('card').map((card) => card.textContent)

describe('reading-filter list return', () => {
  it('preserves pages, order, updated badges and scroll after a long read, then reapplies explicitly', async () => {
    state.query.mockResolvedValueOnce({ items: [{ id: 7 }, { id: 8 }], nextReadingCursor: 'page-2' })
      .mockResolvedValueOnce({ items: [{ id: 9 }], nextReadingCursor: null })
    const view = render(list())
    await waitFor(() => expect(cards()).toEqual(['7:UNREAD', '8:UNREAD']))
    state.inView = true
    view.rerender(list())
    await waitFor(() => expect(cards()).toEqual(['7:UNREAD', '8:UNREAD', '9:UNREAD']))
    expect(state.query.mock.calls[1]?.[0]).toMatchObject({ readingCursor: 'page-2', expectedUserId: 'alice' })

    vi.stubGlobal('scrollY', 480)
    fireEvent.scroll(window)
    await waitFor(() => expect(Object.values(sessionStorage)).toContain('480'))
    vi.useFakeTimers()
    view.unmount()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    vi.useRealTimers()
    state.inView = false
    state.summaries.set(7, { status: 'COMPLETED' })
    state.query.mockResolvedValue({ items: [{ id: 8 }, { id: 9 }], nextReadingCursor: null })
    vi.mocked(window.scrollTo).mockClear()
    const returned = render(list())
    await waitFor(() => expect(cards()).toEqual(['7:COMPLETED', '8:UNREAD', '9:UNREAD']))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 480)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    expect(state.query).toHaveBeenCalledTimes(2)

    vi.mocked(window.scrollTo).mockClear()
    returned.rerender(list(456))
    await waitFor(() => expect(cards()).toEqual(['8:UNREAD', '9:UNREAD']))
    expect(state.query).toHaveBeenCalledTimes(3)
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 480)
  })

  it('does not reuse another account or filter result and reloads with a fresh client', async () => {
    state.query.mockImplementation(async ({ expectedUserId, readingStatus }) => ({
      items: [{ id: expectedUserId === 'bob' ? 20 : readingStatus === 'COMPLETED' ? 30 : 7 }], nextReadingCursor: null
    }))
    const view = render(list())
    await waitFor(() => expect(cards()).toEqual(['7:UNREAD']))
    state.owner = 'bob'
    view.rerender(list())
    await waitFor(() => expect(cards()).toEqual(['20:UNREAD']))
    state.owner = 'alice'
    view.rerender(<QueryClientProvider client={client}>
      <InfiniteArtworkList readingStatus="COMPLETED" queryGeneration={123} />
    </QueryClientProvider>)
    await waitFor(() => expect(cards()).toEqual(['30:UNREAD']))
    view.unmount()
    client.clear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    state.query.mockResolvedValue({ items: [], nextReadingCursor: null })
    render(list())
    await screen.findByText('没有找到相关作品')
    expect(cards()).toEqual([])
    expect(state.query).toHaveBeenCalledTimes(4)
  })
})
