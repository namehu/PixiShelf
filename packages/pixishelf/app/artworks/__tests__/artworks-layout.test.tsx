import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GalleryPage from '../page'
import type { FilterSheetProps } from '@/components/artwork/filter-sheet'

const { queryState } = vi.hoisted(() => ({
  queryState: {
    search: '',
    sortBy: 'source_date_desc',
    randomSeed: '',
    mediaType: 'all',
    mediaKinds: null as string | null,
    startDate: '',
    endDate: '',
    createdStartDate: '',
    createdEndDate: '',
    artistId: null,
    artistLabel: '',
    tags: '',
    tagLabels: '',
    sources: '',
    hasAudio: 'all',
    readingStatus: 'all',
    readingStatuses: null as string | null,
    likedOnly: false,
    ratingLevels: null as string | null,
    excludeArtistIds: '',
    excludeArtistLabels: '',
    listRevision: 0
  }
}))

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  setQuery: vi.fn(),
  sheet: null as FilterSheetProps | null
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => navigation.params }))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryStates: () => [queryState, navigation.setQuery]
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
  GalleryFilterSheet: (props: FilterSheetProps & { initialTab: string }) => {
    navigation.sheet = props
    return props.open ? <div data-testid="filter-sheet">{props.initialTab}</div> : null
  }
}))

vi.mock('@/components/artwork/infinite-artwork-list', () => ({
  default: ({ queryGeneration }: { queryGeneration: number }) => (
    <div data-testid="artworks-list" data-generation={queryGeneration}>
      作品列表
    </div>
  )
}))

beforeEach(() => {
  queryState.mediaType = 'all'
  queryState.mediaKinds = null
  queryState.readingStatus = 'all'
  queryState.readingStatuses = null
  queryState.search = ''
  queryState.likedOnly = false
  queryState.listRevision = 0
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

  it('passes favorites to immersive links and clears the active chip', () => {
    queryState.likedOnly = true
    render(<GalleryPage />)
    const href = screen.getByRole('link', { name: '沉浸浏览' }).getAttribute('href')!
    expect(new URL(href, 'http://localhost').searchParams.get('ratingLevels')).toBe('2,3,4')
    fireEvent.click(screen.getByRole('button', { name: '移除筛选：喜欢' }))
    expect(navigation.setQuery).toHaveBeenLastCalledWith({ likedOnly: null, ratingLevels: '3,4' })
    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    expect(navigation.setQuery).toHaveBeenLastCalledWith(expect.objectContaining({ likedOnly: null }))
  })

  it('passes normalized multi-selections into the shared sheet and immersive link and clears each legacy field', () => {
    queryState.mediaType = 'image'
    queryState.mediaKinds = 'video,animation,video'
    queryState.readingStatus = 'IN_PROGRESS'
    queryState.readingStatuses = 'COMPLETED,UNREAD,UNREAD'
    render(<GalleryPage />)
    expect(navigation.sheet).toMatchObject({
      currentMediaKinds: ['animation', 'video'],
      currentReadingStatuses: ['UNREAD', 'COMPLETED']
    })
    const href = new URL(screen.getByRole('link', { name: '沉浸浏览' }).getAttribute('href')!, 'http://localhost')
    expect(href.searchParams.get('mediaKinds')).toBe('animation,video')
    expect(href.searchParams.get('readingStatuses')).toBe('UNREAD,COMPLETED')
    expect(href.searchParams.has('mediaType')).toBe(false)
    expect(href.searchParams.has('readingStatus')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '移除筛选：阅读状态：未读' }))
    expect(navigation.setQuery).toHaveBeenLastCalledWith({ readingStatus: null, readingStatuses: 'COMPLETED' })
    fireEvent.click(screen.getByRole('button', { name: '移除筛选：动图' }))
    expect(navigation.setQuery).toHaveBeenLastCalledWith({ mediaType: null, mediaKinds: 'video' })
    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    expect(navigation.setQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaType: null, mediaKinds: '', readingStatus: null, readingStatuses: '' })
    )
  })
  it('keeps explicit empty URL selections ahead of legacy single filters', () => {
    queryState.mediaType = 'video'
    queryState.mediaKinds = ''
    queryState.readingStatus = 'COMPLETED'
    queryState.readingStatuses = ''
    render(<GalleryPage />)
    expect(navigation.sheet).toMatchObject({ currentMediaKinds: [], currentReadingStatuses: [] })
    expect(screen.queryByText('当前筛选')).toBeNull()
    const href = new URL(screen.getByRole('link', { name: '沉浸浏览' }).getAttribute('href')!, 'http://localhost')
    expect(href.searchParams.get('mediaKinds')).toBe('')
    expect(href.searchParams.get('readingStatuses')).toBe('')
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

  it('stores the applied generation in the URL and restores it when returning from reading', () => {
    navigation.params = new URLSearchParams('readingStatus=UNREAD&quickApply=once')
    window.history.replaceState(null, '', '/artworks?' + navigation.params.toString())
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const view = render(<GalleryPage />)
    const returnedParams = new URLSearchParams(window.location.search)
    expect(returnedParams.get('readingStatus')).toBe('UNREAD')
    expect(returnedParams.has('quickApply')).toBe(false)
    const generation = Number(returnedParams.get('listRevision'))
    expect(generation).toBeGreaterThan(0)
    expect(replaceState).toHaveBeenLastCalledWith(null, '', `/artworks?readingStatus=UNREAD&listRevision=${generation}`)
    replaceState.mockRestore()
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    view.unmount()
    navigation.params = returnedParams
    queryState.listRevision = generation
    vi.mocked(window.scrollTo).mockClear()
    render(<GalleryPage />)
    expect(Number(screen.getByTestId('artworks-list').getAttribute('data-generation'))).toBe(generation)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
