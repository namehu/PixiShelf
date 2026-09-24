import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ReadingHistoryPage from '../page'

const { useInfiniteQueryMock, historyQuery } = vi.hoisted(() => ({
  useInfiniteQueryMock: vi.fn(),
  historyQuery: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({ useInfiniteQuery: useInfiniteQueryMock }))
vi.mock('@/components/auth', () => ({ useAuthUser: () => ({ id: 'alice' }) }))
vi.mock('@/lib/trpc', () => ({ useTRPCClient: () => ({ reading: { history: { query: historyQuery } } }) }))
vi.mock('@/components/artwork/artwork-card', () => ({
  default: ({ artwork }: { artwork: { title: string } }) => <div>{artwork.title}</div>
}))
vi.mock('@/components/layout/page-toolbar', () => ({ default: () => <div>最近阅读</div> }))

describe('reading history', () => {
  it('renders aggregated artworks and keeps its cursor query under the current account', async () => {
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [{
        artwork: { id: 7, title: '已读作品' },
        reading: { viewCount: 2, lastViewedAt: '2026-09-24T00:00:00.000Z' }
      }] }] },
      isError: false,
      isLoading: false,
      hasNextPage: false
    })
    render(<ReadingHistoryPage />)
    expect(screen.getByText('已读作品')).toBeTruthy()
    expect(screen.getByText('阅读 2 次')).toBeTruthy()
    const options = useInfiniteQueryMock.mock.calls[0]?.[0] as {
      queryKey: unknown[]
      queryFn: (args: { pageParam: { lastViewedAt: string; artworkId: number }; signal: AbortSignal }) => Promise<unknown>
    }
    expect(options.queryKey).toEqual(['reading', 'history', 'alice'])
    const cursor = { lastViewedAt: '2026-09-24T00:00:00.000Z', artworkId: 7 }
    await options.queryFn({ pageParam: cursor, signal: new AbortController().signal })
    expect(historyQuery).toHaveBeenCalledWith({ expectedUserId: 'alice', pageSize: 24, cursor }, expect.any(Object))
  })
})
