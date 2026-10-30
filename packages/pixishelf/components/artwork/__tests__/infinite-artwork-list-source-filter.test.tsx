import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkList from '../infinite-artwork-list'
import { ESource } from '@/enums/e-source'

const { useInfiniteQueryMock, cardListQuery, resetQueries } = vi.hoisted(() => ({ resetQueries: vi.fn(), cardListQuery: vi.fn(), useInfiniteQueryMock: vi.fn(() => ({
  data: { pages: [] },
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isLoading: false,
  isError: false,
  error: null as Error | null
})) }))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false })
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ resetQueries }),
  useInfiniteQuery: useInfiniteQueryMock
}))
vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({ artwork: { cardList: { query: cardListQuery } } })
}))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: 'alice' }) }))
vi.mock('@/lib/reading/reading-provider', () => ({ useReadingSummaries: () => ({ byArtworkId: new Map() }) }))
vi.mock('@/components/user-setting', () => ({ useArtworkDisplayMode: () => 'card' }))
vi.mock('@/hooks/use-columns', () => ({ useColumns: () => 4 }))
vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => ({
    measure: vi.fn(),
      measureElement: vi.fn(),
      getTotalSize: () => 0,
    getVirtualItems: () => [],
    options: { scrollMargin: 0 }
  })
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  }
)

describe('InfiniteArtworkList artwork sources', () => {
  beforeEach(() => {
    useInfiniteQueryMock.mockClear()
    cardListQuery.mockClear()
    resetQueries.mockClear()
  })

  it('passes selected artwork sources to the list query', () => {
    const sources = [ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT]

    render(<InfiniteArtworkList sources={sources} />)

    expect(useInfiniteQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['artwork', 'cardList', 'random-v1', 'alice', expect.objectContaining({ sources })]
    }))
  })

  it('passes the selected audio filter to the list query', () => {
    render(<InfiniteArtworkList hasAudio="no" />)

    expect(useInfiniteQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['artwork', 'cardList', 'random-v1', 'alice', expect.objectContaining({ hasAudio: 'no' })]
    }))
  })

  it('uses the random cursor ahead of reading pagination and preserves seed zero', async () => {
    render(<InfiniteArtworkList likedOnly readingStatuses={['UNREAD']} sortBy="random" randomSeed={0} />)
    const options = (useInfiniteQueryMock.mock.calls.at(-1) as unknown[])[0] as {
      queryFn: (ctx: { pageParam: string; signal: AbortSignal }) => Promise<unknown>
      getNextPageParam: (page: object) => string
    }
    await options.queryFn({ pageParam: 'ring-cursor', signal: new AbortController().signal })
    expect(cardListQuery).toHaveBeenCalledWith(expect.objectContaining({
      randomSeed: 0, randomCursor: 'ring-cursor', readingCursor: undefined, expectedUserId: 'alice', likedOnly: true
    }), expect.anything())
    expect(options.getNextPageParam({ nextRandomCursor: 'ring', nextReadingCursor: 'old' })).toBe('ring')
  })

  it('clears invalid random pages once instead of retrying or appending a new first page', async () => {
    const normal = useInfiniteQueryMock()
    useInfiniteQueryMock.mockReturnValue({ ...normal, error: new Error('ARTWORK_RANDOM_CURSOR_INVALID'), isError: true })
    const view = render(<InfiniteArtworkList sortBy="random" randomSeed={0} />)
    await waitFor(() => expect(resetQueries).toHaveBeenCalledOnce())
    view.rerender(<InfiniteArtworkList sortBy="random" randomSeed={0} />)
    expect(resetQueries).toHaveBeenCalledOnce()
    useInfiniteQueryMock.mockReturnValue(normal)
  })

  it.each([{ readingStatuses: ['UNREAD' as const] }, { likedOnly: true }])('uses keyset cursor and account precondition for filtered continuation: %o', async (filter) => {
    render(<InfiniteArtworkList {...filter} />)
    const options = (useInfiniteQueryMock.mock.calls.at(-1) as unknown as [{
      queryFn: (args: { pageParam: string; signal: AbortSignal }) => Promise<unknown>
      getNextPageParam: (page: { nextReadingCursor: string }) => string | undefined
    }])[0]
    expect(options.getNextPageParam({ nextReadingCursor: 'next-token' })).toBe('next-token')
    await options.queryFn({ pageParam: 'next-token', signal: new AbortController().signal })
    expect(cardListQuery).toHaveBeenCalledWith(expect.objectContaining({
      ...filter, readingCursor: 'next-token', expectedUserId: 'alice'
    }), expect.any(Object))
  })
})
