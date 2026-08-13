import { describe, expect, it } from 'vitest'
import imgproxyLoader from '@/lib/image-loader'

describe('imgproxyLoader', () => {
  it('routes generated video posters through ImgProxy', () => {
    expect(imgproxyLoader({ src: '/_video-posters/1-abc.webp?v=1784117706648', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2Fderived-media%2Fvideo%2Fposters%2F1-abc.webp@webp?v=1784117706648'
    )
  })

  it('routes generated video chapter previews through ImgProxy', () => {
    expect(
      imgproxyLoader({ src: '/_video-chapter-previews/1/hash/0.webp?v=1784117706648', width: 320, quality: 80 })
    ).toBe(
      'http://localhost:5431/_/rs:fit:320:0/q:80/sm:1/plain/local://%2Fderived-media%2Fvideo%2Fchapters%2F1%2Fhash%2F0.webp@webp?v=1784117706648'
    )
  })

  it('routes generated video keyframes through ImgProxy', () => {
    expect(imgproxyLoader({ src: '/_video-keyframes/1/set-1/0.webp?v=30', width: 320, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:320:0/q:80/sm:1/plain/local://%2Fderived-media%2Fvideo%2Fkeyframes%2F1%2Fset-1%2F0.webp@webp?v=30'
    )
  })

  it('rejects encoded traversal and encoded path separators in derived media URLs', () => {
    const traversal = '/_video-chapter-previews/1/%2e%2e/secret.webp'
    const encodedSeparator = '/_video-chapter-previews/1%2Fsecret.webp'

    expect(imgproxyLoader({ src: traversal, width: 320, quality: 80 })).toBe(traversal)
    expect(imgproxyLoader({ src: encodedSeparator, width: 320, quality: 80 })).toBe(encodedSeparator)
  })

  it('outputs jpg for webp and gif sources', () => {
    expect(imgproxyLoader({ src: '/1000/static.webp', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2Fmedia%2F1000%2Fstatic.webp@jpg'
    )
    expect(imgproxyLoader({ src: '/1000/animated.gif', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2Fmedia%2F1000%2Fanimated.gif@jpg'
    )
  })

  it('keeps ordinary images on webp output', () => {
    expect(imgproxyLoader({ src: '/1000/image.jpg', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2Fmedia%2F1000%2Fimage.jpg@webp'
    )
  })

  it('keeps cache versions out of the ImgProxy source path', () => {
    expect(imgproxyLoader({ src: '/1000/image.jpg?v=2026-08-11', width: 640, quality: 90 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:90/sm:1/plain/local://%2Fmedia%2F1000%2Fimage.jpg@webp?v=2026-08-11'
    )
  })
})
