import { describe, expect, it } from 'vitest'
import { ArtworkPixivStatusFilterSchema, ArtworkResponseDto } from '../artwork.dto'

const timestamp = new Date('2026-08-26T00:00:00.000Z')
const baseArtwork = {
  id: 11,
  title: 'Artwork',
  description: null,
  artistId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  descriptionLength: 0,
  directoryCreatedAt: null,
  imageCount: 0,
  bookmarkCount: null,
  externalId: null,
  storageKey: null,
  isAiGenerated: null,
  originalUrl: null,
  size: null,
  sourceDate: null,
  sourceUrl: null,
  thumbnailUrl: null,
  xRestrict: null,
  likeCount: 0,
  metaSource: null,
  metadataFormat: null,
  pixivAiType: null,
  pixivType: null,
  sanityLevel: null,
  storagePath: null,
  seriesId: null,
  source: 'PIXIV_IMPORTED' as const,
  images: [],
  tags: [],
  totalMediaSize: 0,
  mediaCount: 0,
  isVideo: false
}

function pixivRef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref-1',
    providerKey: 'pixiv',
    externalId: '123456',
    status: 'SUCCESS' as const,
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    lastErrorCode: null,
    lastError: null,
    lastSystemJobId: 'job-1',
    onlineSnapshotHash: 'a'.repeat(64),
    onlineSnapshotPath: `artworks/123456/metadata/${'a'.repeat(64)}.json`,
    ...overrides
  }
}

describe('ArtworkResponseDto Pixiv synchronization identity', () => {
  it('accepts only supported synchronization filter values', () => {
    expect(ArtworkPixivStatusFilterSchema.safeParse('UNCHECKED').success).toBe(true)
    expect(ArtworkPixivStatusFilterSchema.safeParse('invalid').success).toBe(false)
  })

  it('exposes one numeric Pixiv identity and its synchronization state', () => {
    const artwork = ArtworkResponseDto.parse({ ...baseArtwork, externalRefs: [pixivRef()] })

    expect(artwork.pixivEligible).toBe(true)
    expect(artwork.pixivArtworkId).toBe('123456')
    expect(artwork.pixivSync).toMatchObject({
      status: 'SUCCESS',
      lastSystemJobId: 'job-1',
      onlineSnapshotHash: 'a'.repeat(64)
    })
  })

  it('does not guess an identity when a Pixiv id is invalid or ambiguous', () => {
    const invalid = ArtworkResponseDto.parse({
      ...baseArtwork,
      externalRefs: [pixivRef({ externalId: 'legacy-id' })]
    })
    const ambiguous = ArtworkResponseDto.parse({
      ...baseArtwork,
      externalRefs: [pixivRef(), pixivRef({ id: 'ref-2', externalId: '654321' })]
    })

    expect(invalid.pixivEligible).toBe(false)
    expect(invalid.pixivSync).toBeNull()
    expect(ambiguous.pixivEligible).toBe(false)
    expect(ambiguous.pixivArtworkId).toBeNull()
  })
})
