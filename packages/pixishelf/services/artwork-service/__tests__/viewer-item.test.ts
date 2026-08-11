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
            id: 71,
            path: '/artist/cover.jpg',
            mediaType: 'image',
            updatedAt: '2026-08-10T01:00:00.000Z',
            size: 1024,
            width: 1200,
            height: 800
          },
          {
            id: 72,
            path: '/artist/movie.mp4',
            mediaType: 'video',
            updatedAt: new Date('2026-08-10T02:00:00.000Z'),
            size: 2048,
            width: 1920,
            height: 1080,
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
        id: 71,
        key: '71',
        url: '/artist/cover.jpg',
        mediaType: MediaType.IMAGE,
        updatedAt: '2026-08-10T01:00:00.000Z',
        size: 1024,
        width: 1200,
        height: 800,
        chaptersUrl: null,
        hasAudio: null,
        duration: null
      }),
      expect.objectContaining({
        id: 72,
        key: '72',
        url: '/api/v1/images/artist%2Fmovie.mp4',
        mediaType: MediaType.VIDEO,
        updatedAt: '2026-08-10T02:00:00.000Z',
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
        images: [
          {
            id: 81,
            path: '/artist/movie.webm',
            mediaType: 'video',
            updatedAt: '2026-08-10T00:00:00.000Z',
            hasAudio: false,
            duration: 20
          }
        ]
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
