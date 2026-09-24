import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkList from '../infinite-artwork-list'
import { ESource } from '@/enums/e-source'

const { useInfiniteQueryMock, cardListQuery } = vi.hoisted(() => ({ cardListQuery: vi.fn(), useInfiniteQueryMock: vi.fn(() => ({
  data: { pages: [] },
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isLoading: false,
  isError: false
})) }))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false })
}))
vi.mock('@tanstack/react-query', () => ({
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
  })

  it('passes selected artwork sources to the list query', () => {
    const sources = [ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT]

    render(<InfiniteArtworkList sources={sources} />)

    expect(useInfiniteQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['artwork', 'cardList', 'alice', expect.objectContaining({ sources })]
    }))
  })

  it('passes the selected audio filter to the list query', () => {
    render(<InfiniteArtworkList hasAudio="no" />)

    expect(useInfiniteQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['artwork', 'cardList', 'alice', expect.objectContaining({ hasAudio: 'no' })]
    }))
  })

  it('uses reading cursor and account precondition for filtered continuation', async () => {
    render(<InfiniteArtworkList readingStatus="UNREAD" />)
    const options = (useInfiniteQueryMock.mock.calls.at(-1) as unknown as [{
      queryFn: (args: { pageParam: string; signal: AbortSignal }) => Promise<unknown>
      getNextPageParam: (page: { nextReadingCursor: string }) => string | undefined
    }])[0]
    expect(options.getNextPageParam({ nextReadingCursor: 'next-token' })).toBe('next-token')
    await options.queryFn({ pageParam: 'next-token', signal: new AbortController().signal })
    expect(cardListQuery).toHaveBeenCalledWith(expect.objectContaining({
      readingStatus: 'UNREAD', readingCursor: 'next-token', expectedUserId: 'alice'
    }), expect.any(Object))
  })
})
