import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InfiniteArtworkList from '../Infinite-artwork-list'
import { ESource } from '@/enums/ESource'

const infiniteQueryOptions = vi.fn(() => ({}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false })
}))
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages: [] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false
  })
}))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ artwork: { list: { infiniteQueryOptions } } })
}))
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
  beforeEach(() => infiniteQueryOptions.mockClear())

  it('passes selected artwork sources to the list query', () => {
    const sources = [ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT]

    render(<InfiniteArtworkList sources={sources} />)

    expect(infiniteQueryOptions).toHaveBeenCalledWith(expect.objectContaining({ sources }), expect.any(Object))
  })

  it('passes the selected audio filter to the list query', () => {
    render(<InfiniteArtworkList hasAudio="no" />)

    expect(infiniteQueryOptions).toHaveBeenCalledWith(expect.objectContaining({ hasAudio: 'no' }), expect.any(Object))
  })
})
