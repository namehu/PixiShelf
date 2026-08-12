import { describe, expect, it } from 'vitest'
import { ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema } from '../artwork.dto'
import { ESource } from '@/enums/e-source'

describe('ArtworksInfiniteQuerySchema sources', () => {
  it('parses comma-separated artwork sources', () => {
    const result = ArtworksInfiniteQuerySchema.parse({
      sources: `${ESource.LOCAL_CREATED},${ESource.LOCAL_IMPORT}`
    })

    expect(result.sources).toEqual([ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT])
  })

  it('parses an artwork source array', () => {
    const result = ArtworksInfiniteQuerySchema.parse({
      sources: [ESource.PIXIV_IMPORTED, ESource.LOCAL_CREATED]
    })

    expect(result.sources).toEqual([ESource.PIXIV_IMPORTED, ESource.LOCAL_CREATED])
  })

  it('normalizes missing and empty artwork sources to an empty array', () => {
    expect(ArtworksInfiniteQuerySchema.parse({}).sources).toEqual([])
    expect(ArtworksInfiniteQuerySchema.parse({ sources: '' }).sources).toEqual([])
  })

  it('rejects unknown artwork sources', () => {
    expect(() => ArtworksInfiniteQuerySchema.parse({ sources: 'UNKNOWN_SOURCE' })).toThrow()
  })
})

describe('ViewerFeedQuerySchema filters', () => {
  it('normalizes the complete viewer filter contract', () => {
    const result = ViewerFeedQuerySchema.parse({
      artistId: '7',
      tagIds: '3,4,3',
      sources: `${ESource.PIXIV_IMPORTED},${ESource.LOCAL_IMPORT}`,
      hasAudio: 'yes',
      mediaType: 'video',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      createdStartDate: '2026-01-01',
      createdEndDate: '2026-08-12'
    })

    expect(result).toMatchObject({
      artistId: 7,
      tagIds: [3, 4],
      sources: [ESource.PIXIV_IMPORTED, ESource.LOCAL_IMPORT],
      hasAudio: 'yes',
      mediaType: 'video',
      createdStartDate: '2026-01-01',
      createdEndDate: '2026-08-12'
    })
  })

  it('rejects invalid sources, audio states, and dates', () => {
    expect(() => ViewerFeedQuerySchema.parse({ sources: 'UNKNOWN' })).toThrow()
    expect(() => ViewerFeedQuerySchema.parse({ hasAudio: 'unknown' })).toThrow()
    expect(() => ViewerFeedQuerySchema.parse({ createdStartDate: '2026/01/01' })).toThrow()
  })
})
