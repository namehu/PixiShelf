import { describe, expect, it } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '../artwork.dto'
import { ESource } from '@/enums/ESource'

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
