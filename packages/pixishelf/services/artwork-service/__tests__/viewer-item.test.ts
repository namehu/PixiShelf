import { describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {},
    image: {},
    artworkTag: {}
  }
}))

import { toViewerImageItem } from '../index'

describe('toViewerImageItem', () => {
  it('preserves metadata for each media item in a mixed viewer artwork', () => {
    const item = toViewerImageItem(
      {
        id: 7,
        title: 'Mixed artwork',
        description: '',
        createdAt: '2026-08-10T00:00:00.000Z',
        artist: null,
        tags: [],
        images: [
          {
            path: '/artist/cover.jpg',
            mediaType: 'image'
          },
          {
            path: '/artist/movie.mp4',
            mediaType: 'video',
            chaptersUrl: '/api/v1/media/72/chapters',
            hasAudio: true,
            duration: 125.5
          }
        ]
      },
      { 7: true }
    )

    expect(item.mediaType).toBe(MediaType.IMAGE)
    expect(item.isLike).toBe(true)
    expect(item.images).toEqual([
      expect.objectContaining({
        url: '/artist/cover.jpg',
        mediaType: MediaType.IMAGE,
        chaptersUrl: null,
        hasAudio: null,
        duration: null
      }),
      expect.objectContaining({
        url: '/api/v1/images/artist%2Fmovie.mp4',
        mediaType: MediaType.VIDEO,
        chaptersUrl: '/api/v1/media/72/chapters',
        hasAudio: true,
        duration: 125.5
      })
    ])
  })

  it('uses the first media item to preserve the legacy cover fields', () => {
    const item = toViewerImageItem(
      {
        id: 8,
        title: 'Video artwork',
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        artist: null,
        tags: [],
        images: [{ path: '/artist/movie.webm', mediaType: 'video', hasAudio: false, duration: 20 }]
      },
      {}
    )

    expect(item.mediaType).toBe(MediaType.VIDEO)
    expect(item.imageUrl).toBe(item.images[0]?.url)
    expect(item.images[0]).toEqual(
      expect.objectContaining({ mediaType: MediaType.VIDEO, hasAudio: false, duration: 20 })
    )
  })
})
