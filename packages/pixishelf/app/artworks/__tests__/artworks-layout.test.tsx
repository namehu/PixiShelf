import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GalleryPage from '../page'

const { queryState } = vi.hoisted(() => ({
  queryState: {
    search: '',
    sortBy: 'source_date_desc',
    randomSeed: '',
    mediaType: 'all',
    startDate: '',
    endDate: '',
    createdStartDate: '',
    createdEndDate: '',
    artistId: null,
    artistLabel: '',
    tags: '',
    tagLabels: '',
    sources: '',
    hasAudio: 'all'
  }
}))

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => navigation.params }))

vi.mock('nuqs', () => {
  const parser = {
    withDefault: () => parser,
    withOptions: () => parser
  }

  return {
    createSerializer: () => () => '/viewer',
    parseAsInteger: parser,
    parseAsString: parser,
    useQueryStates: () => [queryState, vi.fn()]
  }
})

vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({
    artist: { queryPage: { query: vi.fn() } },
    tag: { list: { query: vi.fn() } }
  })
}))

vi.mock('../_components/search-box', () => ({
  SearchBox: () => <div>搜索作品</div>
}))

vi.mock('@/components/artwork/gallery-filter-sheet', () => ({
  GalleryFilterSheet: ({ open, initialTab }: { open: boolean; initialTab: string }) =>
    open ? <div data-testid="filter-sheet">{initialTab}</div> : null
}))

vi.mock('@/components/artwork/infinite-artwork-list', () => ({
  default: ({ queryGeneration }: { queryGeneration: number }) => (
    <div data-testid="artworks-list" data-generation={queryGeneration}>
      作品列表
    </div>
  )
}))

beforeEach(() => {
  queryState.search = ''
  navigation.params = new URLSearchParams()
  window.history.replaceState(null, '', '/artworks')
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GalleryPage layout', () => {
  it('aligns the toolbar and main content to the gallery axis without an empty filter rail', () => {
    const { container } = render(<GalleryPage />)
    const pageContainers = container.querySelectorAll('[data-slot="page-container"]')

    expect(pageContainers).toHaveLength(2)
    pageContainers.forEach((pageContainer) => {
      expect(pageContainer.className).toContain('max-w-gallery')
    })
    expect(screen.getByRole('main').getAttribute('data-slot')).toBe('page-container')
    expect(screen.getByRole('link', { name: '沉浸浏览' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '筛选作品' })).toBeTruthy()
  })

  it('adds an aligned filter rail when a filter is active', () => {
    queryState.search = '蓝色'
    const { container } = render(<GalleryPage />)
    const pageContainers = container.querySelectorAll('[data-slot="page-container"]')

    expect(pageContainers).toHaveLength(3)
    pageContainers.forEach((pageContainer) => {
      expect(pageContainer.className).toContain('max-w-gallery')
    })
    expect(screen.getByText('当前筛选')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除筛选：关键词：蓝色' })).toBeTruthy()
  })
  it('consumes committed management commands without losing the current query', () => {
    navigation.params = new URLSearchParams('search=keep&quickFilters=manage')
    window.history.replaceState(null, '', '/artworks?' + navigation.params.toString())
    render(<GalleryPage />)
    expect(screen.getByTestId('filter-sheet').textContent).toBe('saved')
    expect(window.location.search).toBe('?search=keep')
  })

  it('consumes apply commands and starts a new list generation at the top', () => {
    navigation.params = new URLSearchParams('readingStatus=UNREAD&quickApply=once')
    window.history.replaceState(null, '', '/artworks?' + navigation.params.toString())
    render(<GalleryPage />)
    expect(window.location.search).toBe('?readingStatus=UNREAD')
    expect(Number(screen.getByTestId('artworks-list').getAttribute('data-generation'))).toBeGreaterThan(0)
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })
})
