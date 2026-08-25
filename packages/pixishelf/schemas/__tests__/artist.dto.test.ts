import { describe, expect, it } from 'vitest'
import { ArtistResponseDto } from '../artist.dto'

const baseArtist = {
  id: 7,
  name: 'Main Name',
  username: 'main-name',
  userId: '123',
  bio: null,
  createdAt: new Date('2026-08-25T00:00:00.000Z'),
  updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  avatar: 'avatar.jpg',
  backgroundImg: null,
  isStarred: false
}

describe('ArtistResponseDto source identity', () => {
  it('does not expose a numeric legacy userId as a confirmed Pixiv identity', () => {
    const artist = ArtistResponseDto.parse(baseArtist)

    expect(artist.pixivUserId).toBeNull()
    expect(artist.pixivEligible).toBe(false)
    expect(artist.avatar).toBe('')
    expect(artist.sources).toEqual([{ type: 'MANUAL', providerKey: 'manual', externalId: '', sourceName: null }])
  })

  it('uses the formal Pixiv identity for image paths and synchronization state', () => {
    const artist = ArtistResponseDto.parse({
      ...baseArtist,
      externalRefs: [
        {
          id: 'ref-1',
          providerKey: 'pixiv',
          externalId: '456',
          sourceName: 'Pixiv Name',
          status: 'SUCCESS',
          lastAttemptAt: new Date('2026-08-25T01:00:00.000Z'),
          lastSuccessAt: new Date('2026-08-25T01:00:00.000Z'),
          lastErrorCode: null,
          lastError: null,
          lastSystemJobId: 'job-1'
        }
      ]
    })

    expect(artist.pixivUserId).toBe('456')
    expect(artist.avatar).toBe('/api/pixiv-data/artists/456/avatar.jpg')
    expect(artist.pixivSync).toMatchObject({ status: 'SUCCESS', sourceName: 'Pixiv Name' })
  })

  it('reports local and Pixiv sources together', () => {
    const artist = ArtistResponseDto.parse({
      ...baseArtist,
      externalRefs: [
        {
          id: 'ref-1',
          providerKey: 'pixiv',
          externalId: '456',
          sourceName: null,
          status: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          lastError: null,
          lastSystemJobId: null
        }
      ],
      localImportMappings: [{ id: 9 }]
    })

    expect(artist.sources.map((source) => source.type)).toEqual(['PIXIV', 'LOCAL'])
  })
})
