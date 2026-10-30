import { describe, expect, it } from 'vitest'
import { ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema } from '../artwork.dto'
import { artworkQuerySnapshotSchema, quickFilterAccountSchema } from '../artwork-quick-filter.dto'
import { resolveRatingLevels } from '../artwork-filter.dto'
import { queryToSnapshot, snapshotHref } from '@/lib/artwork-query-snapshot'

describe('enhanced artwork filter boundaries', () => {
  it.each([ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema])(
    'normalizes IDs and exact levels at API input',
    (schema) => {
      expect(schema.parse({ ratingLevels: '4,2,4', excludeArtistIds: '17,3,17' })).toMatchObject({
        ratingLevels: [2, 4],
        excludeArtistIds: [3, 17]
      })
      expect(resolveRatingLevels(schema.parse({ likedOnly: true }))).toEqual([2, 3, 4])
      expect(resolveRatingLevels(schema.parse({ likedOnly: true, ratingLevels: [] }))).toEqual([])
      expect(resolveRatingLevels(schema.parse({ likedOnly: true, ratingLevels: [3] }))).toEqual([3])
      for (const ratingLevels of [[1], [0], [5], ['2'], '2,bad'])
        {expect(schema.safeParse({ ratingLevels }).success).toBe(false)}
      for (const excludeArtistIds of [[0], [-1], [1.5], '1,bad'])
        {expect(schema.safeParse({ excludeArtistIds }).success).toBe(false)}
    }
  )
  it('upgrades old presets and URL links without losing explicit empty or exact selections', () => {
    expect(artworkQuerySnapshotSchema.parse({ likedOnly: true }).ratingLevels).toEqual([2, 3, 4])
    expect(queryToSnapshot(new URLSearchParams('likedOnly=true')).ratingLevels).toEqual([2, 3, 4])
    expect(queryToSnapshot(new URLSearchParams('likedOnly=true&ratingLevels=')).ratingLevels).toEqual([])
    const query = artworkQuerySnapshotSchema.parse({
      likedOnly: true,
      ratingLevels: [4],
      excludedArtists: [
        { value: '9', label: 'A,B% 中文' },
        { value: '2', label: 'B' },
        { value: '9', label: 'A,B% 中文' }
      ]
    })
    expect(query.excludedArtists.map((artist) => artist.value)).toEqual(['2', '9'])
    expect(queryToSnapshot(new URL(snapshotHref(query), 'http://localhost').searchParams)).toEqual(query)
  })
  it('defaults legacy preset API calls to global and validates artist scope', () => {
    expect(quickFilterAccountSchema.parse({ expectedUserId: 'a' }).scope).toEqual({ kind: 'global' })
    expect(quickFilterAccountSchema.safeParse({ expectedUserId: 'a', scope: { kind: 'artist' } }).success).toBe(false)
    expect(
      quickFilterAccountSchema.safeParse({ expectedUserId: 'a', scope: { kind: 'artist', artistId: -1 } }).success
    ).toBe(false)
  })
})
