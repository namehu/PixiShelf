import { describe, expect, it } from 'vitest'
import { buildVideoPosterUrl, isVideoCoverSource, resolveMediaCoverUrl } from '@/lib/media-cover'

describe('media cover helpers', () => {
  it('keeps ordinary image paths as covers', () => {
    expect(resolveMediaCoverUrl({ path: '/artist/work/image.jpg', mediaType: 'IMAGE' })).toBe(
      '/artist/work/image.jpg'
    )
  })

  it('builds a versioned URL for a completed generated poster', () => {
    expect(
      buildVideoPosterUrl({
        posterStatus: 'COMPLETED',
        posterPath: '1-cover.webp',
        posterUpdatedAt: new Date('2026-08-08T01:02:03.000Z')
      })
    ).toBe('/_video-posters/1-cover.webp?v=1786150923000')
  })

  it('does not expose pending or failed posters', () => {
    expect(buildVideoPosterUrl({ posterStatus: 'PENDING', posterPath: '1-cover.webp' })).toBeNull()
    expect(buildVideoPosterUrl({ posterStatus: 'FAILED', posterPath: '1-cover.webp' })).toBeNull()
  })

  it('never falls back to a video path when the generated poster is missing', () => {
    expect(resolveMediaCoverUrl({ path: '/artist/work/video.mp4', mediaType: 'VIDEO' })).toBeNull()
    expect(resolveMediaCoverUrl({ path: '/artist/work/video.webm', mediaType: 'UNKNOWN' })).toBeNull()
  })

  it('recognizes videos by media type or extension', () => {
    expect(isVideoCoverSource({ path: '/artist/work/file.bin', mediaType: 'video' })).toBe(true)
    expect(isVideoCoverSource({ path: '/artist/work/file.mp4' })).toBe(true)
    expect(isVideoCoverSource({ path: '/artist/work/file.jpg' })).toBe(false)
  })
})
