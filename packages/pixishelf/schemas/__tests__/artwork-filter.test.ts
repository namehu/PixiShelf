import { describe, expect, it } from 'vitest'
import { ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema, RandomArtworksGetSchema } from '../artwork.dto'
import { artworkQuerySnapshotSchema, quickFilterAccountSchema } from '../artwork-quick-filter.dto'
import { resolveRatingLevels } from '../artwork-filter.dto'
import { describeSnapshot, queryToSnapshot, snapshotHref } from '@/lib/artwork-query-snapshot'

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
      for (const ratingLevels of [[1], [0], [5], ['2'], '2,bad']) {
        expect(schema.safeParse({ ratingLevels }).success).toBe(false)
      }
      for (const excludeArtistIds of [[0], [-1], [1.5], '1,bad']) {
        expect(schema.safeParse({ excludeArtistIds }).success).toBe(false)
      }
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
  it.each([ArtworksInfiniteQuerySchema, ViewerFeedQuerySchema, artworkQuerySnapshotSchema])(
    'normalizes multi-select API and preset input while preserving explicit empties',
    (schema) => {
      expect(
        schema.parse({ mediaKinds: 'video,image,video', readingStatuses: ['COMPLETED', 'UNREAD', 'UNREAD'] })
      ).toMatchObject({
        mediaKinds: ['image', 'video'],
        readingStatuses: ['UNREAD', 'COMPLETED']
      })
      expect(schema.parse({ mediaType: 'animation', readingStatus: 'IN_PROGRESS' })).toMatchObject({
        mediaKinds: ['animation'],
        readingStatuses: ['IN_PROGRESS']
      })
      for (const empty of [[], '']) {
        const query = schema.parse({
          mediaType: 'video',
          mediaKinds: empty,
          readingStatus: 'COMPLETED',
          readingStatuses: empty
        })
        expect(query).toMatchObject({ mediaKinds: [], readingStatuses: [] })
        expect(query).not.toHaveProperty('mediaType')
        expect(query).not.toHaveProperty('readingStatus')
      }
      expect(
        schema.parse({
          mediaKinds: ['video', 'animation', 'image'],
          readingStatuses: ['COMPLETED', 'UNREAD', 'IN_PROGRESS']
        })
      ).toMatchObject({
        mediaKinds: ['image', 'animation', 'video'],
        readingStatuses: ['UNREAD', 'IN_PROGRESS', 'COMPLETED']
      })
      for (const invalid of ['unknown', 'image,bad', ['image', 'bad'], [1], null]) {
        expect(schema.safeParse({ mediaKinds: invalid }).success).toBe(false)
        expect(schema.safeParse({ readingStatuses: invalid }).success).toBe(false)
      }
    }
  )
  it('keeps legacy random media input and extension filters independent of media kinds', () => {
    expect(RandomArtworksGetSchema.parse({ mediaType: 'animation' }).mediaKinds).toEqual(['animation'])
    expect(RandomArtworksGetSchema.parse({ mediaType: 'video', mediaKinds: '' }).mediaKinds).toEqual([])
    expect(ArtworksInfiniteQuerySchema.parse({ mediaTypes: '.jpg,.mp4', mediaKinds: 'animation' })).toMatchObject({
      mediaTypes: ['.jpg', '.mp4'],
      mediaKinds: ['animation']
    })
  })
  it('round trips multiple selections, clears legacy fields, and describes every selection', () => {
    const query = artworkQuerySnapshotSchema.parse({
      mediaKinds: ['video', 'animation'],
      readingStatuses: ['COMPLETED', 'UNREAD']
    })
    expect(describeSnapshot(query)).toContain('未读、已读完')
    expect(describeSnapshot(query)).toContain('动图、视频')
    const params = new URL(snapshotHref(query), 'http://localhost').searchParams
    expect(params.has('mediaType')).toBe(false)
    expect(params.has('readingStatus')).toBe(false)
    expect(queryToSnapshot(params)).toEqual(query)
    expect(
      queryToSnapshot(new URLSearchParams('mediaType=video&mediaKinds=&readingStatus=COMPLETED&readingStatuses='))
    ).toMatchObject({ mediaKinds: [], readingStatuses: [] })
    const emptyParams = new URL(snapshotHref(artworkQuerySnapshotSchema.parse({})), 'http://localhost').searchParams
    expect(emptyParams.has('mediaKinds')).toBe(true)
    expect(emptyParams.has('readingStatuses')).toBe(true)
  })
  it('defaults legacy preset API calls to global and validates artist scope', () => {
    expect(quickFilterAccountSchema.parse({ expectedUserId: 'a' }).scope).toEqual({ kind: 'global' })
    expect(quickFilterAccountSchema.safeParse({ expectedUserId: 'a', scope: { kind: 'artist' } }).success).toBe(false)
    expect(
      quickFilterAccountSchema.safeParse({ expectedUserId: 'a', scope: { kind: 'artist', artistId: -1 } }).success
    ).toBe(false)
  })
})
