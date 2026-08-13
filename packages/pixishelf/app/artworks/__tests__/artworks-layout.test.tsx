import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GalleryPage layout', () => {
  it('aligns the toolbar, filter summary, and main content to the gallery axis', () => {
    const { container } = render(<GalleryPage />)
    const pageContainers = container.querySelectorAll('[data-slot="page-container"]')

    expect(pageContainers).toHaveLength(3)
    pageContainers.forEach((pageContainer) => {
      expect(pageContainer.className).toContain('max-w-gallery')
    })
    expect(screen.getByRole('main').getAttribute('data-slot')).toBe('page-container')
  })
})
