import { describe, it, expect } from 'vitest'
import { buildArtistQuery } from '@/app/admin/artists/_components/utils'

describe('buildArtistQuery', () => {
  const defaultParams = { pageSize: 20, current: 1 }
  const defaultSearchState = {
    name: null,
    sortId: null,
    sortDesc: null,
    isStarred: null,
    page: 1,
    pageSize: 20
  }

  it('should return default query params', () => {
    const result = buildArtistQuery(defaultParams, defaultSearchState)
    expect(result).toEqual({
      cursor: 1,
      pageSize: 20,
      search: undefined,
      sortBy: 'name_asc',
      isStarred: undefined
    })
  })

  it('should handle search term', () => {
    const result = buildArtistQuery(defaultParams, { ...defaultSearchState, name: 'picasso' })
    expect(result.search).toBe('picasso')
  })

  it('should handle sort by name desc', () => {
    const result = buildArtistQuery(defaultParams, { ...defaultSearchState, sortId: 'name', sortDesc: 'true' })
    expect(result.sortBy).toBe('name_desc')
  })

  it('should handle sort by artworks count asc', () => {
    const result = buildArtistQuery(defaultParams, { ...defaultSearchState, sortId: 'artworksCount', sortDesc: 'false' })
    expect(result.sortBy).toBe('artworks_asc')
  })

  it('should handle isStarred filter', () => {
    const resultTrue = buildArtistQuery(defaultParams, { ...defaultSearchState, isStarred: 'true' })
    expect(resultTrue.isStarred).toBe(true)

    const resultFalse = buildArtistQuery(defaultParams, { ...defaultSearchState, isStarred: 'false' })
    expect(resultFalse.isStarred).toBe(false)

    const resultAll = buildArtistQuery(defaultParams, { ...defaultSearchState, isStarred: 'all' })
    expect(resultAll.isStarred).toBeUndefined()
  })
})
