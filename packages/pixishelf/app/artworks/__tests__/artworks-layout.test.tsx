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

vi.mock('@/components/artwork/filter-sheet', () => ({
  FilterSheet: () => null
}))

vi.mock('@/components/artwork/infinite-artwork-list', () => ({
  default: () => <div>作品列表</div>
}))

beforeEach(() => {
  queryState.search = ''
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
})
