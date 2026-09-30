import { describe, expect, it } from 'vitest'
import { resolveCanonicalArtworkStoragePath } from '../artwork-storage-path.js'

describe('canonical artwork storage path', () => {
  it('supports manual artworks without a primary artist', () => {
    expect(resolveCanonicalArtworkStoragePath({
      createdVia: 'MANUAL_CREATE', artistId: null, storageKey: 'e_83_1544954',
      artistPixivExternalId: null, artworkPixivExternalId: null
    })).toBe('local-imports/unassigned/e_83_1544954')
  })
  it('uses formal Pixiv identities for Pixiv scan artworks', () => {
    expect(
      resolveCanonicalArtworkStoragePath({
        createdVia: 'PIXIV_SCAN',
        artistId: 7,
        artistPixivExternalId: '123',
        artworkPixivExternalId: '456',
        storageKey: null
      })
    ).toBe('123/456')
  })

  it.each(['LOCAL_DIRECTORY', 'MANUAL_CREATE'] as const)('uses stable local identity for %s', (createdVia) => {
    expect(
      resolveCanonicalArtworkStoragePath({
        createdVia,
        artistId: 7,
        artistPixivExternalId: null,
        artworkPixivExternalId: null,
        storageKey: 'e_42_1234567'
      })
    ).toBe('local-imports/artist-7/e_42_1234567')
  })

  it.each(['UNKNOWN', 'URL_ARCHIVE'] as const)('does not guess a target for %s', (createdVia) => {
    expect(
      resolveCanonicalArtworkStoragePath({
        createdVia,
        artistId: 7,
        artistPixivExternalId: '123',
        artworkPixivExternalId: '456',
        storageKey: 'e_42_1234567'
      })
    ).toBeNull()
  })

  it('requires complete safe identity segments', () => {
    expect(
      resolveCanonicalArtworkStoragePath({
        createdVia: 'PIXIV_SCAN',
        artistId: 7,
        artistPixivExternalId: null,
        artworkPixivExternalId: '456',
        storageKey: null
      })
    ).toBeNull()
    expect(() =>
      resolveCanonicalArtworkStoragePath({
        createdVia: 'MANUAL_CREATE',
        artistId: 7,
        artistPixivExternalId: null,
        artworkPixivExternalId: null,
        storageKey: '../escape'
      })
    ).toThrow('unsafe segment')
  })
})
