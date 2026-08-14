import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TagExplorer from '../tag-explorer'

const mocks = vi.hoisted(() => ({
  queryResult: {
    data: { pages: [{ items: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isRefetching: false,
    isError: false,
    refetch: vi.fn()
  }
}))

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => mocks.queryResult,
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    tag: {
      list: {
        infiniteQueryOptions: () => ({}),
        queryKey: () => ['tag', 'list']
      }
    }
  })
}))

vi.mock('../tag-universe-view', () => ({ TagUniverseView: () => <div>标签流不应出现</div> }))

beforeEach(() => {
  mocks.queryResult.isError = false
  mocks.queryResult.refetch.mockReset()
})

afterEach(cleanup)

describe('TagExplorer states', () => {
  it('renders a recoverable shared error state', () => {
    mocks.queryResult.isError = true
    render(<TagExplorer />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '标签加载失败' })).toBeTruthy()
    expect(screen.queryByText('标签流不应出现')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.queryResult.refetch).toHaveBeenCalledTimes(1)
  })

  it('renders the shared empty state for a successful empty collection', () => {
    render(<TagExplorer />)

    expect(screen.getByRole('heading', { level: 2, name: '暂无标签' })).toBeTruthy()
    expect(screen.queryByText('标签流不应出现')).toBeNull()
  })
})
