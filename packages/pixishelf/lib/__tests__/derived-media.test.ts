import { describe, expect, it } from 'vitest'
import {
  buildDerivedMediaPublicUrl,
  encodeDerivedMediaRelativePath,
  normalizeDerivedMediaRelativePath,
  resolveDerivedMediaSource
} from '@/lib/derived-media'

describe('derived media URLs', () => {
  it('keeps stable virtual prefixes and encodes each nested path segment', () => {
    expect(
      buildDerivedMediaPublicUrl(
        'VIDEO_CHAPTER_PREVIEW',
        '229/0123456789abcdef/章 1.webp',
        new Date('2026-08-09T00:00:00.000Z')
      )
    ).toBe('/_video-chapter-previews/229/0123456789abcdef/%E7%AB%A0%201.webp?v=1786233600000')
  })

  it('maps both virtual resource types into the common ImgProxy root', () => {
    expect(resolveDerivedMediaSource('/_video-posters/229-cover.webp?v=10')).toEqual({
      kind: 'VIDEO_POSTER',
      relativePath: '229-cover.webp',
      imgproxySourcePath: '/derived-media/video/posters/229-cover.webp',
      version: '10'
    })
    expect(resolveDerivedMediaSource('/_video-chapter-previews/229/hash/1.webp?v=20')).toEqual({
      kind: 'VIDEO_CHAPTER_PREVIEW',
      relativePath: '229/hash/1.webp',
      imgproxySourcePath: '/derived-media/video/chapters/229/hash/1.webp',
      version: '20'
    })
  })

  it('rejects traversal, empty segments, backslashes, and encoded separators', () => {
    expect(normalizeDerivedMediaRelativePath('../secret.webp')).toBeNull()
    expect(normalizeDerivedMediaRelativePath('229//1.webp')).toBeNull()
    expect(normalizeDerivedMediaRelativePath('229\\1.webp')).toBeNull()
    expect(resolveDerivedMediaSource('/_video-chapter-previews/229/%2e%2e/secret.webp')).toBeNull()
    expect(resolveDerivedMediaSource('/_video-chapter-previews/229%2Fsecret.webp')).toBeNull()
    expect(() => encodeDerivedMediaRelativePath('../secret.webp')).toThrow('Invalid derived media path')
  })
})
