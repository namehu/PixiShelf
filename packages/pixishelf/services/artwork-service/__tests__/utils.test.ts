import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { transformImages } from '../utils'

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
        chaptersHash: null
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
        chaptersHash: 'hash'
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
        chaptersHash: 'hash'
      }
    ])

    expect(() => transformImages(images as any)).not.toThrow()
  })
})
