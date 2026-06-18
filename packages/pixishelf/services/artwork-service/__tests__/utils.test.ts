import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { determineArtworkRelDir, transformImages } from '../utils'

describe('transformImages', () => {
  it('should require both chaptersPath and chaptersCount to mark video as hasChapters', () => {
    const now = new Date()
    const { images } = transformImages([
      {
        id: 1,
        path: '/artist/artwork/video.mp4',
        width: null,
        height: null,
        size: 100,
        sortOrder: 0,
        artworkId: 1,
        createdAt: now,
        updatedAt: now,
        webpAnimationStatus: null,
        chaptersPath: '/artist/artwork/video.chapters.json',
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null,
        mediaType: 'UNKNOWN'
      },
      {
        id: 2,
        path: '/artist/artwork/video2.mp4',
        width: null,
        height: null,
        size: 100,
        sortOrder: 1,
        artworkId: 1,
        createdAt: now,
        updatedAt: now,
        webpAnimationStatus: null,
        chaptersPath: '/artist/artwork/video2.chapters.json',
        chaptersCount: 3,
        chaptersDuration: 20,
        chaptersUpdatedAt: now,
        chaptersHash: 'hash',
        mediaType: 'UNKNOWN'
      }
    ])

    expect(images[0]?.hasChapters).toBe(false)
    expect(images[0]?.chaptersUrl).toBeNull()
    expect(images[1]?.hasChapters).toBe(true)
    expect(images[1]?.chaptersUrl).toBe('/api/v1/media/2/chapters')
  })

  it('should allow transformed chapter timestamps to be parsed again', () => {
    const now = new Date()
    const { images } = transformImages([
      {
        id: 1,
        path: '/artist/artwork/video.mp4',
        width: null,
        height: null,
        size: 100,
        sortOrder: 0,
        artworkId: 1,
        createdAt: now,
        updatedAt: now,
        webpAnimationStatus: null,
        chaptersPath: '/artist/artwork/video.chapters.json',
        chaptersCount: 1,
        chaptersDuration: 10,
        chaptersUpdatedAt: now,
        chaptersHash: 'hash',
        mediaType: 'UNKNOWN'
      }
    ])

    expect(() => transformImages(images as any)).not.toThrow()
  })

  it('flattens video metadata when it is included by the query', () => {
    const now = new Date()
    const { images } = transformImages([
      {
        id: 1,
        path: '/artist/artwork/video.mp4',
        width: null,
        height: null,
        size: 100,
        sortOrder: 0,
        artworkId: 1,
        createdAt: now,
        updatedAt: now,
        webpAnimationStatus: null,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null,
        mediaType: 'VIDEO',
        videoMetadata: {
          imageId: 1,
          probeStatus: 'COMPLETED',
          probeUpdatedAt: now,
          probeError: null,
          hasAudio: true,
          audioCodec: 'aac',
          audioChannels: 2,
          videoCodec: 'h264',
          duration: 12.5,
          fps: 29.97,
          createdAt: now,
          updatedAt: now
        }
      }
    ] as any)

    expect(images[0]).toMatchObject({
      mediaType: 'video',
      probeStatus: 'COMPLETED',
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2,
      videoCodec: 'h264',
      duration: 12.5,
      fps: 29.97
    })
    expect(images[0]?.probeUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect('videoMetadata' in images[0]!).toBe(false)
  })
})

describe('determineArtworkRelDir', () => {
  it('prefers and normalizes storagePath when present', () => {
    expect(
      determineArtworkRelDir({
        storagePath: '\\local\\imported-artwork',
        images: [{ path: '/legacy/path/image.jpg' }],
        artist: { userId: 'legacy-artist' },
        externalId: 'legacy-artwork'
      })
    ).toBe('/local/imported-artwork')
  })
})
